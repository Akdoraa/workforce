import { Agent, Service } from "./store";

const API_BASE = `${import.meta.env.BASE_URL}api`;

export interface ServiceMeta {
  name: string;
  tagline: string;
  appNames: string[];
  accent: string;
  buttonClass: string;
  enabled: boolean;
  endpoint: string; // GET endpoint that returns { connected, account_id, ... }
  brandLabel: string; // text shown on the connect button after "Sign in with"
  description: string; // shown in the "live agent for your X" subtitle
}

export const SERVICE_META: Record<Service, ServiceMeta> = {
  stripe: {
    name: "Stripe",
    tagline:
      "Connect your Stripe account so the agent can read and act on real payments.",
    appNames: ["FinanceFlow", "RevenueOps", "PaymentsPilot"],
    accent: "from-[#635bff] to-[#9089fc]",
    buttonClass: "bg-[#635bff] hover:bg-[#5851e5] text-white",
    enabled: true,
    endpoint: "/stripe/account",
    brandLabel: "Stripe",
    description: "Live agent for your Stripe account",
  },
  slack: {
    name: "Slack",
    tagline:
      "Connect your Slack workspace so the agent can summarize channels and post on your behalf.",
    appNames: ["ChannelPilot", "SignalDesk", "ThreadOps"],
    accent: "from-[#4a154b] to-[#e01e5a]",
    buttonClass: "bg-[#4a154b] hover:bg-[#3b1140] text-white",
    enabled: true,
    endpoint: "/slack/account",
    brandLabel: "Slack",
    description: "Live agent for your Slack workspace",
  },
  jira: {
    name: "Jira",
    tagline:
      "Connect your Jira account so the agent can triage and resolve issues.",
    appNames: ["IssuePilot", "TriageOps", "SprintForge"],
    accent: "from-[#0052cc] to-[#00b8d9]",
    buttonClass: "bg-[#0052cc] hover:bg-[#0747a6] text-white",
    enabled: false,
    endpoint: "/jira/account",
    brandLabel: "Jira",
    description: "Live agent for your Jira project",
  },
  generic: {
    name: "your account",
    tagline:
      "Sign in to your account so the agent has live data to work with.",
    appNames: ["AutoFlow", "TaskPilot", "OpsCenter"],
    accent: "from-[#233dff] to-[#533afd]",
    buttonClass: "bg-primary hover:bg-primary/90 text-primary-foreground",
    enabled: false,
    endpoint: "",
    brandLabel: "your service",
    description: "Live agent",
  },
};

function detectService(text: string): Service {
  const t = text.toLowerCase();
  if (
    /\b(stripe|payment|charge|refund|invoice|finance|revenue|mrr|subscription)/.test(
      t,
    )
  )
    return "stripe";
  if (
    /\b(slack|channel|message|notify|notification|standup|thread|workspace|dm\b)/.test(
      t,
    )
  )
    return "slack";
  if (/\b(jira|issue|ticket|sprint|backlog|engineering|bug)/.test(t))
    return "jira";
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
        `Got it — I'll build you "${appName}". To make this real, I need to connect to ${meta.name}. Click "Sign in with ${meta.brandLabel}" on the right and I'll wire it up.`,
      );
    }, 500);
    return;
  }

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

export interface ConnectResp {
  connected: boolean;
  account_id?: string;
  email?: string | null;
  business_name?: string | null;
  team?: string | null;
  user?: string | null;
  livemode?: boolean;
  error?: string;
}

export async function fetchServiceAccount(
  service: Service,
): Promise<ConnectResp> {
  const meta = SERVICE_META[service];
  if (!meta.endpoint) return { connected: false, error: "No endpoint" };
  const res = await fetch(`${API_BASE}${meta.endpoint}`);
  return res.json();
}

interface ConnectArgs {
  agent: Agent;
  updateAgent: (id: string, updates: Partial<Agent>) => void;
  addMessageTo: (id: string, role: "user" | "assistant", content: string) => string;
}

export async function connectService({
  agent,
  updateAgent,
  addMessageTo,
}: ConnectArgs): Promise<{ ok: boolean; error?: string }> {
  const service = agent.service ?? "generic";
  const meta = SERVICE_META[service];
  updateAgent(agent.id, { phase: "building-app" });
  try {
    const data = await fetchServiceAccount(service);
    if (!data.connected) {
      updateAgent(agent.id, { phase: "awaiting-credentials" });
      addMessageTo(
        agent.id,
        "assistant",
        `${meta.name} sign-in didn't go through (${data.error ?? "no connection"}). Please try again.`,
      );
      return { ok: false, error: data.error };
    }
    await new Promise((r) => setTimeout(r, 1200));
    // Map various services into the unified Connection shape.
    const businessName =
      data.business_name ?? data.team ?? null;
    updateAgent(agent.id, {
      phase: "app-ready",
      isRunning: true,
      connection: {
        service,
        email: data.email ?? null,
        account_id: data.account_id ?? "",
        business_name: businessName,
        livemode: data.livemode ?? true,
        connected_at: Date.now(),
      },
    });
    const who =
      data.email ??
      data.team ??
      data.business_name ??
      data.account_id ??
      "your account";
    addMessageTo(
      agent.id,
      "assistant",
      `Connected to ${meta.name} (${who}). Your app "${agent.appName}" is live and the agent is running on your real ${meta.name} data.`,
    );
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    updateAgent(agent.id, { phase: "awaiting-credentials" });
    addMessageTo(agent.id, "assistant", `Couldn't reach ${meta.name}: ${msg}`);
    return { ok: false, error: msg };
  }
}

// Backwards-compat alias.
export const connectStripe = connectService;

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
