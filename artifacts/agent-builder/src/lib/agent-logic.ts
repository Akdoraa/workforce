import { Agent } from "./store";
import {
  Blueprint,
  type BlueprintPatch,
  type BuilderChatMessage,
} from "@workspace/api-zod";
import { streamBuilderChat } from "./builder-client";

const requestTokens = new Map<string, number>();

interface RunBuilderArgs {
  userText: string;
  agent: Agent;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  patchBlueprint: (id: string, patch: BlueprintPatch) => void;
  addMessageTo: (
    id: string,
    role: "user" | "assistant",
    content: string,
  ) => string;
  appendToMessage: (id: string, messageId: string, delta: string) => void;
}

export async function runBuilderTurn({
  userText,
  agent,
  updateAgent,
  patchBlueprint,
  addMessageTo,
  appendToMessage,
}: RunBuilderArgs): Promise<void> {
  const agentId = agent.id;
  const token = (requestTokens.get(agentId) ?? 0) + 1;
  requestTokens.set(agentId, token);

  addMessageTo(agentId, "user", userText);
  updateAgent(agentId, { status: "Building" });

  const history: BuilderChatMessage[] = [
    ...agent.messages.map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userText },
  ];

  let assistantMsgId: string | null = null;
  let pendingText = "";
  let nextBlueprint: Blueprint = agent.blueprint;
  let lastError: string | null = null;

  const ensureMessage = () => {
    if (!assistantMsgId) {
      assistantMsgId = addMessageTo(agentId, "assistant", "");
    }
    return assistantMsgId;
  };

  await streamBuilderChat(nextBlueprint, history, {
    onText: (delta) => {
      if (requestTokens.get(agentId) !== token) return;
      pendingText += delta;
      const id = ensureMessage();
      appendToMessage(agentId, id, delta);
    },
    onToolCall: () => {
      // Tool calls are surfaced via the resulting blueprint patch.
    },
    onPatch: (patch) => {
      if (requestTokens.get(agentId) !== token) return;
      nextBlueprint = Blueprint.parse({ ...nextBlueprint, ...patch });
      patchBlueprint(agentId, patch);
    },
    onError: (message) => {
      lastError = message;
    },
    onDone: () => {},
  });

  if (requestTokens.get(agentId) !== token) return;

  if (lastError) {
    const id = ensureMessage();
    appendToMessage(
      agentId,
      id,
      pendingText ? `\n\n[Error: ${lastError}]` : `Sorry — ${lastError}`,
    );
    updateAgent(agentId, { status: "Needs Input" });
    return;
  }

  if (!assistantMsgId) {
    addMessageTo(
      agentId,
      "assistant",
      nextBlueprint.status === "ready"
        ? "Your blueprint is ready — hit Deploy on the right when you are."
        : "Got it.",
    );
  }

  const finalStatus: Agent["status"] =
    nextBlueprint.status === "ready" ? "Active" : "Needs Input";
  updateAgent(agentId, { status: finalStatus });
}
