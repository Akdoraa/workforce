import { Router, type IRouter } from "express";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  Blueprint,
  BuilderChatRequest,
  type BlueprintPatch,
  type BuilderStreamEvent,
} from "@workspace/api-zod";
import {
  BUILDER_SYSTEM_PROMPT,
  BUILDER_TOOLS,
  executeBuilderTool,
} from "./tools";

const router: IRouter = Router();

const MAX_LOOP_TURNS = 6;

function send(res: import("express").Response, event: BuilderStreamEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function applyPatch(current: Blueprint, patch: BlueprintPatch): Blueprint {
  return Blueprint.parse({ ...current, ...patch });
}

function summarizeBlueprint(bp: Blueprint): string {
  return JSON.stringify({
    name: bp.name,
    system_prompt: bp.system_prompt,
    integrations: bp.integrations.map((i) => i.id),
    triggers: bp.triggers.map((t) => t.description),
    tools: bp.tools.map((t) => t.name),
    capabilities: bp.capabilities.map((c) => c.description),
    status: bp.status,
  });
}

router.post("/builder/chat", async (req, res) => {
  const parsed = BuilderChatRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  let blueprint = parsed.data.blueprint;

  const messages: Anthropic.MessageParam[] = parsed.data.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  try {
    for (let turn = 0; turn < MAX_LOOP_TURNS; turn++) {
      const systemPrompt = `${BUILDER_SYSTEM_PROMPT}\n\nCURRENT BLUEPRINT:\n${summarizeBlueprint(blueprint)}`;

      const stream = anthropic.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: systemPrompt,
        tools: BUILDER_TOOLS,
        messages,
      });

      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          send(res, { type: "text", content: event.delta.text });
        }
      }

      const finalMessage = await stream.finalMessage();

      const assistantContent = finalMessage.content;
      messages.push({ role: "assistant", content: assistantContent });

      const toolUses = assistantContent.filter(
        (b: Anthropic.ContentBlock): b is Anthropic.ToolUseBlock =>
          b.type === "tool_use",
      );

      if (toolUses.length === 0) {
        break;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const args = (toolUse.input as Record<string, unknown>) ?? {};
        send(res, {
          type: "tool_call",
          name: toolUse.name,
          args,
        });

        const exec = executeBuilderTool(toolUse.name, args, blueprint);
        if (Object.keys(exec.patch).length > 0) {
          blueprint = applyPatch(blueprint, exec.patch);
          send(res, { type: "blueprint_patch", patch: exec.patch });
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: exec.resultText,
        });
      }

      messages.push({ role: "user", content: toolResults });

      if (finalMessage.stop_reason !== "tool_use") {
        break;
      }
    }

    send(res, { type: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log?.error({ err }, "Builder chat failed");
    send(res, { type: "error", message });
  } finally {
    res.end();
  }
});

export default router;
