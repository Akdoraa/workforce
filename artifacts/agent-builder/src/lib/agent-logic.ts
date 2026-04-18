import { Agent, Service, Connection } from "./store";

const SERVICE_KEYWORDS: Record<string, Service> = {
  finance: "stripe",
  payment: "stripe",
  invoice: "stripe",
  invoices: "stripe",
  billing: "stripe",
  stripe: "stripe",
  revenue: "stripe",
  subscription: "stripe",
  subscriptions: "stripe",
  charge: "stripe",
  refund: "stripe",
  refunds: "stripe",
  jira: "jira",
  ticket: "jira",
  tickets: "jira",
  issue: "jira",
  issues: "jira",
  bug: "jira",
  bugs: "jira",
  sprint: "jira",
  backlog: "jira",
  slack: "slack",
  message: "slack",
  messages: "slack",
  channel: "slack",
  team: "slack",
  notify: "slack",
  notification: "slack",
  notifications: "slack",
};

export const SERVICE_META: Record<
  Service,
  {
    label: string;
    color: string;
    fieldLabel: string;
    keyPlaceholder: string;
    accountIdPrefix: string;
    description: string;
  }
> = {
  stripe: {
    label: "Stripe",
    color: "indigo",
    fieldLabel: "Stripe secret key",
    keyPlaceholder: "sk_live_•••••••••••",
    accountIdPrefix: "acct_",
    description:
      "Stripe powers your payments, customers, invoices and subscriptions.",
  },
  jira: {
    label: "Jira",
    color: "blue",
    fieldLabel: "Jira API token",
    keyPlaceholder: "ATATT3xFfGF0••••••••••",
    accountIdPrefix: "site_",
    description: "Jira holds your boards, sprints, issues and assignees.",
  },
  slack: {
    label: "Slack",
    color: "rose",
    fieldLabel: "Slack bot token",
    keyPlaceholder: "xoxb-••••••-••••••",
    accountIdPrefix: "team_",
    description: "Slack lets your agent read channels and send messages.",
  },
  generic: {
    label: "Workspace",
    color: "violet",
    fieldLabel: "Workspace API key",
    keyPlaceholder: "wsk_•••••••••••",
    accountIdPrefix: "ws_",
    description: "Connect your data source so the agent can act on it.",
  },
};

function detectService(text: string): Service {
  const lower = text.toLowerCase();
  for (const [keyword, service] of Object.entries(SERVICE_KEYWORDS)) {
    const re = new RegExp(`\\b${keyword}\\b`);
    if (re.test(lower)) return service;
  }
  return "generic";
}

const STOPWORDS = new Set([
  "a","an","the","and","or","but","of","for","to","in","on","at","by","with",
  "is","are","my","your","our","their","i","me","you","we","they",
  "build","make","create","want","need","help","please","like",
  "agent","app","ai","platform","that","which","this","app","dashboard","auto","automate","automated",
]);

function deriveAppName(prompt: string, service: Service): string {
  const cleaned = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const subject = cleaned[0];
  if (subject) {
    const cap = subject.charAt(0).toUpperCase() + subject.slice(1);
    return `${cap}Flow`;
  }
  switch (service) {
    case "stripe":
      return "MoneyFlow";
    case "jira":
      return "IssueFlow";
    case "slack":
      return "InboxFlow";
    default:
      return "AgentFlow";
  }
}

function deriveAgentName(prompt: string): string {
  const cleaned = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const subject = cleaned[0] ?? "task";
  const cap = subject.charAt(0).toUpperCase() + subject.slice(1);
  return `${cap} Agent`;
}

const requestTokens = new Map<string, number>();

export async function handleUserPrompt(
  userText: string,
  origin: Agent,
  updateAgent: (agentId: string, updates: Partial<Agent>) => void,
  addMessageTo: (
    agentId: string,
    role: "user" | "assistant",
    content: string,
  ) => void,
) {
  const agentId = origin.id;
  const token = (requestTokens.get(agentId) ?? 0) + 1;
  requestTokens.set(agentId, token);

  addMessageTo(agentId, "user", userText);

  // Phase: welcome → awaiting-credentials
  if (origin.phase === "welcome") {
    const service = detectService(userText);
    const appName = deriveAppName(userText, service);
    const agentName = deriveAgentName(userText);

    updateAgent(agentId, {
      service,
      appName,
      name: agentName,
      prompt: userText,
      phase: "building-app",
    });

    await new Promise((r) => setTimeout(r, 900));
    if (requestTokens.get(agentId) !== token) return;

    const meta = SERVICE_META[service];
    addMessageTo(
      agentId,
      "assistant",
      `Got it. I'll build you ${appName} — an app where your ${agentName} works on your behalf.\n\nTo plug it into your data, I need to connect to ${meta.label}. Drop your ${meta.fieldLabel} on the right and I'll wire it up.`,
    );

    updateAgent(agentId, { phase: "awaiting-credentials" });
    return;
  }

  // Phase: app-ready → conversational follow-ups
  if (origin.phase === "app-ready") {
    updateAgent(agentId, { phase: "building-app" });
    await new Promise((r) => setTimeout(r, 700));
    if (requestTokens.get(agentId) !== token) return;

    addMessageTo(
      agentId,
      "assistant",
      `Updated your ${origin.appName}. The agent is ${
        origin.isRunning ? "running" : "ready"
      } on the right — give it a try.`,
    );
    updateAgent(agentId, { phase: "app-ready" });
    return;
  }

  // Phase: awaiting-credentials → nudge
  if (origin.phase === "awaiting-credentials") {
    await new Promise((r) => setTimeout(r, 400));
    if (requestTokens.get(agentId) !== token) return;
    addMessageTo(
      agentId,
      "assistant",
      `Connect ${SERVICE_META[origin.service].label} on the right and I'll spin up your app.`,
    );
  }
}

export async function connectCredentials(
  agent: Agent,
  apiKey: string,
  email: string,
  updateAgent: (agentId: string, updates: Partial<Agent>) => void,
  addMessageTo: (
    agentId: string,
    role: "user" | "assistant",
    content: string,
  ) => void,
) {
  const agentId = agent.id;
  const meta = SERVICE_META[agent.service];

  updateAgent(agentId, { phase: "building-app" });

  await new Promise((r) => setTimeout(r, 1200));

  const last4 = apiKey.slice(-4).padStart(4, "•");
  const accountSuffix = Math.random().toString(36).slice(2, 10);
  const connection: Connection = {
    service: agent.service,
    accountEmail: email,
    accountId: `${meta.accountIdPrefix}${accountSuffix}`,
    apiKeyMasked: `••••${last4}`,
    connectedAt: Date.now(),
  };

  updateAgent(agentId, {
    connection,
    phase: "app-ready",
    isRunning: true,
  });

  addMessageTo(
    agentId,
    "assistant",
    `Connected to ${meta.label} as ${email}. Your ${agent.appName} is live on the right and the ${agent.name} just started working on your account.`,
  );
}

export function disconnect(
  agent: Agent,
  updateAgent: (agentId: string, updates: Partial<Agent>) => void,
) {
  updateAgent(agent.id, {
    connection: null,
    phase: "awaiting-credentials",
    isRunning: false,
  });
}
