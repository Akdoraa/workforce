import { Agent, Service } from "./store";

const API_BASE = `${import.meta.env.BASE_URL}api`;

export const SERVICE_META: Record<
  Service,
  { name: string; tagline: string; appNames: string[]; accent: string }
> = {
  stripe: {
    name: "Stripe",
    tagline: "Connect your Stripe account so the agent can read and act on real payments.",
    appNames: ["FinanceFlow", "RevenueOps", "PaymentsPilot"],
    accent: "from-[#635bff] to-[#9089fc]",
  },
  jira: {
    name: "Jira",
    tagline: "Connect your Jira account so the agent can triage and resolve issues.",
    appNames: ["IssuePilot", "TriageOps", "SprintForge"],
    accent: "from-[#0052cc] to-[#00b8d9]",
  },
  slack: {
    name: "Slack",
    tagline: "Connect your Slack workspace so the agent can summarize and respond.",
    appNames: ["ChannelPilot", "SignalDesk", "ThreadOps"],
    accent: "from-[#ecb22e] to-[#e01e5a]",
  },
  generic: {
    name: "your account",
    tagline: "Sign in to your account so the agent has live data to work with.",
    appNames: ["AutoFlow", "TaskPilot", "OpsCenter"],
    accent: "from-[#233dff] to-[#533afd]",
  },
};

function detectService(text: string): Service {
  const t = text.toLowerCase();
  if (/\b(stripe|payment|charge|refund|invoice|finance|revenue|mrr|subscription)/.test(t))
    return "stripe";
  if (/\b(jira|issue|ticket|sprint|backlog|engineering|bug)/.test(t)) return "jira";
  if (/\b(slack|channel|message|notify|notification|standup|thread)/.test(t))
    return "slack";
  return "generic";
}

function pickAppName(service: Service, prompt: string): string {
  const choices = SERVICE_META[service].appNames;
  const seed = prompt.length % choices.length;
  return choices[seed];
}

interface HandlePromptArgs {
  text: string;
  agent: Agent;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  addMessageTo: (id: string, role: "user" | "assistant", content: string) => string;
}

export function handleUserPrompt({
  text,
  agent,
  updateAgent,
  addMessageTo,
}: HandlePromptArgs) {
  addMessageTo(agent.id, "user", text);

  if (agent.phase === "welcome") {
    const service = detectService(text);
    const appName = pickAppName(service, text);
    const meta = SERVICE_META[service];
    updateAgent(agent.id, {
      phase: "awaiting-credentials",
      service,
      appName,
      prompt: text,
      name: appName,
    });
    setTimeout(() => {
      addMessageTo(
        agent.id,
        "assistant",
        `Got it — I'll build you "${appName}". To make this real, I need to connect to ${meta.name}. Click "Sign in with ${meta.name}" on the right and I'll wire it up.`,
      );
    }, 500);
    return;
  }

  // Subsequent messages — once we already have an app, just acknowledge.
  setTimeout(() => {
    addMessageTo(
      agent.id,
      "assistant",
      agent.phase === "app-ready"
        ? "Got it — I've noted that for the next refinement of your app."
        : "Hold tight, I'm setting things up.",
    );
  }, 400);
}

export interface StripeAccountResp {
  connected: boolean;
  account_id: string;
  email: string | null;
  business_name: string | null;
  livemode: boolean;
  error?: string;
}

export async function fetchStripeAccount(): Promise<StripeAccountResp> {
  const res = await fetch(`${API_BASE}/stripe/account`);
  return res.json();
}

interface ConnectArgs {
  agent: Agent;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  addMessageTo: (id: string, role: "user" | "assistant", content: string) => string;
}

export async function connectStripe({
  agent,
  updateAgent,
  addMessageTo,
}: ConnectArgs): Promise<{ ok: boolean; error?: string }> {
  updateAgent(agent.id, { phase: "building-app" });
  try {
    const data = await fetchStripeAccount();
    if (!data.connected) {
      updateAgent(agent.id, { phase: "awaiting-credentials" });
      addMessageTo(
        agent.id,
        "assistant",
        `Stripe sign-in didn't go through (${data.error ?? "no connection"}). Please try again.`,
      );
      return { ok: false, error: data.error };
    }
    // Simulate the build delay so the user sees the app being constructed.
    await new Promise((r) => setTimeout(r, 1400));
    updateAgent(agent.id, {
      phase: "app-ready",
      isRunning: true,
      connection: {
        service: "stripe",
        email: data.email,
        account_id: data.account_id,
        business_name: data.business_name,
        livemode: data.livemode,
        connected_at: Date.now(),
      },
    });
    addMessageTo(
      agent.id,
      "assistant",
      `Connected to Stripe${data.email ? ` as ${data.email}` : ""}. Your app "${agent.appName}" is live and the agent is running on your real Stripe data.`,
    );
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    updateAgent(agent.id, { phase: "awaiting-credentials" });
    addMessageTo(agent.id, "assistant", `Couldn't reach Stripe: ${msg}`);
    return { ok: false, error: msg };
  }
}

export function toggleRunning({
  agent,
  updateAgent,
}: {
  agent: Agent;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
}) {
  updateAgent(agent.id, { isRunning: !agent.isRunning });
}

export function disconnect({
  agent,
  updateAgent,
  addMessageTo,
}: ConnectArgs) {
  updateAgent(agent.id, {
    phase: "awaiting-credentials",
    connection: null,
    isRunning: false,
  });
  addMessageTo(
    agent.id,
    "assistant",
    `Disconnected. Sign in again whenever you want to bring the app back.`,
  );
}
