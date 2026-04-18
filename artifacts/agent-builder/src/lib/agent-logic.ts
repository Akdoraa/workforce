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
  patchBlueprint: (id: string, patch: BlueprintPatch) => void;
}

export async function runBuilderTurn({
  agent,
  userText,
  updateAgent,
  addMessageTo,
  appendToMessage,
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
    onToolCall: () => {
      // Tool calls are reflected through blueprint patches; nothing to do here.
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
