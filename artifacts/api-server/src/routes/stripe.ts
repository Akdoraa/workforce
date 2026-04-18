import { Router, type IRouter } from "express";
import { getUncachableStripeClient } from "../lib/stripe";

const router: IRouter = Router();

router.get("/stripe/account", async (req, res) => {
  try {
    const stripe = await getUncachableStripeClient();
    const account = await stripe.accounts.retrieve();
    res.json({
      connected: true,
      account_id: account.id,
      email: account.email,
      business_name:
        account.business_profile?.name ?? account.settings?.dashboard?.display_name ?? null,
      country: account.country,
      default_currency: account.default_currency,
      livemode: !account.id.startsWith("acct_") ? false : !(account as { test_clock?: unknown }).test_clock,
      charges_enabled: account.charges_enabled,
      details_submitted: account.details_submitted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log?.warn({ err }, "Stripe account fetch failed");
    res.status(503).json({ connected: false, error: message });
  }
});

router.get("/stripe/balance", async (req, res) => {
  try {
    const stripe = await getUncachableStripeClient();
    const balance = await stripe.balance.retrieve();
    res.json({
      available: balance.available.map((b) => ({ amount: b.amount, currency: b.currency })),
      pending: balance.pending.map((b) => ({ amount: b.amount, currency: b.currency })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log?.warn({ err }, "Stripe balance fetch failed");
    res.status(503).json({ error: message });
  }
});

router.get("/stripe/charges", async (req, res) => {
  try {
    const stripe = await getUncachableStripeClient();
    const limit = Math.min(Number(req.query.limit ?? 12), 100);
    const charges = await stripe.charges.list({ limit });
    res.json({
      charges: charges.data.map((c) => ({
        id: c.id,
        amount: c.amount,
        currency: c.currency,
        status: c.status,
        paid: c.paid,
        refunded: c.refunded,
        amount_refunded: c.amount_refunded,
        disputed: c.disputed,
        created: c.created,
        description: c.description,
        receipt_email: c.receipt_email,
        customer_name:
          c.billing_details?.name ??
          (typeof c.customer === "string" ? c.customer : c.customer?.id ?? null),
        failure_message: c.failure_message,
        livemode: c.livemode,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log?.warn({ err }, "Stripe charges fetch failed");
    res.status(503).json({ error: message });
  }
});

router.get("/stripe/customers", async (req, res) => {
  try {
    const stripe = await getUncachableStripeClient();
    const limit = Math.min(Number(req.query.limit ?? 8), 100);
    const customers = await stripe.customers.list({ limit });
    res.json({
      customers: customers.data.map((c) => ({
        id: c.id,
        email: c.email,
        name: c.name,
        created: c.created,
        delinquent: c.delinquent,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log?.warn({ err }, "Stripe customers fetch failed");
    res.status(503).json({ error: message });
  }
});

router.post("/stripe/refund", async (req, res) => {
  try {
    const chargeId = String(req.body?.charge_id ?? "");
    if (!chargeId.startsWith("ch_") && !chargeId.startsWith("py_")) {
      res.status(400).json({ error: "Invalid charge_id" });
      return;
    }
    const stripe = await getUncachableStripeClient();
    const refund = await stripe.refunds.create({ charge: chargeId });
    res.json({
      id: refund.id,
      charge: refund.charge,
      amount: refund.amount,
      status: refund.status,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log?.warn({ err }, "Stripe refund failed");
    res.status(400).json({ error: message });
  }
});

export default router;
