import type Anthropic from "@anthropic-ai/sdk";

export interface IntegrationDefinition {
  id: string;
  connector_name: string;
  name: string;
  label: string;
  description: string;
  brand_color: string;
}

export interface PrimitiveContext {
  connector_name: string;
  log: (msg: string, details?: Record<string, unknown>) => void;
}

export interface PrimitiveResult {
  summary: string;
  data?: unknown;
}

export interface IntegrationPrimitive {
  name: string;
  integration_id: string;
  label: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
  handler: (
    input: Record<string, unknown>,
    ctx: PrimitiveContext,
  ) => Promise<PrimitiveResult>;
}
