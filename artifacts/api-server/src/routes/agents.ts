import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { DeployAgentResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/agents/:id/deploy", async (req, res) => {
  const agentId = req.params.id;
  await new Promise((r) => setTimeout(r, 1500));
  const data = DeployAgentResponse.parse({
    deployment_id: `dep_${randomUUID().slice(0, 8)}`,
    url: `https://${agentId.slice(0, 6)}.openclaw-stub.app`,
  });
  res.json(data);
});

export default router;
