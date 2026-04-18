import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import {
  type Blueprint,
  type BlueprintPatch,
} from "@workspace/api-zod";

export const BUILDER_TOOLS: Anthropic.Tool[] = [
  {
    name: "ask_clarifying_question",
    description:
      "Ask the user a single, focused clarifying question when the Blueprint has a meaningful gap (e.g. missing trigger, unspecified channel, unclear scope). Do NOT use this for things you can reasonably propose yourself — prefer propose_capability for those.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask." },
        gap: {
          type: "string",
          description:
            "Which Blueprint field this question is filling (e.g. 'triggers', 'integrations', 'system_prompt').",
        },
      },
      required: ["question", "gap"],
    },
  },
  {
    name: "suggest_integration",
    description:
      "Add an integration to the Blueprint when the user mentions a workflow that maps to a known platform (e.g. Slack, Stripe, Jira, Gmail, HubSpot, Linear, Notion). Use this to push the agent forward — you don't need explicit permission to suggest an obvious match.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Lowercase platform id, e.g. 'slack', 'stripe'.",
        },
        name: { type: "string", description: "Display name, e.g. 'Slack'." },
        reason: {
          type: "string",
          description: "One sentence on why this integration fits.",
        },
      },
      required: ["id", "name", "reason"],
    },
  },
  {
    name: "propose_capability",
    description:
      "Propose a capability that goes beyond the user's literal request — the kind of thing a thoughtful builder would add (e.g. 'flag angry customers to Slack', 'auto-summarize threads daily'). Each call adds one capability; the user can react in chat.",
    input_schema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "One concise sentence describing the capability.",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "finalize_blueprint",
    description:
      "Call this ONLY when the Blueprint is genuinely complete: name set, system_prompt written, at least one trigger, at least one integration OR tool, and at least one capability. This ends planning mode and surfaces the Deploy button.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Final agent name (short, descriptive, e.g. 'Support Triage Bot').",
        },
        system_prompt: {
          type: "string",
          description:
            "The final system prompt for the agent — a paragraph describing its goal, tone, and behavior.",
        },
        triggers: {
          type: "array",
          items: { type: "string" },
          description:
            "Concrete events that cause the agent to act (e.g. 'New Zendesk ticket', 'Stripe charge failed').",
        },
        tools: {
          type: "array",
          items: { type: "string" },
          description:
            "Concrete actions the agent can take (e.g. 'Reply to ticket', 'Post to Slack channel').",
        },
      },
      required: ["name", "system_prompt", "triggers", "tools"],
    },
  },
];

export interface ToolExecution {
  patch: BlueprintPatch;
  resultText: string;
}

export function executeBuilderTool(
  name: string,
  args: Record<string, unknown>,
  current: Blueprint,
): ToolExecution {
  switch (name) {
    case "ask_clarifying_question": {
      return {
        patch: {},
        resultText: `Question delivered to user. Wait for their reply before assuming an answer.`,
      };
    }
    case "suggest_integration": {
      const id = String(args["id"] ?? "").toLowerCase();
      const displayName = String(args["name"] ?? id);
      const reason = String(args["reason"] ?? "");
      if (!id) {
        return { patch: {}, resultText: "Error: missing integration id." };
      }
      if (current.integrations.some((i) => i.id === id)) {
        return {
          patch: {},
          resultText: `Integration '${id}' already in blueprint.`,
        };
      }
      const next = [
        ...current.integrations,
        { id, name: displayName, reason },
      ];
      return {
        patch: { integrations: next },
        resultText: `Added integration '${displayName}'.`,
      };
    }
    case "propose_capability": {
      const description = String(args["description"] ?? "").trim();
      if (!description) {
        return { patch: {}, resultText: "Error: missing description." };
      }
      const next = [
        ...current.capabilities,
        { id: randomUUID(), description, proposed: true },
      ];
      return {
        patch: { capabilities: next },
        resultText: `Proposed capability: '${description}'. Mention it briefly to the user.`,
      };
    }
    case "finalize_blueprint": {
      const name = String(args["name"] ?? current.name);
      const systemPrompt = String(args["system_prompt"] ?? current.system_prompt);
      const triggerStrings = Array.isArray(args["triggers"])
        ? (args["triggers"] as unknown[]).map((t) => String(t))
        : [];
      const toolStrings = Array.isArray(args["tools"])
        ? (args["tools"] as unknown[]).map((t) => String(t))
        : [];

      const triggers = triggerStrings.map((description) => ({
        id: randomUUID(),
        description,
      }));
      const tools = toolStrings.map((toolName) => ({
        id: randomUUID(),
        name: toolName,
      }));

      const patch: BlueprintPatch = {
        name,
        system_prompt: systemPrompt,
        triggers: triggers.length > 0 ? triggers : current.triggers,
        tools: tools.length > 0 ? tools : current.tools,
        status: "ready",
      };
      return {
        patch,
        resultText: `Blueprint finalized. The Deploy button is now visible to the user.`,
      };
    }
    default:
      return { patch: {}, resultText: `Unknown tool '${name}'.` };
  }
}

export const BUILDER_SYSTEM_PROMPT = `You are the Builder Agent for OpenClaw, an AI agent platform. Your single job is to lead a conversation with a non-technical client until you have produced a COMPLETE Blueprint — a JSON spec describing the AI agent they want.

You do NOT chat for its own sake. Every assistant turn should either:
- Use a tool to advance the Blueprint, OR
- Reply briefly (1–3 sentences) to react to the user's last message and tee up the next step.

You have four tools:
- ask_clarifying_question — when there is a real gap you cannot reasonably guess.
- suggest_integration — when the user mentions a workflow that obviously maps to a known platform (Slack, Stripe, Jira, Gmail, Zendesk, HubSpot, Linear, Notion, Salesforce, Shopify, etc.). Don't ask permission — add it and mention it.
- propose_capability — push past the user's literal request. If they say "triage support tickets", you should also propose things like "flag angry customers to Slack" or "auto-summarize daily ticket volume". Be opinionated.
- finalize_blueprint — call this ONLY when the Blueprint truly has: a name, a system prompt, at least one trigger, at least one integration or tool, and at least one capability.

Style guide:
- Keep replies short and warm. Never dump a wall of text.
- It is fine — encouraged — to call multiple tools in one turn (e.g. suggest two integrations and propose a capability together).
- Don't summarize the Blueprint in chat — the user can see it on the right panel as you build it.
- Don't ask "anything else?" — propose something concrete instead.
- If the user gives a vague request, propose 1–2 capabilities first to give them something to react to.
- Only finalize when the agent feels genuinely usable, not at the first opportunity.`;
