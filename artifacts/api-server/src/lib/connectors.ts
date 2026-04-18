import { ReplitConnectors, type Connection } from "@replit/connectors-sdk";

const sdk = new ReplitConnectors();

const cache = new Map<string, { item: Connection | null; expires: number }>();

export interface ConnectorAccount {
  connected: boolean;
  identity: string | null;
  display_name: string | null;
  granted_scopes: string[];
  missing_scopes: string[];
  needs_reauthorization: boolean;
  raw?: Connection;
  error?: string;
}

function extractGrantedScopes(item: Connection): string[] {
  const settings = (item["settings"] ?? {}) as Record<string, unknown>;
  const oauth = (settings["oauth"] ?? {}) as Record<string, unknown>;
  const credentials = (oauth["credentials"] ?? {}) as Record<string, unknown>;
  const scope =
    (credentials["scope"] as string | undefined) ??
    (settings["scope"] as string | undefined);
  if (!scope) return [];
  return scope
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function computeMissingScopes(
  granted: string[],
  required: string[] | undefined,
  equivalents: Record<string, string[]> | undefined,
): string[] {
  if (!required || required.length === 0) return [];
  const have = new Set(granted);
  const missing: string[] = [];
  for (const scope of required) {
    if (have.has(scope)) continue;
    const alts = equivalents?.[scope] ?? [];
    if (alts.some((a) => have.has(a))) continue;
    missing.push(scope);
  }
  return missing;
}

export async function fetchConnection(
  connectorName: string,
  opts: { force?: boolean } = {},
): Promise<Connection | null> {
  const cached = cache.get(connectorName);
  if (!opts.force && cached && cached.expires > Date.now()) return cached.item;
  const items = await sdk.listConnections({ connector_names: connectorName });
  const item = items[0] ?? null;
  cache.set(connectorName, { item, expires: Date.now() + 60_000 });
  return item;
}

interface ProbeResult {
  ok: boolean;
  status: number;
  scope_insufficient: boolean;
}

const probeCache = new Map<string, { result: ProbeResult; expires: number }>();

async function runScopeProbe(
  connectorName: string,
  probe: { path: string; method?: string },
): Promise<ProbeResult> {
  const key = `${connectorName}::${probe.method ?? "GET"} ${probe.path}`;
  const cached = probeCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  let result: ProbeResult;
  try {
    const res = await sdk.proxy(connectorName, probe.path, {
      method: probe.method ?? "GET",
    });
    if (res.ok) {
      result = { ok: true, status: res.status, scope_insufficient: false };
    } else {
      const body = (await res.text()).toLowerCase();
      const insufficient =
        res.status === 403 &&
        (body.includes("access_token_scope_insufficient") ||
          body.includes("insufficient permission") ||
          body.includes("insufficient authentication scopes") ||
          body.includes("insufficientpermissions"));
      result = {
        ok: false,
        status: res.status,
        scope_insufficient: insufficient,
      };
    }
  } catch {
    // If the probe itself crashes, don't flag the connection as bad — let the
    // primitives surface their own errors.
    result = { ok: true, status: 0, scope_insufficient: false };
  }
  probeCache.set(key, { result, expires: Date.now() + 60_000 });
  return result;
}

export async function getConnectorAccount(
  connectorName: string,
  opts: {
    required_scopes?: string[];
    scope_equivalents?: Record<string, string[]>;
    scope_probe?: { path: string; method?: string };
  } = {},
): Promise<ConnectorAccount> {
  try {
    const item = await fetchConnection(connectorName);
    if (!item) {
      return {
        connected: false,
        identity: null,
        display_name: null,
        granted_scopes: [],
        missing_scopes: opts.required_scopes ?? [],
        needs_reauthorization: false,
      };
    }
    const meta = (item.metadata ?? {}) as Record<string, unknown>;
    const identity =
      (item["identity"] as string | undefined) ??
      (meta["email"] as string | undefined) ??
      (meta["account_name"] as string | undefined) ??
      null;
    const display_name =
      (item["display_name"] as string | undefined) ??
      (meta["display_name"] as string | undefined) ??
      identity;

    // Try to parse a granted scope list when the SDK exposes one. The
    // connectors SDK strips `settings.oauth.credentials.scope` for some
    // connectors (notably google-mail), so we treat the parsed list as a
    // *hint* and let the live probe be authoritative when one is
    // configured.
    const granted = extractGrantedScopes(item);
    const scopeKnown = granted.length > 0;
    const parsedMissing = computeMissingScopes(
      granted,
      opts.required_scopes,
      opts.scope_equivalents,
    );

    let missing: string[];
    let needsReauth: boolean;
    if (opts.scope_probe) {
      // The probe actually exercises a scoped endpoint, so its result is
      // the source of truth. Only treat parsed scope mismatches as
      // authoritative when the SDK actually returned a scope list.
      const probe = await runScopeProbe(connectorName, opts.scope_probe);
      if (probe.scope_insufficient) {
        needsReauth = true;
        missing = parsedMissing.length
          ? parsedMissing
          : opts.required_scopes
            ? [...opts.required_scopes]
            : [];
      } else if (probe.ok) {
        // The probe succeeded — the account can do what we need, even if
        // the SDK didn't expose every scope it actually has.
        needsReauth = false;
        missing = [];
      } else {
        // Probe failed for some other reason (e.g. transient 5xx, network).
        // Don't flip the connection into "needs reauthorization" off a
        // non-scope error; fall back to whatever we could parse.
        needsReauth = scopeKnown && parsedMissing.length > 0;
        missing = scopeKnown ? parsedMissing : [];
      }
    } else {
      needsReauth = scopeKnown && parsedMissing.length > 0;
      missing = scopeKnown ? parsedMissing : [];
    }

    return {
      connected: true,
      identity,
      display_name,
      granted_scopes: granted,
      missing_scopes: missing,
      needs_reauthorization: needsReauth,
      raw: item,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      connected: false,
      identity: null,
      display_name: null,
      granted_scopes: [],
      missing_scopes: opts.required_scopes ?? [],
      needs_reauthorization: false,
      error: message,
    };
  }
}

/**
 * Make an authenticated request through the Replit connector proxy.
 * The SDK handles tokens, refresh, and auth headers transparently.
 */
export async function connectorFetch(
  connectorName: string,
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  return sdk.proxy(connectorName, path, init);
}

export async function getStripeKeys(): Promise<{
  publishableKey: string;
  secretKey: string;
}> {
  const item = await fetchConnection("stripe");
  const settings = (item?.["settings"] ?? {}) as Record<string, unknown>;
  const publishable =
    (settings["publishable"] as string | undefined) ??
    (settings["publishable_key"] as string | undefined);
  const secret =
    (settings["secret"] as string | undefined) ??
    (settings["secret_key"] as string | undefined) ??
    (settings["api_key"] as string | undefined);
  if (!publishable || !secret) {
    throw new Error("Stripe connection not found");
  }
  return { publishableKey: publishable, secretKey: secret };
}

export function clearConnectionCache(connectorName?: string): void {
  if (connectorName) {
    cache.delete(connectorName);
    for (const key of probeCache.keys()) {
      if (key.startsWith(`${connectorName}::`)) probeCache.delete(key);
    }
  } else {
    cache.clear();
    probeCache.clear();
  }
}
