import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  Blueprint,
  BlueprintTrigger,
  DeployedAgent,
  Run,
  RunTriggerSource,
} from "@workspace/api-zod";
import {
  EXTERNAL_CONTENT_SECURITY_RULE,
  findIntegration,
  findPrimitive,
  invokePrimitive,
  PrimitiveValidationError,
} from "../registry";
import {
  clearConnectionCache,
  isConnectorConnected,
  getConnectorAccount,
} from "../connectors";
import { resetStripeClient } from "../registry/stripe";
import { appendActivity, createRun, updateRun } from "./store";
import { redactArgs } from "./redact";

const MAX_TURNS = 10;
const DEFAULT_RUN_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TOOL_TIMEOUT_MS = 60 * 1000;

// In-memory per-agent active-run lock. Both manual and cron acquire here.
const activeRuns = new Map<string, string>();

export function tryAcquireRunLock(agentId: string, runId: string): boolean {
  if (activeRuns.has(agentId)) return false;
  activeRuns.set(agentId, runId);
  return true;
}

export function releaseRunLock(agentId: string): void {
  activeRuns.delete(agentId);
}

export function getActiveRunId(agentId: string): string | undefined {
  return activeRuns.get(agentId);
}

class TimeoutError extends Error {
  constructor(public label: string, public scope: "run" | "tool") {
    super(`Timeout: ${label}`);
  }
}

class ToolFailureError extends Error {
  constructor(
    public toolLabel: string,
    public friendly: string,
    public technical: string,
    public sanitized: string,
    public integrationId: string | null = null,
  ) {
    super(`Tool '${toolLabel}' failed: ${technical}`);
  }
}

/**
 * Heuristic: does this technical error indicate the connected account
 * needs to be reconnected (missing scope / revoked / not authorized)?
 * Mirrors the patterns humanizeRuntimeError uses.
 */
function isAuthFailure(technical: string): boolean {
  const lower = technical.toLowerCase();
  return (
    lower.includes("access_token_scope_insufficient") ||
    lower.includes("insufficient permission") ||
    lower.includes("insufficient authentication scopes") ||
    lower.includes("insufficientpermissions") ||
    lower.includes("not connected") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("connector lookup failed") ||
    lower.includes("no access token") ||
    /\b(?:401|403)\b/.test(lower)
  );
}

function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
  scope: "run" | "tool",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const to = setTimeout(() => reject(new TimeoutError(label, scope)), ms);
    p.then(
      (v) => {
        clearTimeout(to);
        resolve(v);
      },
      (e) => {
        clearTimeout(to);
        reject(e);
      },
    );
  });
}

function untilDeadline<T>(
  p: Promise<T>,
  deadline: number,
  label: string,
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    return Promise.reject(new TimeoutError(label, "run"));
  }
  return withTimeout(p, remaining, label, "run");
}

/**
 * Strip anything that looks like a secret/token/long opaque string from
 * an error message before it's handed back to the LLM.
 */
function sanitizeForLLM(msg: string): string {
  return msg
    .replace(
      /\b(?:sk|pk|key|token|secret|bearer|api[_-]?key)[-_=:\s]*[A-Za-z0-9._-]+/gi,
      "[redacted credential]",
    )
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
    .slice(0, 500);
}

async function buildSystemPrompt(
  bp: Blueprint,
  taskDescription: string,
): Promise<string> {
  const sections: string[] = [];
  if (bp.soul) sections.push(`# SOUL.md (voice)\n${bp.soul}`);
  if (bp.agents_md)
    sections.push(`# AGENTS.md (operating rules)\n${bp.agents_md}`);
  // Always-on baseline rule teaching the agent how to interpret the
  // envelope produced by `wrapExternalContent`. Injected by the runtime
  // so every deployed agent gets it regardless of what the builder put
  // into AGENTS.md.
  sections.push(EXTERNAL_CONTENT_SECURITY_RULE);
  if (bp.system_prompt) sections.push(`# Job\n${bp.system_prompt}`);

  // Resolve the connected identity for each integration so the agent
  // knows e.g. *which* Gmail address to send "to me" mail to. Failures
  // are non-fatal — we just omit the identity line.
  const accountLines = await Promise.all(
    bp.integrations.map(async (i) => {
      const integ = findIntegration(i.id);
      if (!integ) return `- ${i.name} — ${i.label ?? i.name}`;
      try {
        const acct = await getConnectorAccount(integ.connector_name, {
          required_scopes: integ.required_scopes,
          scope_equivalents: integ.scope_equivalents,
        });
        const ident = acct.identity ?? acct.display_name;
        return ident
          ? `- ${i.name} (signed in as ${ident}) — ${i.label ?? i.name}`
          : `- ${i.name} — ${i.label ?? i.name}`;
      } catch {
        return `- ${i.name} — ${i.label ?? i.name}`;
      }
    }),
  );
  sections.push(`# Connected accounts\n${accountLines.join("\n")}`);
  sections.push(
    `# Current invocation\n${taskDescription}\n\nWork autonomously. When done, give a one-paragraph summary of what you did. Use the available tools to actually act on the user's accounts — don't simulate or describe; do it. When the user says "me" / "my inbox" / "my email", use the address listed under Connected accounts above.`,
  );
  return sections.join("\n\n");
}

function buildAnthropicTools(bp: Blueprint): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [];
  for (const t of bp.tools) {
    const primitiveName = t.primitive ?? t.name;
    const prim = findPrimitive(primitiveName);
    if (!prim) continue;
    tools.push({
      name: prim.name,
      description: prim.description,
      input_schema: prim.input_schema,
    });
  }
  return tools;
}

export interface RunResult {
  run_id: string;
  summary: string;
  ok: boolean;
  status: "succeeded" | "failed" | "timed_out";
  error?: string;
}

export interface StartedRun {
  started: true;
  run: Run;
  promise: Promise<RunResult>;
}

export interface AlreadyRunning {
  started: false;
  reason: "already_running";
  current_run_id: string;
}

/**
 * Acquire the per-agent lock, persist a Run record in `running` status,
 * and kick off the executor in the background. Returns a handle whose
 * `promise` resolves once the run terminates (success / failure / timeout).
 */
export async function startRun(
  agent: DeployedAgent,
  task: string,
  triggerSource: RunTriggerSource,
  trigger?: BlueprintTrigger,
): Promise<StartedRun | AlreadyRunning> {
  const runId = randomUUID();
  if (!tryAcquireRunLock(agent.id, runId)) {
    return {
      started: false,
      reason: "already_running",
      current_run_id: activeRuns.get(agent.id) ?? "",
    };
  }

  let run: Run;
  try {
    run = await createRun({
      id: runId,
      agent_id: agent.id,
      trigger_source: triggerSource,
      trigger_id: trigger?.id ?? null,
      trigger_description: trigger?.description ?? null,
      task,
      started_at: Date.now(),
      ended_at: null,
      status: "running",
      failure_reason: null,
      failure_summary: null,
      tool_call_count: 0,
    });
  } catch (err) {
    releaseRunLock(agent.id);
    throw err;
  }

  await appendActivity(agent.id, {
    run_id: run.id,
    kind: "run_start",
    text: trigger
      ? `Triggered: ${trigger.description}`
      : `Run started — ${task}`,
  });

  const promise = executeRun(agent, run, task).finally(() => {
    releaseRunLock(agent.id);
  });
  return { started: true, run, promise };
}

async function executeRun(
  agent: DeployedAgent,
  run: Run,
  task: string,
): Promise<RunResult> {
  const bp = agent.blueprint;
  const runTimeoutMs = bp.run_timeout_ms ?? DEFAULT_RUN_TIMEOUT_MS;
  const toolTimeoutMs = bp.tool_timeout_ms ?? DEFAULT_TOOL_TIMEOUT_MS;
  const deadline = run.started_at + runTimeoutMs;

  const tools = buildAnthropicTools(bp);
  const systemPrompt = await buildSystemPrompt(bp, task);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: task },
  ];

  let summary = "";
  let toolCallCount = 0;

  // Figure out which integrations the agent's selected tools depend on.
  // We use this set both to invalidate caches at run start (so a freshly
  // (re)connected account is picked up immediately) and to pre-flight
  // check the connections — so a missing connection produces a precise
  // "X isn't connected" message instead of a deep SDK failure dressed
  // up as "the record we were looking for wasn't there".
  const requiredIntegrationIds = new Set<string>();
  for (const t of bp.tools) {
    const primName = t.primitive ?? t.name;
    const prim = findPrimitive(primName);
    if (prim) requiredIntegrationIds.add(prim.integration_id);
  }

  // Becomes true once the run has been terminated (success, failure,
  // or timeout). Used to drop any late activity writes from in-flight
  // tool handlers whose work we could not actually cancel, so the
  // `run_end` entry is the final entry for this run.
  let runEnded = false;
  const safeAppendActivity = async (
    entry: Parameters<typeof appendActivity>[1],
  ) => {
    if (runEnded && entry.run_id === run.id) return;
    await appendActivity(agent.id, entry);
  };

  try {
    // Reset any module-level cached SDK clients whose underlying
    // credentials may have changed since the last run. The Stripe SDK
    // client in particular is built once from `getStripeKeys()` and
    // would otherwise hold onto stale keys after a reconnect.
    if (requiredIntegrationIds.has("stripe")) resetStripeClient();

    // Pre-flight: verify each required integration is actually connected
    // (force-fresh, bypassing the 60s cache). If something's missing,
    // end the run with a precise message naming the integration so the
    // user knows exactly what to fix — instead of letting the tool
    // handler fail deep inside the SDK with a misleading error.
    for (const integId of requiredIntegrationIds) {
      const integ = findIntegration(integId);
      if (!integ) continue;
      // Drop the cache for this connector so getConnectorAccount /
      // isConnectorConnected re-reads from the SDK on first use.
      clearConnectionCache(integ.connector_name);

      // 1) Lookup. We must distinguish "no connection exists" from
      //    "lookup itself failed" — collapsing both into "not connected"
      //    would mislead users when the connectors infrastructure has a
      //    transient hiccup. Genuine lookup failures bubble up so the
      //    humanizer reports the real reason.
      let presence: { connected: boolean };
      try {
        presence = await isConnectorConnected(integ.connector_name);
      } catch (lookupErr) {
        const detail =
          lookupErr instanceof Error ? lookupErr.message : String(lookupErr);
        const friendly =
          `Couldn't reach the connections service to verify ${integ.name} ` +
          `right now. This is usually transient — try again in a moment.`;
        throw new ToolFailureError(
          `${integ.name} connection`,
          friendly,
          `Connector lookup for ${integ.connector_name} failed: ${detail}`,
          friendly,
          integ.id,
        );
      }
      if (!presence.connected) {
        const friendly = `${integ.name} isn't connected — connect it on the Connections screen and run again.`;
        throw new ToolFailureError(
          `${integ.name} connection`,
          friendly,
          `${integ.name} (${integ.connector_name}) is not connected.`,
          `${integ.name} is not connected.`,
          integ.id,
        );
      }

      // 2) Authoritative scope/account check. When the integration
      //    declares required_scopes or a scope_probe, exercise it now
      //    so we can fail fast with a precise "reconnect Gmail and
      //    grant send-mail access" message instead of letting the
      //    handler crash mid-tool with a generic 403.
      if (integ.required_scopes || integ.scope_probe) {
        const account = await getConnectorAccount(integ.connector_name, {
          required_scopes: integ.required_scopes,
          scope_equivalents: integ.scope_equivalents,
          scope_probe: integ.scope_probe,
        });
        if (!account.connected) {
          const friendly = `${integ.name} isn't connected — connect it on the Connections screen and run again.`;
          throw new ToolFailureError(
            `${integ.name} connection`,
            friendly,
            account.error ?? `${integ.name} is not connected.`,
            friendly,
            integ.id,
          );
        }
        if (account.needs_reauthorization) {
          const missingHint = account.missing_scopes.length
            ? ` (missing access: ${account.missing_scopes.join(", ")})`
            : "";
          const friendly =
            `${integ.name} is connected but the granted account isn't authorized ` +
            `to do what this agent needs${missingHint}. Please reconnect ${integ.name} ` +
            `on the Connections screen and grant the requested access.`;
          throw new ToolFailureError(
            `${integ.name} authorization`,
            friendly,
            `${integ.name} scope check failed; missing: ${
              account.missing_scopes.join(", ") || "(unknown)"
            }`,
            friendly,
            integ.id,
          );
        }
      }
    }

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await untilDeadline(
        anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system: systemPrompt,
          tools: tools.length > 0 ? tools : undefined,
          messages,
        }),
        deadline,
        "model call",
      );

      const assistantBlocks = response.content;
      messages.push({ role: "assistant", content: assistantBlocks });

      for (const block of assistantBlocks) {
        if (block.type === "text" && block.text.trim()) {
          summary = block.text.trim();
          await safeAppendActivity({
            run_id: run.id,
            kind: "thought",
            text: block.text.trim().slice(0, 500),
          });
        }
      }

      const toolUses = assistantBlocks.filter(
        (b: Anthropic.ContentBlock): b is Anthropic.ToolUseBlock =>
          b.type === "tool_use",
      );

      if (toolUses.length === 0) break;

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const prim = findPrimitive(tu.name);
        const integ = prim ? findIntegration(prim.integration_id) : undefined;
        const args = (tu.input as Record<string, unknown>) ?? {};
        toolCallCount++;

        await safeAppendActivity({
          run_id: run.id,
          kind: "tool_call",
          text: prim ? `${prim.label}…` : `Calling ${tu.name}…`,
          details: { tool: tu.name, args: redactArgs(args) },
        });

        if (!prim) {
          // Unknown tool — treat as a hard failure that aborts the run,
          // since the model is calling something we don't actually have.
          const tech = `Unknown tool '${tu.name}'`;
          throw new ToolFailureError(
            tu.name,
            `Couldn't run a step (${tu.name}) because that action isn't available to this assistant.`,
            tech,
            sanitizeForLLM(tech),
          );
        }

        // Per-tool AbortController. Aborts on per-tool timeout so handlers
        // that honour the signal (fetch, polling, etc.) can stop their
        // work rather than silently continuing in the background.
        const toolAbort = new AbortController();
        try {
          const remaining = deadline - Date.now();
          if (remaining <= 0) {
            throw new TimeoutError("run wall-clock", "run");
          }
          const perToolMs = Math.min(toolTimeoutMs, remaining);
          // `invokePrimitive` validates `args` against the declared input
          // schema before calling the handler. A schema mismatch throws a
          // `PrimitiveValidationError` we catch below to give the LLM a
          // clean tool error instead of a garbled API call.
          const handlerPromise = invokePrimitive(prim, args, {
            connector_name: integ?.connector_name ?? prim.integration_id,
            log: (msg, details) => {
              // Drop any log that arrives after the run has been
              // terminated — `run_end` must remain the final entry.
              void safeAppendActivity({
                run_id: run.id,
                kind: "tool_result",
                text: msg,
                details,
              });
            },
            signal: toolAbort.signal,
          });
          const result = await withTimeout(
            handlerPromise,
            perToolMs,
            prim.label,
            "tool",
          );
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify({
              summary: result.summary,
              data: result.data,
            }).slice(0, 8000),
          });
        } catch (err) {
          if (err instanceof TimeoutError) {
            // Tell the in-flight handler to give up, then bubble out so
            // the outer catch finalizes the run as `timed_out`.
            toolAbort.abort();
            throw err;
          }
          // Tool throw — preserve full unsanitized technical reason on
          // the run record while keeping a sanitized version available
          // for any user/LLM-facing surface.
          const technical = err instanceof Error ? err.message : String(err);
          if (err instanceof PrimitiveValidationError) {
            // Validation failed before the handler ran. Surface a clean
            // tool error to the LLM so it can correct its arguments
            // instead of producing a garbage API call. Don't abort the
            // whole run — the model gets a chance to retry with the
            // correct shape.
            await safeAppendActivity({
              run_id: run.id,
              kind: "error",
              text: `Couldn't ${prim.label.toLowerCase()} — the assistant called it with invalid arguments.`,
            });
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: `Invalid arguments: ${sanitizeForLLM(err.details)}. Re-read the tool's input schema and call it again with the correct shape.`,
              is_error: true,
            });
            continue;
          }
          const integForPrim = findIntegration(prim.integration_id);
          const friendly = humanizeRuntimeError(
            prim.label,
            technical,
            integForPrim?.name,
          );
          throw new ToolFailureError(
            prim.label,
            friendly,
            technical,
            sanitizeForLLM(technical),
            isAuthFailure(technical) ? prim.integration_id : null,
          );
        }
      }

      messages.push({ role: "user", content: toolResults });

      if (response.stop_reason !== "tool_use") break;
    }

    const endedAt = Date.now();
    const durationSec = Math.max(1, Math.round((endedAt - run.started_at) / 1000));
    const summaryLine = `Run completed in ${formatDuration(durationSec)}, ${toolCallCount} tool call${toolCallCount === 1 ? "" : "s"}.`;
    await appendActivity(agent.id, {
      run_id: run.id,
      kind: "run_end",
      text: summary ? `${summaryLine} ${summary}`.slice(0, 800) : summaryLine,
    });
    runEnded = true;
    await updateRun(agent.id, run.id, {
      status: "succeeded",
      ended_at: endedAt,
      tool_call_count: toolCallCount,
    });
    return {
      run_id: run.id,
      summary,
      ok: true,
      status: "succeeded",
    };
  } catch (err) {
    const endedAt = Date.now();
    // Preserve the full unsanitized technical reason on the run record.
    // For ToolFailureError this is the original handler error message,
    // not the sanitized version we'd hand to the model/UI.
    const technical =
      err instanceof ToolFailureError
        ? err.technical
        : err instanceof Error
          ? err.message
          : String(err);
    const isTimeout = err instanceof TimeoutError;
    const status: "failed" | "timed_out" = isTimeout ? "timed_out" : "failed";

    let userText: string;
    if (isTimeout) {
      const mins = Math.max(1, Math.round(runTimeoutMs / 60_000));
      const toolSec = Math.max(1, Math.round(toolTimeoutMs / 1000));
      userText =
        err.scope === "tool"
          ? `Run stopped — a step (${err.label}) took longer than ${toolSec} second${toolSec === 1 ? "" : "s"} and was cancelled. Any partial work from that step is being ignored.`
          : `Run timed out after ${mins} minute${mins === 1 ? "" : "s"}.`;
    } else if (err instanceof ToolFailureError) {
      userText = `Run stopped — ${err.friendly}`;
    } else {
      userText =
        "Run failed before it could finish. We've logged the details for review.";
    }

    // eslint-disable-next-line no-console
    console.error(`[runtime] run ${run.id} ${status}: ${technical}`);

    await appendActivity(agent.id, {
      run_id: run.id,
      kind: "run_end",
      text: userText,
    });
    runEnded = true;
    const failedIntegrationId =
      err instanceof ToolFailureError ? err.integrationId : null;
    await updateRun(agent.id, run.id, {
      status,
      ended_at: endedAt,
      tool_call_count: toolCallCount,
      failure_reason: technical,
      failure_summary: userText,
      failed_integration_id: failedIntegrationId,
    });
    return {
      run_id: run.id,
      summary,
      ok: false,
      status,
      error: userText,
    };
  }
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function humanizeRuntimeError(
  label: string,
  technical: string,
  integrationName?: string,
): string {
  const lower = technical.toLowerCase();
  const action = label.toLowerCase();
  const provider = integrationName ?? "the connected account";

  // 1. Missing-credentials / missing-connection problems. These must be
  //    detected BEFORE any "not found" / 404 check, otherwise an error
  //    like "Stripe credentials missing from the connection — please
  //    reconnect" gets surfaced as "the record we were looking for
  //    wasn't there", which is exactly the bug we're fixing.
  if (
    lower.includes("credentials missing") ||
    lower.includes("isn't connected") ||
    lower.includes("is not connected") ||
    lower.includes("not connected") ||
    lower.includes("please reconnect") ||
    lower.includes("connector lookup failed") ||
    lower.includes("no access token")
  ) {
    // The handler/preflight already produced a user-facing sentence
    // naming the integration. Pass it through unchanged so the user
    // sees "Stripe isn't connected — connect it on the Connections
    // screen and run again." instead of a generic re-wording.
    return technical;
  }

  // 2. Insufficient-scope problems (Google APIs return 403 with
  //    "ACCESS_TOKEN_SCOPE_INSUFFICIENT" / "Insufficient Permission"
  //    when the connected account is missing a required OAuth scope).
  if (
    lower.includes("access_token_scope_insufficient") ||
    lower.includes("insufficient permission") ||
    lower.includes("insufficient authentication scopes") ||
    lower.includes("insufficientpermissions")
  ) {
    return `Couldn't ${action} — ${provider} isn't authorized to do this. Please reconnect ${provider} on the Connections screen and grant the requested access.`;
  }

  // 3. Authorization failures from the live service (401/403, etc).
  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden")
  ) {
    return `Couldn't ${action} — ${provider} isn't authorized. Please reconnect ${provider} on the Connections screen and try again.`;
  }

  // 4. Rate-limit and transient network problems.
  if (
    lower.includes("rate limit") ||
    lower.includes("429") ||
    lower.includes("too many requests")
  ) {
    return `Couldn't ${action} right now — the service is rate-limiting us. We'll back off and retry shortly.`;
  }
  if (
    lower.includes("timeout") ||
    lower.includes("etimedout") ||
    lower.includes("network") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound")
  ) {
    return `Couldn't ${action} — the connection to the service timed out. We'll try again on the next run.`;
  }

  // 5. True upstream 404s. We require BOTH a 404 status indicator AND
  //    "no such" / "not found" wording from the live service, so a
  //    handler error that merely contains the phrase "not found" in
  //    some other context (e.g. "credentials not found") cannot fall
  //    in here. The phrase itself is also strict ("no such" is what
  //    Stripe actually returns; Google returns 404 with "not found").
  const isHttp404 = /\b404\b/.test(lower);
  const has404Wording =
    lower.includes("no such ") || /\bnot found\b/.test(lower);
  if (isHttp404 && has404Wording) {
    return `Couldn't ${action} — the record we were looking for wasn't there.`;
  }
  return `Couldn't ${action}. We've logged the details for review.`;
}
