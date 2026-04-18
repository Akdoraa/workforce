import { Router, type IRouter } from "express";
import { Blueprint } from "@workspace/api-zod";
import {
  createDeployment,
  deleteDeployment,
  getCurrentRun,
  getDeployedAgent,
  getLastRun,
  listDeployedAgents,
  listRuns,
  readActivity,
  subscribeActivity,
  updateDeployment,
} from "../lib/runtime/store";
import { runAgentNow } from "../lib/runtime/scheduler";
import type { DeployedAgent } from "@workspace/api-zod";

async function enrichAgent(agent: DeployedAgent): Promise<DeployedAgent> {
  const [current, last] = await Promise.all([
    getCurrentRun(agent.id),
    getLastRun(agent.id),
  ]);
  return { ...agent, current_run: current, last_run: last };
}

const router: IRouter = Router();

router.post("/agents/:id/deploy", async (req, res) => {
  const blueprintRaw = req.body?.blueprint;
  const parsed = Blueprint.safeParse(blueprintRaw);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }
  const deployed = await createDeployment(parsed.data, req.params.id);
  res.json({
    deployment_id: deployed.id,
    url: deployed.blueprint.deployment?.url ?? "",
    agent: deployed,
  });
});

router.get("/agents", async (_req, res) => {
  const agents = await listDeployedAgents();
  const enriched = await Promise.all(agents.map(enrichAgent));
  res.json({ agents: enriched });
});

router.get("/agents/:id", async (req, res) => {
  const agent = await getDeployedAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ agent: await enrichAgent(agent) });
});

router.get("/agents/:id/runs", async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 25) || 25, 200);
  const runs = await listRuns(req.params.id, limit);
  res.json({ runs });
});

router.post("/agents/:id/pause", async (req, res) => {
  const updated = await updateDeployment(req.params.id, { paused: true });
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ agent: updated });
});

router.post("/agents/:id/resume", async (req, res) => {
  const updated = await updateDeployment(req.params.id, { paused: false });
  if (!updated) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ agent: updated });
});

router.delete("/agents/:id", async (req, res) => {
  const ok = await deleteDeployment(req.params.id);
  if (!ok) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ok: true });
});

router.post("/agents/:id/run", async (req, res) => {
  const task = req.body?.task ? String(req.body.task) : undefined;
  try {
    const result = await runAgentNow(req.params.id, task);
    if (result.already_running) {
      res.status(409).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ ok: false, error: msg });
  }
});

router.get("/agents/:id/activity", async (req, res) => {
  const events = await readActivity(req.params.id, 200);
  res.json({ events });
});

router.get("/agents/:id/activity/stream", async (req, res) => {
  const agent = await getDeployedAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const initial = await readActivity(req.params.id, 100);
  for (const evt of initial) {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  }

  const unsub = subscribeActivity(req.params.id, (evt) => {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  });

  const ping = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 15000);

  req.on("close", () => {
    clearInterval(ping);
    unsub();
    res.end();
  });
});

export default router;
