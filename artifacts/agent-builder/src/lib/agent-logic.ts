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
  deal: "sales"
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
  const words = text.split(" ").filter(w => w.length > 3);
  if (words.length > 0) {
    const noun = words[0].charAt(0).toUpperCase() + words[0].slice(1);
    return `${noun} Agent`;
  }
  return "Custom Agent";
}

export async function simulateAIResponse(
  userText: string,
  currentAgent: Agent,
  updateCurrentAgent: (updates: Partial<Agent>) => void,
  addMessage: (role: "user" | "assistant", content: string) => void
) {
  // Update status to building
  updateCurrentAgent({ status: "Building" });
  addMessage("user", userText);

  // Classify intent & name
  const newArchetype = classifyIntent(userText);
  const newName = generateName(userText, currentAgent.name);

  // Simulate delay for thinking
  await new Promise(r => setTimeout(r, 1000));
  
  updateCurrentAgent({ archetype: newArchetype, name: newName });
  
  // Add AI response
  const isShort = userText.length < 15;
  const status = isShort ? "Needs Input" : "Active";
  const aiMessage = isShort 
    ? `I can help build a ${newArchetype} agent. Could you provide a bit more detail on what exactly you want it to do?` 
    : `Got it! I've updated the ${newArchetype} interface. You should see the preview on the right. What else should we add?`;
  
  addMessage("assistant", aiMessage);
  updateCurrentAgent({ status });
}
