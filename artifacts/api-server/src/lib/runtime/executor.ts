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
import { findIntegration, findPrimitive } from "../registry";
import { appendActivity, createRun, updateRun } from "./store";

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
  ) {
    super(`Tool '${toolLabel}' failed: ${technical}`);
  }
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

function buildSystemPrompt(bp: Blueprint, taskDescription: string): string {
  const sections: string[] = [];
  if (bp.soul) sections.push(`# SOUL.md (voice)\n${bp.soul}`);
  if (bp.agents_md)
    sections.push(`# AGENTS.md (operating rules)\n${bp.agents_md}`);
  if (bp.system_prompt) sections.push(`# Job\n${bp.system_prompt}`);
  sections.push(
    `# Connected accounts\n${bp.integrations.map((i) => `- ${i.name} — ${i.label ?? i.name}`).join("\n")}`,
  );
  sections.push(
    `# Current invocation\n${taskDescription}\n\nWork autonomously. When done, give a one-paragraph summary of what you did. Use the available tools to actually act on the user's accounts — don't simulate or describe; do it.`,
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
  const systemPrompt = buildSystemPrompt(bp, task);
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: task },
  ];

  let summary = "";
  let toolCallCount = 0;

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
          details: { tool: tu.name, args },
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
          const handlerPromise = prim.handler(args, {
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
          const friendly = humanizeRuntimeError(prim.label, technical);
          throw new ToolFailureError(
            prim.label,
            friendly,
            technical,
            sanitizeForLLM(technical),
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
    await updateRun(agent.id, run.id, {
      status,
      ended_at: endedAt,
      tool_call_count: toolCallCount,
      failure_reason: technical,
      failure_summary: userText,
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

function humanizeRuntimeError(label: string, technical: string): string {
  const lower = technical.toLowerCase();
  const action = label.toLowerCase();
  // Gmail / Google APIs return 403 with bodies that include
  // "ACCESS_TOKEN_SCOPE_INSUFFICIENT" or "Insufficient Permission" when a
  // connected account is missing a required OAuth scope. Surface that
  // explicitly so users know reconnecting (not retrying) is the fix.
  if (
    lower.includes("access_token_scope_insufficient") ||
    lower.includes("insufficient permission") ||
    lower.includes("insufficient authentication scopes") ||
    lower.includes("insufficientpermissions")
  ) {
    const service = label.toLowerCase().includes("gmail")
      ? "Gmail"
      : "the connected account";
    return `Couldn't ${action} — ${service} isn't authorized to do this. Please reconnect it and grant the requested access.`;
  }
  if (
    lower.includes("not connected") ||
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("connector lookup failed") ||
    lower.includes("no access token")
  ) {
    return `Couldn't ${action} — the connected account isn't authorized. Please reconnect it and try again.`;
  }
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
  if (lower.includes("not found") || lower.includes("404")) {
    return `Couldn't ${action} — the record we were looking for wasn't there.`;
  }
  return `Couldn't ${action}. We've logged the details for review.`;
}
