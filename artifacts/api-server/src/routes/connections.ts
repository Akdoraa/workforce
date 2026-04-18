import { Router, type IRouter } from "express";
import { getConnectorAccount } from "../lib/connectors";
import { INTEGRATIONS, findIntegration } from "../lib/registry";

const router: IRouter = Router();

router.get("/connections", async (_req, res) => {
  const results = await Promise.all(
    INTEGRATIONS.map(async (integ) => {
      const acct = await getConnectorAccount(integ.connector_name);
      return {
        id: integ.id,
        name: integ.name,
        label: integ.label,
        brand_color: integ.brand_color,
        connected: acct.connected,
        identity: acct.identity,
        display_name: acct.display_name,
        error: acct.error,
      };
    }),
  );
  res.json({ connections: results });
});

router.get("/connections/:id", async (req, res) => {
  const integ = findIntegration(req.params.id);
  if (!integ) {
    res.status(404).json({ error: "Unknown integration" });
    return;
  }
  const acct = await getConnectorAccount(integ.connector_name);
  res.json({
    id: integ.id,
    name: integ.name,
    label: integ.label,
    brand_color: integ.brand_color,
    connected: acct.connected,
    identity: acct.identity,
    display_name: acct.display_name,
    error: acct.error,
  });
});

export default router;
