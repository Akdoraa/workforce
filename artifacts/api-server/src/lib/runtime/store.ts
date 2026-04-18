import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ActivityEvent,
  Blueprint,
  DeployedAgent,
} from "@workspace/api-zod";

const DATA_DIR = process.env.AGENT_RUNTIME_DIR
  ? path.resolve(process.env.AGENT_RUNTIME_DIR)
  : path.resolve(process.cwd(), ".data", "agents");
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");
const ACTIVITY_DIR = path.join(DATA_DIR, "activity");

function ensureDirSync() {
  fsSync.mkdirSync(ACTIVITY_DIR, { recursive: true });
}
ensureDirSync();

interface PersistedState {
  agents: Record<string, DeployedAgent>;
}

let state: PersistedState = { agents: {} };
let loaded = false;

async function load(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await fs.readFile(AGENTS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const agents: Record<string, DeployedAgent> = {};
    for (const [id, val] of Object.entries(parsed.agents ?? {})) {
      const candidate = val as Record<string, unknown>;
      const bpResult = Blueprint.safeParse(candidate["blueprint"]);
      if (!bpResult.success) continue;
      agents[id] = {
        id,
        blueprint: bpResult.data,
        created_at: Number(candidate["created_at"] ?? Date.now()),
        paused: Boolean(candidate["paused"]),
        last_run_at:
          typeof candidate["last_run_at"] === "number"
            ? (candidate["last_run_at"] as number)
            : null,
      };
    }
    state = { agents };
  } catch {
    state = { agents: {} };
  }
}

let saveQueue: Promise<void> = Promise.resolve();
function persist(): Promise<void> {
  saveQueue = saveQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(
      AGENTS_FILE,
      JSON.stringify({ agents: state.agents }, null, 2),
    );
  });
  return saveQueue;
}

export async function listDeployedAgents(): Promise<DeployedAgent[]> {
  await load();
  return Object.values(state.agents).sort(
    (a, b) => b.created_at - a.created_at,
  );
}

export async function getDeployedAgent(
  id: string,
): Promise<DeployedAgent | null> {
  await load();
  return state.agents[id] ?? null;
}

export async function createDeployment(
  blueprint: Blueprint,
  presetId?: string,
): Promise<DeployedAgent> {
  await load();
  const id = presetId ?? `dep_${randomUUID().slice(0, 8)}`;
  const deployed: DeployedAgent = {
    id,
    blueprint: {
      ...blueprint,
      status: "deployed",
      deployment: { id, url: `replit-app://${id}` },
    },
    created_at: Date.now(),
    paused: false,
    last_run_at: null,
  };
  state.agents[id] = deployed;
  await persist();
  return deployed;
}

export async function updateDeployment(
  id: string,
  patch: Partial<DeployedAgent>,
): Promise<DeployedAgent | null> {
  await load();
  const cur = state.agents[id];
  if (!cur) return null;
  state.agents[id] = { ...cur, ...patch };
  await persist();
  return state.agents[id];
}

export async function deleteDeployment(id: string): Promise<boolean> {
  await load();
  if (!state.agents[id]) return false;
  delete state.agents[id];
  await persist();
  return true;
}

// -------- Activity log --------

interface ActivityListener {
  agentId: string;
  cb: (evt: ActivityEvent) => void;
}
const listeners: ActivityListener[] = [];

function activityFile(agentId: string): string {
  return path.join(ACTIVITY_DIR, `${agentId}.jsonl`);
}

export async function appendActivity(
  agentId: string,
  evt: Omit<ActivityEvent, "id" | "ts"> & { id?: string; ts?: number },
): Promise<ActivityEvent> {
  const full: ActivityEvent = {
    id: evt.id ?? randomUUID(),
    ts: evt.ts ?? Date.now(),
    run_id: evt.run_id ?? null,
    kind: evt.kind,
    text: evt.text,
    details: evt.details,
  };
  await fs.mkdir(ACTIVITY_DIR, { recursive: true });
  await fs.appendFile(activityFile(agentId), JSON.stringify(full) + "\n");
  for (const l of listeners) {
    if (l.agentId === agentId) {
      try {
        l.cb(full);
      } catch {
        // ignore
      }
    }
  }
  return full;
}

export async function readActivity(
  agentId: string,
  limit = 200,
): Promise<ActivityEvent[]> {
  try {
    const raw = await fs.readFile(activityFile(agentId), "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    const events: ActivityEvent[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as ActivityEvent);
      } catch {
        // skip
      }
    }
    return events.slice(-limit);
  } catch {
    return [];
  }
}

export function subscribeActivity(
  agentId: string,
  cb: (evt: ActivityEvent) => void,
): () => void {
  const entry = { agentId, cb };
  listeners.push(entry);
  return () => {
    const i = listeners.indexOf(entry);
    if (i >= 0) listeners.splice(i, 1);
  };
}
