import { useState, useEffect, useCallback } from "react";
import {
  Blueprint,
  emptyBlueprint,
  type BlueprintPatch,
} from "@workspace/api-zod";

export type Status = "Building" | "Active" | "Needs Input" | "Deploying" | "Deployed";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface Agent {
  id: string;
  name: string;
  status: Status;
  messages: Message[];
  blueprint: Blueprint;
  createdAt: number;
  prompt?: string;
}

const STORAGE_KEY = "agent-builder-state-v2";
const LEGACY_KEY = "agent-builder-state";

interface AppState {
  agents: Record<string, Agent>;
  currentAgentId: string | null;
}

const createDefaultAgent = (): Agent => {
  const id = crypto.randomUUID();
  return {
    id,
    name: "New Agent",
    status: "Needs Input",
    messages: [],
    blueprint: emptyBlueprint(),
    createdAt: Date.now(),
  };
};

function normalizeAgent(raw: unknown): Agent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["id"] !== "string") return null;
  const blueprintParsed = Blueprint.safeParse(r["blueprint"]);
  const blueprint = blueprintParsed.success
    ? blueprintParsed.data
    : emptyBlueprint();
  return {
    id: r["id"] as string,
    name: typeof r["name"] === "string" ? (r["name"] as string) : blueprint.name,
    status: (r["status"] as Status) ?? "Needs Input",
    messages: Array.isArray(r["messages"]) ? (r["messages"] as Message[]) : [],
    blueprint,
    createdAt:
      typeof r["createdAt"] === "number"
        ? (r["createdAt"] as number)
        : Date.now(),
  };
}

function loadState(): AppState {
  try {
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
    sessionStorage.removeItem(LEGACY_KEY);
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
          agents: {
            ...s.agents,
            [agentId]: { ...target, ...updates },
          },
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
          patch.name && patch.name.trim().length > 0
            ? patch.name
            : target.name;
        return {
          ...s,
          agents: {
            ...s.agents,
            [agentId]: { ...target, blueprint: merged, name: nextName },
          },
        };
      });
    },
    [],
  );

  const addMessageTo = useCallback(
    (agentId: string, role: "user" | "assistant", content: string) => {
      let createdId = "";
      setState((s) => {
        const target = s.agents[agentId];
        if (!target) return s;
        const newMessage: Message = {
          id: crypto.randomUUID(),
          role,
          content,
          timestamp: Date.now(),
        };
        createdId = newMessage.id;
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
      return createdId;
    },
    [],
  );

  const appendToMessage = useCallback(
    (agentId: string, messageId: string, delta: string) => {
      setState((s) => {
        const target = s.agents[agentId];
        if (!target) return s;
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
  };
}
