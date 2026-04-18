import { GMAIL_INTEGRATION, GMAIL_PRIMITIVES } from "./gmail";
import { HUBSPOT_INTEGRATION, HUBSPOT_PRIMITIVES } from "./hubspot";
import { STRIPE_INTEGRATION, STRIPE_PRIMITIVES } from "./stripe";
import type { IntegrationDefinition, IntegrationPrimitive } from "./types";

export type { IntegrationDefinition, IntegrationPrimitive } from "./types";

export const INTEGRATIONS: IntegrationDefinition[] = [
  GMAIL_INTEGRATION,
  HUBSPOT_INTEGRATION,
  STRIPE_INTEGRATION,
];

export const PRIMITIVES: IntegrationPrimitive[] = [
  ...GMAIL_PRIMITIVES,
  ...HUBSPOT_PRIMITIVES,
  ...STRIPE_PRIMITIVES,
];

export function findIntegration(id: string): IntegrationDefinition | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}

export function findPrimitive(name: string): IntegrationPrimitive | undefined {
  return PRIMITIVES.find((p) => p.name === name);
}

export function listPrimitivesByIntegration(
  integrationId: string,
): IntegrationPrimitive[] {
  return PRIMITIVES.filter((p) => p.integration_id === integrationId);
}

export function describeRegistryForBuilder(): string {
  const lines: string[] = [];
  for (const integ of INTEGRATIONS) {
    lines.push(
      `### ${integ.id} — ${integ.name} (${integ.label})\n${integ.description}\nPrimitives:`,
    );
    for (const p of listPrimitivesByIntegration(integ.id)) {
      lines.push(`  - ${p.name}: ${p.description}`);
    }
  }
  return lines.join("\n");
}
