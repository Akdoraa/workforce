import { useState, useEffect, useCallback } from "react";
import {
  Blueprint,
  emptyBlueprint,
  type BlueprintPatch,
} from "@workspace/api-zod";

export type Status = "Drafting" | "Ready" | "Deploying" | "Deployed";
export type Phase = "welcome" | "building" | "deployed";

export interface MessageActivity {
  id: string;
  label: string;
  /** Internal tool name (e.g. "add_capability") for grouping/filtering. */
  kind?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  activities?: MessageActivity[];
}

export interface Agent {
  id: string;
  name: string;
  status: Status;
  messages: Message[];
  blueprint: Blueprint;
  createdAt: number;
  phase: Phase;
  deploymentId: string | null;
  /** A streaming generation is in flight when truthy. */
  generating: boolean;
}

const STORAGE_KEY = "agent-builder-state-v5";
const LEGACY_KEYS = [
  "agent-builder-state",
  "agent-builder-state-v2",
  "agent-builder-state-v3",
  "agent-builder-state-v4",
];

interface AppState {
  agents: Record<string, Agent>;
  currentAgentId: string | null;
}

const createDefaultAgent = (): Agent => {
  const id = crypto.randomUUID();
  return {
    id,
    name: "New Agent",
    status: "Drafting",
    messages: [],
    blueprint: emptyBlueprint(),
    createdAt: Date.now(),
    phase: "welcome",
    deploymentId: null,
    generating: false,
  };
};

function normalizeMessage(raw: unknown): Message | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const role = r["role"];
  if (role !== "user" && role !== "assistant") return null;
  const id = typeof r["id"] === "string" ? (r["id"] as string) : crypto.randomUUID();
  const content = typeof r["content"] === "string" ? (r["content"] as string) : "";
  const timestamp =
    typeof r["timestamp"] === "number" ? (r["timestamp"] as number) : Date.now();
  const activitiesRaw = Array.isArray(r["activities"]) ? r["activities"] : [];
  const activities: MessageActivity[] = activitiesRaw
    .map((a) => {
      if (!a || typeof a !== "object") return null;
      const ar = a as Record<string, unknown>;
      const label = typeof ar["label"] === "string" ? (ar["label"] as string) : null;
      if (!label) return null;
      const aid =
        typeof ar["id"] === "string" ? (ar["id"] as string) : crypto.randomUUID();
      const kind = typeof ar["kind"] === "string" ? (ar["kind"] as string) : undefined;
      const out: MessageActivity = { id: aid, label };
      if (kind) out.kind = kind;
      return out;
    })
    .filter((a): a is MessageActivity => a !== null);
  return { id, role, content, timestamp, activities };
}

function normalizeAgent(raw: unknown): Agent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["id"] !== "string") return null;
  const blueprintParsed = Blueprint.safeParse(r["blueprint"]);
  const blueprint = blueprintParsed.success
    ? blueprintParsed.data
    : emptyBlueprint();
  const rawMessages = Array.isArray(r["messages"]) ? r["messages"] : [];
  const messages: Message[] = rawMessages
    .map(normalizeMessage)
    .filter((m): m is Message => m !== null);
  return {
    id: r["id"] as string,
    name: typeof r["name"] === "string" ? (r["name"] as string) : blueprint.name,
    status: (r["status"] as Status) ?? "Drafting",
    messages,
    blueprint,
    createdAt:
      typeof r["createdAt"] === "number" ? (r["createdAt"] as number) : Date.now(),
    phase: (r["phase"] as Phase) ?? "welcome",
    deploymentId:
      typeof r["deploymentId"] === "string"
        ? (r["deploymentId"] as string)
        : null,
    generating: false,
  };
}

function loadState(): AppState {
  try {
    for (const k of LEGACY_KEYS) sessionStorage.removeItem(k);
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as AppState;
      const agents: Record<string, Agent> = {};
      for (const [id, raw] of Object.entries(parsed.agents ?? {})) {
        const norm = normalizeAgent(raw);
        if (norm) agents[id] = norm;
      }
      const currentAgentId =
        parsed.currentAgentId && agents[parsed.currentAgentId]
          ? parsed.currentAgentId
          : (Object.keys(agents)[0] ?? null);
      if (Object.keys(agents).length > 0) {
        return { agents, currentAgentId };
      }
    }
  } catch (e) {
    console.error("Failed to load state", e);
  }
  const defaultAgent = createDefaultAgent();
  return {
    agents: { [defaultAgent.id]: defaultAgent },
    currentAgentId: defaultAgent.id,
  };
}

export function useAgentStore() {
  const [state, setState] = useState<AppState>(loadState);

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const currentAgent = state.currentAgentId
    ? state.agents[state.currentAgentId]
    : null;

  const createNewAgent = useCallback(() => {
    const newAgent = createDefaultAgent();
    setState((s) => ({
      ...s,
      agents: { ...s.agents, [newAgent.id]: newAgent },
      currentAgentId: newAgent.id,
    }));
  }, []);

  const switchAgent = useCallback((id: string) => {
    setState((s) => ({ ...s, currentAgentId: id }));
  }, []);

  const updateAgent = useCallback(
    (agentId: string, updates: Partial<Agent>) => {
      setState((s) => {
        const target = s.agents[agentId];
        if (!target) return s;
        return {
          ...s,
          agents: { ...s.agents, [agentId]: { ...target, ...updates } },
        };
      });
    },
    [],
  );

  const patchBlueprint = useCallback(
    (agentId: string, patch: BlueprintPatch) => {
      setState((s) => {
        const target = s.agents[agentId];
        if (!target) return s;
        const merged = Blueprint.parse({ ...target.blueprint, ...patch });
        const nextName =
          patch.name && patch.name.trim().length > 0 ? patch.name : target.name;
        const nextStatus: Status =
          merged.status === "deployed"
            ? "Deployed"
            : merged.status === "ready"
              ? "Ready"
              : merged.status === "deploying"
                ? "Deploying"
                : "Drafting";
        return {
          ...s,
          agents: {
            ...s.agents,
            [agentId]: {
              ...target,
              blueprint: merged,
              name: nextName,
              status: nextStatus,
            },
          },
        };
      });
    },
    [],
  );

  const addMessageTo = useCallback(
    (agentId: string, role: "user" | "assistant", content: string) => {
      const newMessageId = crypto.randomUUID();
      const newMessage: Message = {
        id: newMessageId,
        role,
        content,
        timestamp: Date.now(),
      };
      setState((s) => {
        const target = s.agents[agentId];
        if (!target) return s;
        if (target.messages.some((m) => m.id === newMessageId)) return s;
        return {
          ...s,
          agents: {
            ...s.agents,
            [agentId]: {
              ...target,
              messages: [...target.messages, newMessage],
            },
          },
        };
      });
      return newMessageId;
    },
    [],
  );

  const addActivityTo = useCallback(
    (agentId: string, messageId: string, label: string, kind?: string) => {
      setState((s) => {
        const target = s.agents[agentId];
        if (!target) return s;
        if (!target.messages.some((m) => m.id === messageId)) return s;
        return {
          ...s,
          agents: {
            ...s.agents,
            [agentId]: {
              ...target,
              messages: target.messages.map((m) =>
                m.id === messageId
                  ? {
                      ...m,
                      activities: [
                        ...(m.activities ?? []),
                        { id: crypto.randomUUID(), label, kind },
                      ],
                    }
                  : m,
              ),
            },
          },
        };
      });
    },
    [],
  );

  const appendToMessage = useCallback(
    (agentId: string, messageId: string, delta: string) => {
      setState((s) => {
        const target = s.agents[agentId];
        if (!target) return s;
        if (!target.messages.some((m) => m.id === messageId)) return s;
        return {
          ...s,
          agents: {
            ...s.agents,
            [agentId]: {
              ...target,
              messages: target.messages.map((m) =>
                m.id === messageId ? { ...m, content: m.content + delta } : m,
              ),
            },
          },
        };
      });
    },
    [],
  );

  return {
    agents: Object.values(state.agents).sort(
      (a, b) => b.createdAt - a.createdAt,
    ),
    currentAgent,
    createNewAgent,
    switchAgent,
    updateAgent,
    patchBlueprint,
    addMessageTo,
    appendToMessage,
    addActivityTo,
  };
}
