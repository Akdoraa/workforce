import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  ActivityEvent,
  Blueprint,
  DeployedAgent,
  Run,
} from "@workspace/api-zod";

const DATA_DIR = process.env.AGENT_RUNTIME_DIR
  ? path.resolve(process.env.AGENT_RUNTIME_DIR)
  : path.resolve(process.cwd(), ".data", "agents");
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");
const ACTIVITY_DIR = path.join(DATA_DIR, "activity");
const RUNS_DIR = path.join(DATA_DIR, "runs");
const SCHEDULER_FILE = path.join(DATA_DIR, "scheduler.json");

function ensureDirSync() {
  fsSync.mkdirSync(ACTIVITY_DIR, { recursive: true });
  fsSync.mkdirSync(RUNS_DIR, { recursive: true });
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

// -------- Scheduler last-fired persistence --------

export async function loadSchedulerState(): Promise<Record<string, number>> {
  try {
    const raw = await fs.readFile(SCHEDULER_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const out: Record<string, number> = {};
    if (parsed && typeof parsed === "object" && parsed.last_fired) {
      for (const [k, v] of Object.entries(parsed.last_fired)) {
        if (typeof v === "number") out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

let schedulerSaveQueue: Promise<void> = Promise.resolve();
export function saveSchedulerState(
  lastFired: Record<string, number>,
): Promise<void> {
  const next = schedulerSaveQueue.then(
    async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(
        SCHEDULER_FILE,
        JSON.stringify({ last_fired: lastFired }, null, 2),
      );
    },
    async () => {
      // Recover from a previous failed write so future saves can proceed.
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(
        SCHEDULER_FILE,
        JSON.stringify({ last_fired: lastFired }, null, 2),
      );
    },
  );
  schedulerSaveQueue = next.catch(() => undefined);
  return next;
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

// -------- Runs --------

function runsFile(agentId: string): string {
  return path.join(RUNS_DIR, `${agentId}.jsonl`);
}

let runWriteQueue: Promise<void> = Promise.resolve();

export async function createRun(
  run: Omit<Run, "id"> & { id?: string },
): Promise<Run> {
  const full: Run = Run.parse({ id: run.id ?? randomUUID(), ...run });
  runWriteQueue = runWriteQueue.then(async () => {
    await fs.mkdir(RUNS_DIR, { recursive: true });
    await fs.appendFile(
      runsFile(full.agent_id),
      JSON.stringify({ op: "create", run: full }) + "\n",
    );
  });
  await runWriteQueue;
  return full;
}

export async function updateRun(
  agentId: string,
  runId: string,
  patch: Partial<Run>,
): Promise<void> {
  runWriteQueue = runWriteQueue.then(async () => {
    await fs.mkdir(RUNS_DIR, { recursive: true });
    await fs.appendFile(
      runsFile(agentId),
      JSON.stringify({ op: "update", id: runId, patch }) + "\n",
    );
  });
  await runWriteQueue;
}

async function readRunsForAgent(agentId: string): Promise<Run[]> {
  let raw: string;
  try {
    raw = await fs.readFile(runsFile(agentId), "utf-8");
  } catch {
    return [];
  }
  const byId = new Map<string, Run>();
  const order: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let entry: { op: string; run?: Run; id?: string; patch?: Partial<Run> };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.op === "create" && entry.run) {
      const parsed = Run.safeParse(entry.run);
      if (!parsed.success) continue;
      if (!byId.has(parsed.data.id)) order.push(parsed.data.id);
      byId.set(parsed.data.id, parsed.data);
    } else if (entry.op === "update" && entry.id && entry.patch) {
      const cur = byId.get(entry.id);
      if (!cur) continue;
      byId.set(entry.id, { ...cur, ...entry.patch });
    }
  }
  return order.map((id) => byId.get(id)!).filter(Boolean);
}

export async function listRuns(
  agentId: string,
  limit = 50,
): Promise<Run[]> {
  const all = await readRunsForAgent(agentId);
  return all.slice(-limit).reverse();
}

export async function getLastRun(agentId: string): Promise<Run | null> {
  const all = await readRunsForAgent(agentId);
  return all.length ? all[all.length - 1] : null;
}

export async function getCurrentRun(agentId: string): Promise<Run | null> {
  const all = await readRunsForAgent(agentId);
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].status === "running") return all[i];
  }
  return null;
}

export async function getRun(
  agentId: string,
  runId: string,
): Promise<Run | null> {
  const all = await readRunsForAgent(agentId);
  return all.find((r) => r.id === runId) ?? null;
}

/**
 * Find any runs left in `running` status across all agents and mark them
 * as `failed` with reason "server restarted during run".
 */
export async function reconcileOrphanRuns(): Promise<number> {
  await load();
  let count = 0;
  for (const agentId of Object.keys(state.agents)) {
    const runs = await readRunsForAgent(agentId);
    for (const r of runs) {
      if (r.status !== "running") continue;
      await updateRun(agentId, r.id, {
        status: "failed",
        ended_at: Date.now(),
        failure_reason: "server restarted during run",
        failure_summary:
          "This run was interrupted because the server restarted before it finished.",
      });
      await appendActivity(agentId, {
        run_id: r.id,
        kind: "run_end",
        text: "Run interrupted because the server restarted before it finished.",
      });
      count++;
    }
  }
  return count;
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
