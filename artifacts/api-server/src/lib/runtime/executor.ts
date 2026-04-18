import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  Blueprint,
  BlueprintTrigger,
  DeployedAgent,
} from "@workspace/api-zod";
import { findIntegration, findPrimitive } from "../registry";
import { appendActivity } from "./store";

const MAX_TURNS = 10;

function buildSystemPrompt(bp: Blueprint, taskDescription: string): string {
  const sections: string[] = [];
  if (bp.soul) sections.push(`# SOUL.md (voice)\n${bp.soul}`);
  if (bp.agents_md)
    sections.push(`# AGENTS.md (operating rules)\n${bp.agents_md}`);
  if (bp.system_prompt)
    sections.push(`# Job\n${bp.system_prompt}`);
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
  error?: string;
}

export async function runAgent(
  agent: DeployedAgent,
  task: string,
  trigger?: BlueprintTrigger,
): Promise<RunResult> {
  const runId = randomUUID();
  const bp = agent.blueprint;

  await appendActivity(agent.id, {
    run_id: runId,
    kind: "run_start",
    text: trigger
      ? `Triggered: ${trigger.description}`
      : `Run started — ${task}`,
  });

  const tools = buildAnthropicTools(bp);
  const systemPrompt = buildSystemPrompt(bp, task);

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: task },
  ];

  let summary = "";
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: systemPrompt,
        tools: tools.length > 0 ? tools : undefined,
        messages,
      });

      const assistantBlocks = response.content;
      messages.push({ role: "assistant", content: assistantBlocks });

      // Capture text as a "thought".
      for (const block of assistantBlocks) {
        if (block.type === "text" && block.text.trim()) {
          summary = block.text.trim();
          await appendActivity(agent.id, {
            run_id: runId,
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

        await appendActivity(agent.id, {
          run_id: runId,
          kind: "tool_call",
          text: prim ? `${prim.label}…` : `Calling ${tu.name}…`,
          details: { tool: tu.name, args },
        });

        if (!prim) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Unknown tool '${tu.name}'`,
            is_error: true,
          });
          continue;
        }

        try {
          const result = await prim.handler(args, {
            connector_name: integ?.connector_name ?? prim.integration_id,
            log: (msg, details) => {
              void appendActivity(agent.id, {
                run_id: runId,
                kind: "tool_result",
                text: msg,
                details,
              });
            },
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify({
              summary: result.summary,
              data: result.data,
            }).slice(0, 8000),
          });
        } catch (err) {
          const technical = err instanceof Error ? err.message : String(err);
          const friendly = humanizeRuntimeError(prim.label, technical);
          // eslint-disable-next-line no-console
          console.error(
            `[runtime] tool ${prim.name} failed for agent ${agent.id}: ${technical}`,
          );
          await appendActivity(agent.id, {
            run_id: runId,
            kind: "error",
            text: friendly,
          });
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: `Error: ${technical}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });

      if (response.stop_reason !== "tool_use") break;
    }

    await appendActivity(agent.id, {
      run_id: runId,
      kind: "run_end",
      text: summary || "Run finished.",
    });
    return { run_id: runId, summary, ok: true };
  } catch (err) {
    const technical = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[runtime] run failed for agent ${agent.id}: ${technical}`);
    await appendActivity(agent.id, {
      run_id: runId,
      kind: "error",
      text: "Something went wrong on this run. We've logged the details — try again, or pause the assistant if it keeps failing.",
    });
    return { run_id: runId, summary, ok: false, error: technical };
  }
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
