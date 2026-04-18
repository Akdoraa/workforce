import { Router, type IRouter } from "express";
import { Blueprint } from "@workspace/api-zod";
import {
  createDeployment,
  deleteDeployment,
  getDeployedAgent,
  listDeployedAgents,
  readActivity,
  subscribeActivity,
  updateDeployment,
} from "../lib/runtime/store";
import { runAgentNow } from "../lib/runtime/scheduler";

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
  res.json({ agents });
});

router.get("/agents/:id", async (req, res) => {
  const agent = await getDeployedAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ agent });
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
