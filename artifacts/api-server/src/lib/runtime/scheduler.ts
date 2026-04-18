import {
  getDeployedAgent,
  listDeployedAgents,
  loadSchedulerState,
  reconcileOrphanRuns,
  saveSchedulerState,
  updateDeployment,
} from "./store";
import { startRun } from "./executor";
import type { BlueprintTrigger, DeployedAgent } from "@workspace/api-zod";
import { logger } from "../logger";

// Minimal cron parser: supports "m h dom mon dow" with *, lists (1,2), ranges (1-5), and steps (*/5).
// Sufficient for our use; not a full cron implementation.

interface CronFields {
  minute: number[];
  hour: number[];
  day: number[];
  month: number[];
  weekday: number[];
}

function parseField(field: string, min: number, max: number): number[] {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    let step = 1;
    let body = part;
    const stepIdx = body.indexOf("/");
    if (stepIdx >= 0) {
      step = Number(body.slice(stepIdx + 1));
      body = body.slice(0, stepIdx);
    }
    let lo = min;
    let hi = max;
    if (body !== "*" && body !== "") {
      if (body.includes("-")) {
        const [a, b] = body.split("-");
        lo = Number(a);
        hi = Number(b);
      } else {
        lo = hi = Number(body);
      }
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return Array.from(out).sort((a, b) => a - b);
}

export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron: '${expr}'`);
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    day: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    weekday: parseField(parts[4], 0, 6),
  };
}

function partsInTimezone(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (t: string) => fmt.find((p) => p.type === t)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    minute: Number(get("minute")),
    hour: Number(get("hour") === "24" ? "0" : get("hour")),
    day: Number(get("day")),
    month: Number(get("month")),
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

export function cronMatches(
  expr: string,
  date: Date,
  timezone = "UTC",
): boolean {
  const fields = parseCron(expr);
  const t = partsInTimezone(date, timezone);
  return (
    fields.minute.includes(t.minute) &&
    fields.hour.includes(t.hour) &&
    fields.day.includes(t.day) &&
    fields.month.includes(t.month) &&
    fields.weekday.includes(t.weekday)
  );
}

export function describeCron(
  expr: string | undefined,
  timezone: string | undefined,
): string {
  if (!expr) return "on demand";
  try {
    const f = parseCron(expr);
    const tz = timezone ?? "UTC";
    const time = `${String(f.hour[0]).padStart(2, "0")}:${String(f.minute[0]).padStart(2, "0")}`;
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    if (f.weekday.length < 7) {
      const days = f.weekday.map((d) => dayNames[d]).join(", ");
      return `${days} at ${time} ${tz}`;
    }
    if (f.day.length < 31 && f.day.length === 1) {
      return `Day ${f.day[0]} of every month at ${time} ${tz}`;
    }
    if (f.hour.length === 24) return `every minute (${tz})`;
    if (f.minute.length === 1 && f.hour.length === 1)
      return `every day at ${time} ${tz}`;
    return `${expr} (${tz})`;
  } catch {
    return expr;
  }
}

let timer: NodeJS.Timeout | null = null;
const lastFired = new Map<string, number>();
let stateLoaded: Promise<void> | null = null;

function ensureStateLoaded(): Promise<void> {
  if (!stateLoaded) {
    stateLoaded = loadSchedulerState()
      .then((persisted) => {
        for (const [k, v] of Object.entries(persisted)) {
          lastFired.set(k, v);
        }
        logger.info(
          { entries: Object.keys(persisted).length },
          "Restored scheduler last-fired state",
        );
      })
      .catch((err) => {
        logger.warn({ err }, "Failed to load scheduler state");
      });
  }
  return stateLoaded;
}

async function persistLastFired(): Promise<void> {
  const obj: Record<string, number> = {};
  for (const [k, v] of lastFired.entries()) obj[k] = v;
  try {
    await saveSchedulerState(obj);
  } catch (err) {
    logger.warn({ err }, "Failed to persist scheduler state");
  }
}

async function runDueTriggers(): Promise<void> {
  await ensureStateLoaded();
  const agents = await listDeployedAgents();
  const now = new Date();
  for (const agent of agents) {
    if (agent.paused) continue;
    for (const trig of agent.blueprint.triggers) {
      if (!trig.cron) continue;
      const tz = trig.timezone ?? "UTC";
      const key = `${agent.id}::${trig.id}`;
      const minuteBucket = Math.floor(now.getTime() / 60_000);
      if (lastFired.get(key) === minuteBucket) continue;
      let matches = false;
      try {
        matches = cronMatches(trig.cron, now, tz);
      } catch (err) {
        logger.warn(
          { err, agent: agent.id, trig: trig.id },
          "cron parse failed",
        );
        continue;
      }
      if (!matches) continue;
      const task = trig.task ?? trig.description;
      logger.info({ agent: agent.id, trig: trig.id }, "Trigger firing");
      const started = await startRun(agent, task, "cron", trig);
      if (!started.started) {
        // Don't mark this minute as fired — let the next tick try again
        // once the in-flight run completes (the agent may still match
        // before the minute rolls over).
        logger.info(
          { agent: agent.id, trig: trig.id, current: started.current_run_id },
          "Cron trigger skipped — another run is already in progress",
        );
        continue;
      }
      // Only mark fired *after* the run was successfully started.
      lastFired.set(key, minuteBucket);
      await persistLastFired();
      void started.promise
        .then(() => {
          void updateDeployment(agent.id, { last_run_at: Date.now() });
        })
        .catch((err) => {
          logger.error({ err, agent: agent.id }, "Run failed");
        });
    }
  }
}

export async function startScheduler(): Promise<void> {
  if (timer) return;
  await ensureStateLoaded();
  // Reconcile any runs left mid-flight by a previous server restart
  // before we start ticking, so the UI never shows phantom forever-running runs.
  try {
    const reconciled = await reconcileOrphanRuns();
    if (reconciled > 0) {
      logger.info({ reconciled }, "Reconciled orphaned runs on boot");
    }
  } catch (err) {
    logger.warn({ err }, "Failed to reconcile orphaned runs");
  }
  timer = setInterval(() => {
    void runDueTriggers();
  }, 30_000);
  logger.info("Trigger scheduler started (30s tick)");
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export interface RunNowResponse {
  run_id: string;
  ok: boolean;
  summary: string;
  status?: "running" | "succeeded" | "failed" | "timed_out";
  already_running?: boolean;
  error?: string;
}

export async function runAgentNow(
  agentId: string,
  taskOverride?: string,
): Promise<RunNowResponse> {
  const agent = await getDeployedAgent(agentId);
  if (!agent) throw new Error("Agent not found");
  const task =
    taskOverride ??
    agent.blueprint.triggers[0]?.task ??
    agent.blueprint.triggers[0]?.description ??
    "Do your job now.";
  const started = await startRun(agent, task, "manual");
  if (!started.started) {
    return {
      run_id: started.current_run_id,
      ok: false,
      summary: "",
      already_running: true,
      error: "This assistant is already running. Wait for the current run to finish.",
    };
  }
  // Don't block the response on the full run — the activity stream surfaces progress.
  // Persist last_run_at when the run completes.
  void started.promise
    .then(() => updateDeployment(agentId, { last_run_at: Date.now() }))
    .catch(() => {
      // Errors are already recorded on the run record + activity log.
    });
  return {
    run_id: started.run.id,
    ok: true,
    summary: "",
    status: "running",
  };
}

export function describeNextRun(agent: DeployedAgent): string {
  const trig = agent.blueprint.triggers.find((t) => t.cron);
  if (!trig) return "On demand";
  return `Next: ${describeCron(trig.cron, trig.timezone)}`;
}

export function describeTrigger(t: BlueprintTrigger): string {
  if (t.cron) return `${describeCron(t.cron, t.timezone)} — ${t.description}`;
  return t.description;
}
