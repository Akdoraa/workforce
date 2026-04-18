import { Agent, Archetype } from "./store";

const ARCHETYPE_KEYWORDS: Record<string, Archetype> = {
  support: "support",
  ticket: "support",
  customer: "support",
  helpdesk: "support",
  finance: "finance",
  payment: "finance",
  invoice: "finance",
  metric: "finance",
  sales: "sales",
  lead: "sales",
  pipeline: "sales",
  crm: "sales",
  deal: "sales",
};

function classifyIntent(text: string): Archetype {
  const lower = text.toLowerCase();
  for (const [keyword, archetype] of Object.entries(ARCHETYPE_KEYWORDS)) {
    if (lower.includes(keyword)) {
      return archetype;
    }
  }
  return "generic";
}

function generateName(text: string, currentName: string): string {
  if (currentName !== "New Agent") return currentName;
  const words = text.split(" ").filter((w) => w.length > 3);
  if (words.length > 0) {
    const noun = words[0].charAt(0).toUpperCase() + words[0].slice(1);
    return `${noun} Agent`;
  }
  return "Custom Agent";
}

const requestTokens = new Map<string, number>();

export async function simulateAIResponse(
  userText: string,
  originAgent: Agent,
  updateAgent: (agentId: string, updates: Partial<Agent>) => void,
  addMessageTo: (
    agentId: string,
    role: "user" | "assistant",
    content: string,
  ) => void,
) {
  const agentId = originAgent.id;
  const token = (requestTokens.get(agentId) ?? 0) + 1;
  requestTokens.set(agentId, token);

  addMessageTo(agentId, "user", userText);
  updateAgent(agentId, { status: "Building" });

  const newArchetype = classifyIntent(userText);
  const newName = generateName(userText, originAgent.name);

  await new Promise((r) => setTimeout(r, 1000));

  if (requestTokens.get(agentId) !== token) return;

  updateAgent(agentId, { archetype: newArchetype, name: newName });

  const isShort = userText.length < 15;
  const status = isShort ? "Needs Input" : "Active";
  const aiMessage = isShort
    ? `I can help build a ${newArchetype} agent. Could you provide a bit more detail on what exactly you want it to do?`
    : `Got it! I've updated the ${newArchetype} interface. You should see the preview on the right. What else should we add?`;

  addMessageTo(agentId, "assistant", aiMessage);
  updateAgent(agentId, { status });
}
