import { useState, useEffect, useCallback } from "react";

export type Archetype = "support" | "finance" | "sales" | "generic";
export type Status = "Building" | "Active" | "Needs Input";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ToolConnection {
  stripe: boolean;
  jira: boolean;
  slack: boolean;
}

export interface Agent {
  id: string;
  name: string;
  archetype: Archetype;
  status: Status;
  messages: Message[];
  tools: ToolConnection;
  createdAt: number;
  prompt?: string;
}

const STORAGE_KEY = "agent-builder-state";

interface AppState {
  agents: Record<string, Agent>;
  currentAgentId: string | null;
}

const createDefaultAgent = (): Agent => ({
  id: crypto.randomUUID(),
  name: "New Agent",
  archetype: "generic",
  status: "Needs Input",
  messages: [],
  tools: { stripe: false, jira: false, slack: false },
  createdAt: Date.now(),
});

export function useAgentStore() {
  const [state, setState] = useState<AppState>(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.error("Failed to load state", e);
    }
    const defaultAgent = createDefaultAgent();
    return {
      agents: { [defaultAgent.id]: defaultAgent },
      currentAgentId: defaultAgent.id,
    };
  });

  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const currentAgent = state.currentAgentId ? state.agents[state.currentAgentId] : null;

  const createNewAgent = useCallback(() => {
    const newAgent = createDefaultAgent();
    setState(s => ({
      ...s,
      agents: { ...s.agents, [newAgent.id]: newAgent },
      currentAgentId: newAgent.id,
    }));
  }, []);

  const switchAgent = useCallback((id: string) => {
    setState(s => ({ ...s, currentAgentId: id }));
  }, []);

  const updateAgent = useCallback((agentId: string, updates: Partial<Agent>) => {
    setState(s => {
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
  }, []);

  const updateCurrentAgent = useCallback((updates: Partial<Agent>) => {
    setState(s => {
      if (!s.currentAgentId) return s;
      const current = s.agents[s.currentAgentId];
      if (!current) return s;
      return {
        ...s,
        agents: {
          ...s.agents,
          [s.currentAgentId]: { ...current, ...updates },
        },
      };
    });
  }, []);

  const addMessageTo = useCallback(
    (agentId: string, role: "user" | "assistant", content: string) => {
      setState(s => {
        const target = s.agents[agentId];
        if (!target) return s;
        const newMessage: Message = {
          id: crypto.randomUUID(),
          role,
          content,
          timestamp: Date.now(),
        };
        return {
          ...s,
          agents: {
            ...s.agents,
            [agentId]: { ...target, messages: [...target.messages, newMessage] },
          },
        };
      });
    },
    [],
  );

  return {
    agents: Object.values(state.agents).sort((a, b) => b.createdAt - a.createdAt),
    currentAgent,
    createNewAgent,
    switchAgent,
    updateCurrentAgent,
    updateAgent,
    addMessageTo,
  };
}
