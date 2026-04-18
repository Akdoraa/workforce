import type { Agent } from "./store";
import { streamBuilderChat } from "./builder-client";
import { deployAgentBlueprint } from "./agent-api";
import type {
  Blueprint,
  BlueprintPatch,
  BuilderChatMessage,
} from "@workspace/api-zod";

interface RunBuilderTurnArgs {
  agent: Agent;
  userText: string;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  addMessageTo: (
    id: string,
    role: "user" | "assistant",
    content: string,
  ) => string;
  appendToMessage: (id: string, messageId: string, delta: string) => void;
  addActivityTo: (id: string, messageId: string, label: string) => void;
  patchBlueprint: (id: string, patch: BlueprintPatch) => void;
}

const INTEGRATION_LABELS: Record<string, string> = {
  gmail: "Gmail",
  hubspot: "HubSpot",
  stripe: "Stripe",
  slack: "Slack",
  google_calendar: "Google Calendar",
};

function titleize(s: string): string {
  return s
    .replace(/^[a-z]+_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function friendlyToolLabel(
  name: string,
  args: Record<string, unknown>,
): string {
  switch (name) {
    case "ask_clarifying_question":
      return "Asking a quick question";
    case "set_role": {
      const n = typeof args.name === "string" ? args.name : "the agent";
      return `Naming the agent — ${n}`;
    }
    case "add_integration": {
      const id = String(args.id ?? "").toLowerCase();
      const label = INTEGRATION_LABELS[id] ?? titleize(id);
      return `Connecting ${label}`;
    }
    case "add_tool": {
      const p = String(args.primitive ?? "");
      return `Adding ability — ${titleize(p)}`;
    }
    case "add_trigger":
      return "Setting when it runs";
    case "add_capability":
      return "Adding a capability";
    case "set_voice":
      return "Writing how it sounds";
    case "set_rules":
      return "Writing the operating rules";
    case "finalize_blueprint":
      return "Finalizing the agent";
    default:
      return titleize(name);
  }
}

export async function runBuilderTurn({
  agent,
  userText,
  updateAgent,
  addMessageTo,
  appendToMessage,
  addActivityTo,
  patchBlueprint,
}: RunBuilderTurnArgs): Promise<void> {
  addMessageTo(agent.id, "user", userText);
  if (agent.phase === "welcome") {
    updateAgent(agent.id, { phase: "building", generating: true });
  } else {
    updateAgent(agent.id, { generating: true });
  }

  const messages: BuilderChatMessage[] = [
    ...agent.messages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userText },
  ];

  const assistantMsgId = addMessageTo(agent.id, "assistant", "");
  let liveBlueprint: Blueprint = agent.blueprint;

  await streamBuilderChat(liveBlueprint, messages, {
    onText: (delta) => {
      appendToMessage(agent.id, assistantMsgId, delta);
    },
    onToolCall: (name, args) => {
      addActivityTo(agent.id, assistantMsgId, friendlyToolLabel(name, args));
    },
    onPatch: (patch) => {
      patchBlueprint(agent.id, patch);
      liveBlueprint = { ...liveBlueprint, ...patch } as Blueprint;
    },
    onError: (msg) => {
      appendToMessage(agent.id, assistantMsgId, `\n\n[error: ${msg}]`);
    },
    onDone: () => {
      updateAgent(agent.id, { generating: false });
    },
  });
}

interface DeployArgs {
  agent: Agent;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  addMessageTo: (
    id: string,
    role: "user" | "assistant",
    content: string,
  ) => string;
}

export async function deployFromBlueprint({
  agent,
  updateAgent,
  addMessageTo,
}: DeployArgs): Promise<void> {
  updateAgent(agent.id, { status: "Deploying" });
  try {
    const result = await deployAgentBlueprint(agent.id, agent.blueprint);
    updateAgent(agent.id, {
      phase: "deployed",
      status: "Deployed",
      deploymentId: result.deployment_id,
      blueprint: result.agent.blueprint,
    });
    addMessageTo(
      agent.id,
      "assistant",
      `Deployed. Your assistant is live — hit "Run now" on the right to watch it work.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    updateAgent(agent.id, { status: "Ready" });
    addMessageTo(agent.id, "assistant", `Deploy hit an error: ${msg}`);
  }
}
