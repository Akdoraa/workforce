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
async function client(): Promise<Stripe> {
  if (cached) return cached;
  const { secretKey } = await getStripeKeys();
  cached = new Stripe(secretKey, { apiVersion: "2025-11-17.clover" });
  return cached;
}

export function resetStripeClient() {
  cached = null;
}

export async function getStripeClient(): Promise<Stripe> {
  return client();
}

export const STRIPE_PRIMITIVES: IntegrationPrimitive[] = [
  {
    name: "stripe_list_charges",
    integration_id: "stripe",
    label: "List charges",
    description: "List recent charges from Stripe.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 10 },
      },
    },
    async handler(input, ctx) {
      const limit = Math.min(Number(input["limit"] ?? 10), 100);
      const stripe = await client();
      const result = await stripe.charges.list({ limit });
      ctx.log(`Read ${result.data.length} recent charges from Stripe.`);
      return {
        summary: `Read ${result.data.length} recent charges.`,
        data: result.data.map((c) => ({
          id: c.id,
          amount: c.amount,
          currency: c.currency,
          status: c.status,
          paid: c.paid,
          refunded: c.refunded,
        })),
      };
    },
  },
];
