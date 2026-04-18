import {
  type ActivityEvent,
  type Blueprint,
  type DeployedAgent,
} from "@workspace/api-zod";

const API_BASE = `${import.meta.env.BASE_URL}api`;

export interface ConnectionStatus {
  id: string;
  name: string;
  label: string;
  brand_color: string;
  connected: boolean;
  identity: string | null;
  display_name: string | null;
  error?: string;
}

export async function fetchConnections(): Promise<ConnectionStatus[]> {
  const res = await fetch(`${API_BASE}/connections`);
  const data = (await res.json()) as { connections: ConnectionStatus[] };
  return data.connections ?? [];
}

export async function deployAgentBlueprint(
  agentId: string,
  blueprint: Blueprint,
): Promise<{
  deployment_id: string;
  url: string;
  agent: DeployedAgent;
}> {
  const res = await fetch(`${API_BASE}/agents/${agentId}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blueprint }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Deploy failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function pauseAgent(id: string): Promise<DeployedAgent> {
  const res = await fetch(`${API_BASE}/agents/${id}/pause`, { method: "POST" });
  return (await res.json()).agent;
}

export async function resumeAgent(id: string): Promise<DeployedAgent> {
  const res = await fetch(`${API_BASE}/agents/${id}/resume`, { method: "POST" });
  return (await res.json()).agent;
}

export async function runAgentNow(
  id: string,
  task?: string,
): Promise<{ run_id: string; ok: boolean; summary: string; error?: string }> {
  const res = await fetch(`${API_BASE}/agents/${id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(task ? { task } : {}),
  });
  return res.json();
}

export async function fetchAgent(id: string): Promise<DeployedAgent | null> {
  const res = await fetch(`${API_BASE}/agents/${id}`);
  if (!res.ok) return null;
  return (await res.json()).agent;
}

export async function fetchActivity(id: string): Promise<ActivityEvent[]> {
  const res = await fetch(`${API_BASE}/agents/${id}/activity`);
  if (!res.ok) return [];
  return (await res.json()).events;
}

export function streamActivity(
  id: string,
  onEvent: (e: ActivityEvent) => void,
): () => void {
  const es = new EventSource(`${API_BASE}/agents/${id}/activity/stream`);
  es.onmessage = (msg) => {
    try {
      const evt = JSON.parse(msg.data) as ActivityEvent;
      onEvent(evt);
    } catch {
      // ignore malformed events
    }
  };
  es.onerror = () => {
    // keep connection — browser EventSource auto-reconnects
  };
  return () => es.close();
}
