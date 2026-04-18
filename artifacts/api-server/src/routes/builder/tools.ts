import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
// SOUL.md / AGENTS.md are kept as separate canonical markdown files.
// They are bundled in via the esbuild text loader (see build.mjs) so they
// can evolve independently while still shipping with the binary.
import SOUL_MD from "./SOUL.md";
import AGENTS_MD from "./AGENTS.md";
import { type Blueprint, type BlueprintPatch } from "@workspace/api-zod";
import {
  INTEGRATIONS,
  PRIMITIVES,
  describeRegistryForBuilder,
  findIntegration,
  findPrimitive,
} from "../../lib/registry";

export const BUILDER_TOOLS: Anthropic.Tool[] = [
  {
    name: "ask_clarifying_question",
    description:
      "Ask a single, focused question when there's a real gap you can't reasonably guess. Use sparingly.",
    input_schema: {
      type: "object",
      properties: {
        question: { type: "string" },
        gap: { type: "string", description: "Which Blueprint field this fills." },
      },
      required: ["question", "gap"],
    },
  },
  {
    name: "set_role",
    description:
      "Set or update the agent's name, one-line role summary, and the bullet list of things it watches. Call early once you know what the assistant is for.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        role_summary: {
          type: "string",
          description: "One sentence describing the agent's role in plain English.",
        },
        watches: {
          type: "array",
          items: { type: "string" },
          description:
            "Bullet items: e.g. ['New replies in your inbox', 'Contacts going quiet for 7+ days']",
        },
      },
      required: ["name", "role_summary"],
    },
  },
  {
    name: "add_integration",
    description: `Add an integration the assistant needs. The id MUST be one of: ${INTEGRATIONS.map((i) => i.id).join(", ")}.`,
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", enum: INTEGRATIONS.map((i) => i.id) },
        reason: {
          type: "string",
          description: "One sentence in plain English on why this integration is needed.",
        },
      },
      required: ["id", "reason"],
    },
  },
  {
    name: "remove_integration",
    description: `Remove an integration the assistant no longer needs. The id MUST be one of: ${INTEGRATIONS.map((i) => i.id).join(", ")}. This also removes any tools that depend on that integration.`,
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", enum: INTEGRATIONS.map((i) => i.id) },
      },
      required: ["id"],
    },
  },
  {
    name: "remove_tool",
    description: `Remove a previously added capability. The primitive name MUST be one of: ${PRIMITIVES.map((p) => p.name).join(", ")}.`,
    input_schema: {
      type: "object",
      properties: {
        primitive: {
          type: "string",
          enum: PRIMITIVES.map((p) => p.name),
        },
      },
      required: ["primitive"],
    },
  },
  {
    name: "add_tool",
    description: `Give the agent a capability by selecting a primitive from the registry. The primitive name MUST be one of: ${PRIMITIVES.map((p) => p.name).join(", ")}.`,
    input_schema: {
      type: "object",
      properties: {
        primitive: {
          type: "string",
          enum: PRIMITIVES.map((p) => p.name),
        },
      },
      required: ["primitive"],
    },
  },
  {
    name: "add_trigger",
    description:
      "Add a trigger that causes the agent to run. For scheduled triggers provide a 5-field cron and IANA timezone. For event-style triggers leave cron empty and only set description+task. The 'description' is shown to the client; 'task' is what the agent receives when it fires.",
    input_schema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Plain-English sentence shown to the client.",
        },
        task: {
          type: "string",
          description: "Plain-English instruction the agent receives when this fires.",
        },
        cron: {
          type: "string",
          description: "Optional 5-field cron, e.g. '0 8 * * 1' for Mondays 8am.",
        },
        timezone: {
          type: "string",
          description:
            "IANA timezone, e.g. 'Asia/Manila'. REQUIRED if cron is set.",
        },
      },
      required: ["description", "task"],
    },
  },
  {
    name: "add_capability",
    description:
      "Add a high-level, plain-English capability the agent has (e.g. 'Nudges you when a contact has gone quiet for a week'). Use this to push past the user's literal request.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string" },
      },
      required: ["description"],
    },
  },
  {
    name: "set_voice",
    description:
      "Write the deployed agent's SOUL: a short paragraph describing how the agent sounds when it talks to the client day-to-day.",
    input_schema: {
      type: "object",
      properties: { soul: { type: "string" } },
      required: ["soul"],
    },
  },
  {
    name: "set_rules",
    description:
      "Write the deployed agent's AGENTS.md: a short operating contract used as the agent's system prompt. What it does, what it doesn't, how it uses its tools.",
    input_schema: {
      type: "object",
      properties: { agents_md: { type: "string" } },
      required: ["agents_md"],
    },
  },
  {
    name: "finalize_blueprint",
    description:
      "Finalize when the Blueprint has: a name, role summary, system prompt (use set_rules first), at least one integration, at least one tool, at least one trigger.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
];

export interface ToolExecution {
  patch: BlueprintPatch;
  resultText: string;
}

function uniqByKey<T>(arr: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of arr) {
    const k = key(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

export function executeBuilderTool(
  name: string,
  args: Record<string, unknown>,
  current: Blueprint,
): ToolExecution {
  switch (name) {
    case "ask_clarifying_question":
      return { patch: {}, resultText: "Question delivered. Wait for the user's reply." };

    case "set_role": {
      const patch: BlueprintPatch = {
        name: String(args["name"] ?? current.name),
        role_summary: String(args["role_summary"] ?? current.role_summary ?? ""),
        watches: Array.isArray(args["watches"])
          ? (args["watches"] as unknown[]).map((w) => String(w))
          : current.watches,
      };
      return {
        patch,
        resultText: `Role set: '${patch.name}'.`,
      };
    }

    case "add_integration": {
      const id = String(args["id"] ?? "").toLowerCase();
      const integ = findIntegration(id);
      if (!integ) {
        return {
          patch: {},
          resultText: `Error: '${id}' is not in the registry. Choose one of: ${INTEGRATIONS.map((i) => i.id).join(", ")}.`,
        };
      }
      if (current.integrations.some((i) => i.id === id)) {
        return { patch: {}, resultText: `Integration '${id}' already added.` };
      }
      const next = [
        ...current.integrations,
        {
          id: integ.id,
          name: integ.name,
          label: integ.label,
          reason: String(args["reason"] ?? ""),
        },
      ];
      return {
        patch: { integrations: next },
        resultText: `Added integration '${integ.name}'.`,
      };
    }

    case "remove_integration": {
      const id = String(args["id"] ?? "").toLowerCase();
      if (!current.integrations.some((i) => i.id === id)) {
        return {
          patch: {},
          resultText: `Integration '${id}' was not on the blueprint.`,
        };
      }
      const integrations = current.integrations.filter((i) => i.id !== id);
      // Drop any tools that depend on this integration.
      const droppedTools: string[] = [];
      const tools = current.tools.filter((t) => {
        const primName = t.primitive ?? t.name;
        const prim = findPrimitive(primName);
        if (prim && prim.integration_id === id) {
          droppedTools.push(t.name);
          return false;
        }
        return true;
      });
      const suffix =
        droppedTools.length > 0
          ? ` Also removed dependent capabilities: ${droppedTools.join(", ")}.`
          : "";
      return {
        patch: { integrations, tools },
        resultText: `Removed integration '${id}'.${suffix}`,
      };
    }

    case "remove_tool": {
      const primitiveName = String(args["primitive"] ?? "");
      const prim = findPrimitive(primitiveName);
      const targetName = prim?.name ?? primitiveName;
      if (!current.tools.some((t) => (t.primitive ?? t.name) === targetName)) {
        return {
          patch: {},
          resultText: `Capability '${primitiveName}' was not on the blueprint.`,
        };
      }
      const tools = current.tools.filter(
        (t) => (t.primitive ?? t.name) !== targetName,
      );
      return {
        patch: { tools },
        resultText: `Removed capability '${prim?.label ?? primitiveName}'.`,
      };
    }

    case "add_tool": {
      const primitiveName = String(args["primitive"] ?? "");
      const prim = findPrimitive(primitiveName);
      if (!prim) {
        return {
          patch: {},
          resultText: `Error: primitive '${primitiveName}' not found.`,
        };
      }
      if (current.tools.some((t) => (t.primitive ?? t.name) === prim.name)) {
        return { patch: {}, resultText: `Tool '${prim.label}' already added.` };
      }
      const next = [
        ...current.tools,
        {
          id: randomUUID(),
          name: prim.label,
          primitive: prim.name,
          description: prim.description,
        },
      ];
      // Auto-add the integration if missing.
      let integrations = current.integrations;
      if (!integrations.some((i) => i.id === prim.integration_id)) {
        const integ = findIntegration(prim.integration_id);
        if (integ) {
          integrations = [
            ...integrations,
            { id: integ.id, name: integ.name, label: integ.label, reason: "" },
          ];
        }
      }
      return {
        patch: { tools: next, integrations },
        resultText: `Added capability '${prim.label}'.`,
      };
    }

    case "add_trigger": {
      const description = String(args["description"] ?? "").trim();
      const task = String(args["task"] ?? description);
      const cron = args["cron"] ? String(args["cron"]) : undefined;
      const timezone = args["timezone"] ? String(args["timezone"]) : undefined;
      if (!description) {
        return { patch: {}, resultText: "Error: trigger description required." };
      }
      if (cron && !timezone) {
        return {
          patch: {},
          resultText: "Error: scheduled triggers require a timezone.",
        };
      }
      const trig = { id: randomUUID(), description, task, cron, timezone };
      const next = uniqByKey(
        [...current.triggers, trig],
        (t) => t.description,
      );
      return {
        patch: { triggers: next },
        resultText: `Added trigger: '${description}'.`,
      };
    }

    case "add_capability": {
      const description = String(args["description"] ?? "").trim();
      if (!description) {
        return { patch: {}, resultText: "Error: description required." };
      }
      const next = [
        ...current.capabilities,
        { id: randomUUID(), description, proposed: true },
      ];
      return {
        patch: { capabilities: next },
        resultText: `Added capability: '${description}'.`,
      };
    }

    case "set_voice":
      return {
        patch: { soul: String(args["soul"] ?? "") },
        resultText: "Voice updated.",
      };

    case "set_rules": {
      const md = String(args["agents_md"] ?? "");
      return {
        patch: { agents_md: md, system_prompt: md },
        resultText: "Operating rules updated.",
      };
    }

    case "finalize_blueprint": {
      const issues: string[] = [];
      if (!current.name || current.name === "New Agent") issues.push("name");
      if (!current.role_summary) issues.push("role_summary");
      if (current.integrations.length === 0) issues.push("at least one integration");
      if (current.tools.length === 0) issues.push("at least one tool");
      if (current.triggers.length === 0) issues.push("at least one trigger");
      if (!current.system_prompt && !current.agents_md)
        issues.push("operating rules (set_rules)");
      if (issues.length > 0) {
        return {
          patch: {},
          resultText: `Cannot finalize yet — missing: ${issues.join(", ")}.`,
        };
      }
      return {
        patch: { status: "ready" },
        resultText: "Blueprint finalized. The Deploy button is now visible.",
      };
    }
    default:
      return { patch: {}, resultText: `Unknown tool '${name}'.` };
  }
}

export function buildSystemPrompt(): string {
  return [
    "You are the Builder. Two files define you:",
    "",
    "<<<SOUL.md>>>",
    SOUL_MD,
    "<<<END SOUL.md>>>",
    "",
    "<<<AGENTS.md>>>",
    AGENTS_MD,
    "<<<END AGENTS.md>>>",
    "",
    "## Integration registry available to you",
    describeRegistryForBuilder(),
  ].join("\n");
}

// Backward compat export
export const BUILDER_SYSTEM_PROMPT = buildSystemPrompt();
