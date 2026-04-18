import {
  type ActivityEvent,
  type Blueprint,
  type DeployedAgent,
  type Run,
} from "@workspace/api-zod";

const API_BASE = `${import.meta.env.BASE_URL}api`;

export interface ConnectionStatus {
  id: string;
  name: string;
  label: string;
  brand_color: string;
  connector_name: string;
  connected: boolean;
  identity: string | null;
  display_name: string | null;
  needs_reauthorization?: boolean;
  missing_scopes?: string[];
  reauthorization_message?: string;
  error?: string;
}

// Module-level dedupe + micro-cache. Many components mount their own
// poll loop (every connect card, the blueprint preview, the connections
// screen). Without this, ~10 mounted components × every 5s would fan
// out into 10 simultaneous calls to the connectors API and trigger a
// 429 rate-limit, which the UI would render as "Couldn't reach Gmail".
let inflight: Promise<ConnectionStatus[]> | null = null;
let cachedAt = 0;
let cached: ConnectionStatus[] = [];
const MIN_REFRESH_MS = 1500;

export async function fetchConnections(
  opts: { fresh?: boolean } = {},
): Promise<ConnectionStatus[]> {
  if (!opts.fresh && inflight) return inflight;
  if (
    !opts.fresh &&
    cached.length > 0 &&
    Date.now() - cachedAt < MIN_REFRESH_MS
  ) {
    return cached;
  }
  const url = opts.fresh
    ? `${API_BASE}/connections?fresh=1`
    : `${API_BASE}/connections`;
  const promise = (async () => {
    try {
      const res = await fetch(url);
      const data = (await res.json()) as { connections: ConnectionStatus[] };
      const list = data.connections ?? [];
      cached = list;
      cachedAt = Date.now();
      return list;
    } finally {
      inflight = null;
    }
  })();
  inflight = promise;
  return promise;
}

/**
 * Drop the server's cached view of every connection and return the
 * freshly re-fetched list. Called after the Replit settings popup closes,
 * since the popup is one page where the user can change *any* connection.
 */
export async function refreshAllConnections(): Promise<ConnectionStatus[]> {
  const res = await fetch(`${API_BASE}/connections/refresh`, {
    method: "POST",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { connections: ConnectionStatus[] };
  return data.connections ?? [];
}

/**
 * Tell the server to drop its cached view of one connection and re-read it
 * from the connectors SDK. Used after the user finishes connect / reconnect
 * / disconnect on the Replit account page so the UI flips state immediately
 * instead of waiting for the cache TTL.
 */
export async function refreshConnection(
  id: string,
): Promise<ConnectionStatus | null> {
  const res = await fetch(`${API_BASE}/connections/${id}/refresh`, {
    method: "POST",
  });
  if (!res.ok) return null;
  return (await res.json()) as ConnectionStatus;
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
): Promise<{
  run_id: string;
  ok: boolean;
  summary: string;
  status?: "running" | "succeeded" | "failed" | "timed_out";
  already_running?: boolean;
  error?: string;
}> {
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

export async function fetchRuns(id: string, limit = 25): Promise<Run[]> {
  const res = await fetch(`${API_BASE}/agents/${id}/runs?limit=${limit}`);
  if (!res.ok) return [];
  return (await res.json()).runs ?? [];
}

export async function fetchActivity(id: string): Promise<ActivityEvent[]> {
  const res = await fetch(`${API_BASE}/agents/${id}/activity`);
  if (!res.ok) return [];
  return (await res.json()).events;
}

export type StreamState = "connected" | "reconnecting" | "lost";

export function streamActivity(
  id: string,
  onEvent: (e: ActivityEvent) => void,
  onState?: (state: StreamState) => void,
): () => void {
  let closed = false;
  let es: EventSource | null = null;
  let attempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (closed) return;
    es = new EventSource(`${API_BASE}/agents/${id}/activity/stream`);
    es.onopen = () => {
      attempts = 0;
      onState?.("connected");
    };
    es.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data) as ActivityEvent;
        onEvent(evt);
      } catch {
        // ignore malformed events
      }
    };
    es.onerror = () => {
      if (closed) return;
      attempts += 1;
      onState?.(attempts >= 4 ? "lost" : "reconnecting");
      try {
        es?.close();
      } catch {
        // ignore
      }
      es = null;
      const delay = Math.min(1000 * 2 ** Math.min(attempts, 5), 15000);
      retryTimer = setTimeout(open, delay);
    };
  };

  open();

  return () => {
    closed = true;
    if (retryTimer) clearTimeout(retryTimer);
    try {
      es?.close();
    } catch {
      // ignore
    }
  };
}
