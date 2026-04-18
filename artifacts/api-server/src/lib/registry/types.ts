import type Anthropic from "@anthropic-ai/sdk";

export interface IntegrationDefinition {
  id: string;
  connector_name: string;
  name: string;
  label: string;
  description: string;
  brand_color: string;
  /**
   * OAuth scopes the integration's primitives need in order to function.
   * If a granted connection is missing any of these (and none of their
   * documented equivalents), it should be treated as needing reauthorization.
   */
  required_scopes?: string[];
  /**
   * Other scope strings that satisfy the same capability as one of the
   * required scopes (e.g. `gmail.modify` or `mail.google.com` cover the
   * read access provided by `gmail.readonly`). Connections holding any of
   * these are considered authorized.
   */
  scope_equivalents?: Record<string, string[]>;
  /**
   * A lightweight probe to verify the connected account actually has the
   * scopes the integration's primitives need. We can't always read the
   * granted scope list directly through the connectors SDK, so we hit a
   * known endpoint and treat a 4xx response as "needs reauthorization".
   * The probe path is sent through the connector proxy.
   */
  scope_probe?: {
    path: string;
    method?: string;
    /**
     * Optional JSON body for write-method probes. Use a syntactically
     * valid but no-op body (e.g. `{"requests":[]}` for batchUpdate)
     * so the API checks scope and resource existence but performs no
     * mutation. With a write-capable scope and a sentinel id, the
     * endpoint returns 404 (treated as scope-ok). Without the right
     * scope it returns 403 with ACCESS_TOKEN_SCOPE_INSUFFICIENT.
     */
    body?: unknown;
    /**
     * If true, a 404 response from the probe is treated as scope-ok.
     * Use this for sentinel-id probes where reaching a 404 means the
     * auth/scope checks already passed (e.g. POSTing to
     * `/v4/spreadsheets/0:batchUpdate`). Off by default so a typo'd
     * probe path can't silently mask a real auth failure.
     */
    treat_404_as_ok?: boolean;
  };
}

export interface PrimitiveContext {
  connector_name: string;
  log: (msg: string, details?: Record<string, unknown>) => void;
  /**
   * Aborts when the run is being terminated (per-tool timeout, run
   * wall-clock timeout, or upstream failure). Long-running handlers
   * (e.g. fetch, polling) should pass this through so work is actually
   * cancelled rather than only un-awaited.
   */
  signal?: AbortSignal;
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
