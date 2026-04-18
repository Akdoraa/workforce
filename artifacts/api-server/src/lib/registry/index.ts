import { DOCS_INTEGRATION, DOCS_PRIMITIVES } from "./docs";
import { DRIVE_INTEGRATION, DRIVE_PRIMITIVES } from "./drive";
import { GMAIL_INTEGRATION, GMAIL_PRIMITIVES } from "./gmail";
import {
  GOOGLE_CALENDAR_INTEGRATION,
  GOOGLE_CALENDAR_PRIMITIVES,
} from "./google-calendar";
import { HUBSPOT_INTEGRATION, HUBSPOT_PRIMITIVES } from "./hubspot";
import { NOTION_INTEGRATION, NOTION_PRIMITIVES } from "./notion";
import { SHEETS_INTEGRATION, SHEETS_PRIMITIVES } from "./sheets";
import { SLACK_INTEGRATION, SLACK_PRIMITIVES } from "./slack";
import { STRIPE_INTEGRATION, STRIPE_PRIMITIVES } from "./stripe";
import type {
  IntegrationDefinition,
  IntegrationPrimitive,
  PrimitiveContext,
  PrimitiveResult,
} from "./types";
import {
  formatValidationErrors,
  validateAgainstSchema,
} from "./validate";

export type {
  IntegrationDefinition,
  IntegrationPrimitive,
  PrimitiveContext,
  PrimitiveResult,
} from "./types";
export {
  wrapExternalContent,
  EXTERNAL_CONTENT_SECURITY_RULE,
} from "./external";

export const INTEGRATIONS: IntegrationDefinition[] = [
  GMAIL_INTEGRATION,
  HUBSPOT_INTEGRATION,
  STRIPE_INTEGRATION,
  DRIVE_INTEGRATION,
  SHEETS_INTEGRATION,
  DOCS_INTEGRATION,
  NOTION_INTEGRATION,
  SLACK_INTEGRATION,
  GOOGLE_CALENDAR_INTEGRATION,
];

export const PRIMITIVES: IntegrationPrimitive[] = [
  ...GMAIL_PRIMITIVES,
  ...HUBSPOT_PRIMITIVES,
  ...STRIPE_PRIMITIVES,
  ...DRIVE_PRIMITIVES,
  ...SHEETS_PRIMITIVES,
  ...DOCS_PRIMITIVES,
  ...NOTION_PRIMITIVES,
  ...SLACK_PRIMITIVES,
  ...GOOGLE_CALENDAR_PRIMITIVES,
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

export class PrimitiveValidationError extends Error {
  constructor(
    message: string,
    public readonly details: string,
  ) {
    super(message);
    this.name = "PrimitiveValidationError";
  }
}

/**
 * Run a primitive after validating its input against the declared schema.
 * Validation failures throw a `PrimitiveValidationError` carrying a clean
 * message the executor can hand back to the LLM as a tool error.
 */
export async function invokePrimitive(
  prim: IntegrationPrimitive,
  input: Record<string, unknown>,
  ctx: PrimitiveContext,
): Promise<PrimitiveResult> {
  const errors = validateAgainstSchema(input, prim.input_schema);
  if (errors.length > 0) {
    const detail = formatValidationErrors(errors);
    throw new PrimitiveValidationError(
      `the tool '${prim.name}' was called with invalid arguments: ${detail}`,
      detail,
    );
  }
  return prim.handler(input, ctx);
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
