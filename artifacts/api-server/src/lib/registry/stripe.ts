import Stripe from "stripe";
import { getStripeKeys } from "../connectors";
import type { IntegrationDefinition, IntegrationPrimitive } from "./types";

export const STRIPE_INTEGRATION: IntegrationDefinition = {
  id: "stripe",
  connector_name: "stripe",
  name: "Stripe",
  label: "your payments",
  description: "Read charges, balance, and customers; issue refunds.",
  brand_color: "#635bff",
};

let cached: Stripe | null = null;
let cachedSecretKey: string | null = null;
async function client(): Promise<Stripe> {
  // Always re-read the connection secret. If it changed (user reconnected
  // a different Stripe account, or rotated the key), build a fresh SDK
  // client so the next API call hits the new account immediately.
  const { secretKey } = await getStripeKeys({ force: cached === null });
  if (!cached || cachedSecretKey !== secretKey) {
    cached = new Stripe(secretKey, { apiVersion: "2025-11-17.clover" });
    cachedSecretKey = secretKey;
  }
  return cached;
}

export function resetStripeClient() {
  cached = null;
  cachedSecretKey = null;
}

export async function getStripeClient(): Promise<Stripe> {
  return client();
}

// Smallest stable money formatter. Uses Intl when the currency code is a
// valid ISO-4217 string, otherwise falls back to "<amount> <CODE>".
function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export const STRIPE_PRIMITIVES: IntegrationPrimitive[] = [
  {
    name: "stripe_list_charges",
    integration_id: "stripe",
    label: "List charges",
    description:
      "List recent Stripe charges. By default returns ONLY succeeded charges (set succeeded_only=false to include failed/pending). Always returns exactly `limit` items when enough are available, so callers don't need to filter or truncate.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 10 },
        succeeded_only: { type: "boolean", default: true },
      },
    },
    async handler(input, ctx) {
      const limit = Math.min(Math.max(Number(input["limit"] ?? 10), 1), 100);
      const succeededOnly = input["succeeded_only"] !== false;
      const stripe = await client();
      // When filtering to succeeded, pull a larger window so the
      // post-filter count still reaches `limit` even if a few recent
      // charges failed or were refunded.
      const fetchSize = Math.min(succeededOnly ? limit * 3 : limit, 100);
      const result = await stripe.charges.list({ limit: fetchSize });
      const all = result.data.map((c) => ({
        id: c.id,
        amount: c.amount,
        amount_decimal: (c.amount / 100).toFixed(2),
        currency: c.currency,
        status: c.status,
        paid: c.paid,
        refunded: c.refunded,
        customer_email:
          c.billing_details?.email ?? c.receipt_email ?? null,
        created_iso: new Date(c.created * 1000).toISOString(),
      }));
      const filtered = succeededOnly
        ? all.filter((d) => d.status === "succeeded")
        : all;
      const data = filtered.slice(0, limit);
      // Compute totals per currency so callers (e.g. revenue summary
      // emails) get a deterministic, code-formatted figure instead of
      // having to sum cents themselves.
      const totalsByCurrency = new Map<string, number>();
      for (const d of data) {
        totalsByCurrency.set(
          d.currency,
          (totalsByCurrency.get(d.currency) ?? 0) + d.amount,
        );
      }
      const totals = Array.from(totalsByCurrency.entries()).map(
        ([currency, cents]) => ({
          currency,
          amount_cents: cents,
          amount_decimal: (cents / 100).toFixed(2),
          formatted: formatMoney(cents, currency),
        }),
      );
      ctx.log(
        `Read ${data.length} ${succeededOnly ? "succeeded " : ""}charges from Stripe.`,
      );
      return {
        summary: `Read ${data.length} ${succeededOnly ? "succeeded " : ""}charges${
          totals.length === 1 ? ` totaling ${totals[0]!.formatted}` : ""
        }.`,
        data: { charges: data, totals },
      };
    },
  },
];
