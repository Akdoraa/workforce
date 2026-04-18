import { useState, useEffect, useCallback } from "react";

export type Service = "stripe" | "jira" | "slack" | "generic";
export type Phase =
  | "welcome"
  | "awaiting-credentials"
  | "building-app"
  | "app-ready";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface Connection {
  service: Service;
  accountEmail: string;
  accountId: string;
  apiKeyMasked: string;
  connectedAt: number;
}

export interface Agent {
  id: string;
  name: string;
  appName: string;
  service: Service;
  phase: Phase;
  messages: Message[];
  prompt: string;
  connection: Connection | null;
  isRunning: boolean;
  createdAt: number;
}

const STORAGE_KEY = "agent-builder-state-v2";

interface AppState {
  agents: Record<string, Agent>;
  currentAgentId: string | null;
}

const createDefaultAgent = (): Agent => ({
  id: crypto.randomUUID(),
  name: "New Agent",
  appName: "Untitled App",
  service: "generic",
  phase: "welcome",
  messages: [],
  prompt: "",
  connection: null,
  isRunning: false,
  createdAt: Date.now(),
});

export function useAgentStore() {
  const [state, setState] = useState<AppState>(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error("Failed to load state", e);
    }
    const a = createDefaultAgent();
    return { agents: { [a.id]: a }, currentAgentId: a.id };
  });

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const currentAgent = state.currentAgentId
    ? state.agents[state.currentAgentId]
    : null;

  const createNewAgent = useCallback(() => {
    const a = createDefaultAgent();
    setState((s) => ({
      ...s,
      agents: { ...s.agents, [a.id]: a },
      currentAgentId: a.id,
    }));
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

  const addMessageTo = useCallback(
    (agentId: string, role: "user" | "assistant", content: string) => {
      setState((s) => {
        const target = s.agents[agentId];
        if (!target) return s;
        const m: Message = {
          id: crypto.randomUUID(),
          role,
          content,
          timestamp: Date.now(),
        };
        return {
          ...s,
          agents: {
            ...s.agents,
            [agentId]: { ...target, messages: [...target.messages, m] },
          },
        };
      });
    },
    [],
  );

  return {
    currentAgent,
    createNewAgent,
    updateAgent,
    addMessageTo,
  };
}
