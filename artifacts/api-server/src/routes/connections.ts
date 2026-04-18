import { Router, type IRouter } from "express";
import { clearConnectionCache, getConnectorAccount } from "../lib/connectors";
import { INTEGRATIONS, findIntegration } from "../lib/registry";
import type { IntegrationDefinition } from "../lib/registry";
import { resetStripeClient } from "../lib/registry/stripe";

const router: IRouter = Router();

async function buildStatus(
  integ: IntegrationDefinition,
  opts: { force?: boolean; maxAgeMs?: number } = {},
) {
  // For the Connections page we trust Replit's connector listing as the
  // sole source of truth: presence = connected, absence = not connected.
  // Scope probing is deliberately omitted here — it can drift from what
  // Replit shows and is not needed for the MVP display.
  const acct = await getConnectorAccount(integ.connector_name, {
    force: opts.force,
    maxAgeMs: opts.maxAgeMs,
  });
  return {
    id: integ.id,
    name: integ.name,
    label: integ.label,
    brand_color: integ.brand_color,
    connector_name: integ.connector_name,
    connected: acct.connected,
    unreachable: acct.unreachable ?? false,
    identity: acct.identity,
    display_name: acct.display_name,
    needs_reauthorization: false,
    missing_scopes: [],
    reauthorization_message: undefined,
    error: acct.error,
  };
}

async function buildAllSerialized(opts: {
  force?: boolean;
  maxAgeMs?: number;
}) {
  // The Replit connectors API rate-limits bursts. Issuing 9 parallel
  // listConnections calls trips a 429 and surfaces every row as
  // "Couldn't reach …". Walk the integrations sequentially instead — it
  // adds a few hundred ms total but keeps the UI honest.
  const results = [];
  for (const integ of INTEGRATIONS) {
    results.push(await buildStatus(integ, opts));
  }
  return results;
}

router.get("/connections", async (req, res) => {
  // The Connections screen polls every few seconds and wants near-live data.
  // `?fresh=1` bypasses the cache entirely; otherwise we honor a short
  // freshness window so external changes (e.g. user toggled a connection in
  // another tab) show up within seconds instead of a full minute.
  const fresh = req.query.fresh === "1" || req.query.fresh === "true";
  const opts = fresh ? { force: true } : { maxAgeMs: 3_000 };
  const results = await buildAllSerialized(opts);
  res.json({ connections: results });
});

router.get("/connections/:id", async (req, res) => {
  const integ = findIntegration(req.params.id);
  if (!integ) {
    res.status(404).json({ error: "Unknown integration" });
    return;
  }
  res.json(await buildStatus(integ));
});

/**
 * Drop our cached view of every connection and return the freshly
 * re-fetched list in one round trip. The Connections screen calls this
 * after the Replit settings popup closes, because the popup is a single
 * page where the user can change *any* connection — not just the one row
 * whose button they clicked.
 */
router.post("/connections/refresh", async (_req, res) => {
  clearConnectionCache();
  const results = await buildAllSerialized({ force: true });
  res.json({ connections: results });
});

/**
 * Clear our cached view of one connection and re-read it from the
 * connectors SDK. Kept for callers that only need to refresh a single row.
 */
router.post("/connections/:id/refresh", async (req, res) => {
  const integ = findIntegration(req.params.id);
  if (!integ) {
    res.status(404).json({ error: "Unknown integration" });
    return;
  }
  clearConnectionCache(integ.connector_name);
  // Reset module-level cached SDK clients whose underlying credentials
  // could now be different (e.g. a reconnected Stripe account swaps the
  // secret key). Without this the next agent run would still call
  // Stripe with the old key.
  if (integ.id === "stripe") resetStripeClient();
  res.json(await buildStatus(integ, { force: true }));
});

export default router;
