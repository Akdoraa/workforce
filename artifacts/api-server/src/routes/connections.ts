import { Router, type IRouter } from "express";
import { getConnectorAccount } from "../lib/connectors";
import { INTEGRATIONS, findIntegration } from "../lib/registry";

const router: IRouter = Router();

function reauthorizationMessage(integ: {
  name: string;
  label: string;
}): string {
  return `Reconnect to grant ${integ.name} access to ${integ.label}.`;
}

router.get("/connections", async (_req, res) => {
  const results = await Promise.all(
    INTEGRATIONS.map(async (integ) => {
      const acct = await getConnectorAccount(integ.connector_name, {
        required_scopes: integ.required_scopes,
        scope_equivalents: integ.scope_equivalents,
        scope_probe: integ.scope_probe,
      });
      return {
        id: integ.id,
        name: integ.name,
        label: integ.label,
        brand_color: integ.brand_color,
        connected: acct.connected,
        identity: acct.identity,
        display_name: acct.display_name,
        needs_reauthorization: acct.needs_reauthorization,
        missing_scopes: acct.missing_scopes,
        reauthorization_message: acct.needs_reauthorization
          ? reauthorizationMessage(integ)
          : undefined,
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
  const acct = await getConnectorAccount(integ.connector_name, {
    required_scopes: integ.required_scopes,
    scope_equivalents: integ.scope_equivalents,
    scope_probe: integ.scope_probe,
  });
  res.json({
    id: integ.id,
    name: integ.name,
    label: integ.label,
    brand_color: integ.brand_color,
    connected: acct.connected,
    identity: acct.identity,
    display_name: acct.display_name,
    needs_reauthorization: acct.needs_reauthorization,
    missing_scopes: acct.missing_scopes,
    reauthorization_message: acct.needs_reauthorization
      ? reauthorizationMessage(integ)
      : undefined,
    error: acct.error,
  });
});

export default router;
