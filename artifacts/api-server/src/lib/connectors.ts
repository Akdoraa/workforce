import { ReplitConnectors, type Connection } from "@replit/connectors-sdk";

const sdk = new ReplitConnectors();

interface CacheEntry {
  item: Connection | null;
  /** Timestamp of last successful fetch — refresh allowed after expires. */
  expires: number;
  /** Last successful fetch was real (not synthesized from a stale value). */
  hasValue: boolean;
}

const cache = new Map<string, CacheEntry>();
// Dedupe concurrent fetches for the same connector so a burst of polls
// (one card per integration × multiple components × every 5s) doesn't
// fan out into N parallel calls to the connectors API and trip its
// 429 rate limit.
const inflight = new Map<string, Promise<Connection | null>>();

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

const CACHE_TTL_MS = 60_000;

export async function fetchConnection(
  connectorName: string,
  opts: { force?: boolean; maxAgeMs?: number } = {},
): Promise<Connection | null> {
  const cached = cache.get(connectorName);
  if (!opts.force && cached && cached.expires > Date.now()) {
    if (opts.maxAgeMs === undefined) return cached.item;
    // Honor a tighter freshness window for callers that want near-live data
    // (e.g. the foreground poll on the Connections screen).
    const age = Date.now() - (cached.expires - CACHE_TTL_MS);
    if (age <= opts.maxAgeMs) return cached.item;
  }

  // Dedupe in-flight fetches: if a refresh for this connector is already
  // in progress, every other caller waits for it instead of issuing a
  // parallel SDK call. This is what protects us from the connectors API
  // 429 rate limit when many components mount at once.
  const pending = inflight.get(connectorName);
  if (pending) return pending;

  const promise = (async () => {
    try {
      let items;
      try {
        items = await sdk.listConnections({ connector_names: connectorName });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // The connectors API rate-limits aggressively when many lookups
        // arrive in the same burst. Wait a beat and retry once before
        // giving up — almost always succeeds on the second try.
        if (/429|too many requests/i.test(msg)) {
          await new Promise((r) => setTimeout(r, 750));
          items = await sdk.listConnections({
            connector_names: connectorName,
          });
        } else if (/\b401\b|unauthorized/i.test(msg)) {
          // 401 from listConnections means the current user simply hasn't
          // authorized this connector yet. That's "Not connected", not a
          // server error — surface it as such instead of "Couldn't reach …".
          items = [];
        } else {
          throw err;
        }
      }
      const item = items[0] ?? null;
      cache.set(connectorName, {
        item,
        expires: Date.now() + CACHE_TTL_MS,
        hasValue: true,
      });
      return item;
    } catch (err) {
      // Stale-while-revalidate: if we ever had a successful fetch for
      // this connector, return that instead of bubbling the error. The
      // connectors infra rate-limits aggressively (429), and there's no
      // reason to flip a connected account to "Couldn't reach …" just
      // because the latest poll got throttled. Set a short TTL so we
      // retry soon.
      if (cached && cached.hasValue) {
        cache.set(connectorName, {
          item: cached.item,
          expires: Date.now() + 5_000,
          hasValue: true,
        });
        return cached.item;
      }
      throw err;
    } finally {
      inflight.delete(connectorName);
    }
  })();
  inflight.set(connectorName, promise);
  return promise;
}

/**
 * Connector-presence probe used by the run preflight. We deliberately
 * do NOT collapse all errors into "not connected" — a transient failure
 * looking up the connection (network error, 5xx from the connectors
 * service) must surface as a transient error so we tell the user the
 * truth instead of asking them to reconnect a perfectly good account.
 *
 * Returns:
 *   { connected: true }  — connection exists.
 *   { connected: false } — SDK responded successfully and there is no
 *                          connection for this connector.
 *   throws               — lookup itself failed; caller should treat as
 *                          transient infrastructure failure, not as a
 *                          missing connection.
 *
 * Always bypasses the in-memory cache so a freshly-connected account is
 * seen immediately.
 */
export async function isConnectorConnected(
  connectorName: string,
): Promise<{ connected: boolean }> {
  const item = await fetchConnection(connectorName, { force: true });
  return { connected: item != null };
}

interface ProbeResult {
  ok: boolean;
  status: number;
  scope_insufficient: boolean;
}

const probeCache = new Map<string, { result: ProbeResult; expires: number }>();

async function runScopeProbe(
  connectorName: string,
  probe: {
    path: string;
    method?: string;
    body?: unknown;
    treat_404_as_ok?: boolean;
  },
  opts: { force?: boolean } = {},
): Promise<ProbeResult> {
  const key = `${connectorName}::${probe.method ?? "GET"} ${probe.path}`;
  const cached = probeCache.get(key);
  if (!opts.force && cached && cached.expires > Date.now()) return cached.result;
  let result: ProbeResult;
  let cacheable = true;
  try {
    const proxyInit: { method: string; body?: string; headers?: Record<string, string> } = {
      method: probe.method ?? "GET",
    };
    if (probe.body !== undefined) {
      proxyInit.body = JSON.stringify(probe.body);
      proxyInit.headers = { "Content-Type": "application/json" };
    }
    const res = await sdk.proxy(connectorName, probe.path, proxyInit);
    if (res.ok) {
      result = { ok: true, status: res.status, scope_insufficient: false };
    } else if (res.status === 404 && probe.treat_404_as_ok) {
      // Sentinel-id probes (e.g. `POST /v4/spreadsheets/0:batchUpdate`)
      // intentionally hit a non-existent resource so the API performs
      // its auth/scope check and then 404s. Only treat 404 as scope-ok
      // when the probe explicitly opts in — otherwise a typo'd probe
      // path could silently mask a real auth failure.
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
      // Only cache real auth signals. Transient failures (5xx, rate limits,
      // network blips) shouldn't be pinned for 60s — the next poll should
      // retry.
      if (!insufficient) cacheable = false;
    }
  } catch {
    // If the probe itself crashes, don't flag the connection as bad — let the
    // primitives surface their own errors. Don't cache the synthesized
    // success either; the next poll should re-attempt the probe.
    result = { ok: true, status: 0, scope_insufficient: false };
    cacheable = false;
  }
  if (cacheable) {
    probeCache.set(key, { result, expires: Date.now() + 60_000 });
  } else {
    probeCache.delete(key);
  }
  return result;
}

export async function getConnectorAccount(
  connectorName: string,
  opts: {
    required_scopes?: string[];
    scope_equivalents?: Record<string, string[]>;
    scope_probe?: {
      path: string;
      method?: string;
      body?: unknown;
      treat_404_as_ok?: boolean;
    };
    force?: boolean;
    maxAgeMs?: number;
  } = {},
): Promise<ConnectorAccount> {
  try {
    const item = await fetchConnection(connectorName, {
      force: opts.force,
      maxAgeMs: opts.maxAgeMs,
    });
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
      const probe = await runScopeProbe(connectorName, opts.scope_probe, {
        force: opts.force,
      });
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

/**
 * Fetch a connection's settings *with secrets included*. The connectors
 * SDK's `listConnections` strips secret material — including the Stripe
 * publishable/secret keys — so we have to hit the connection-API REST
 * endpoint directly with `include_secrets=true`. We do this only on the
 * read path that needs raw credentials (e.g. building a Stripe SDK
 * client) so secrets aren't pulled into memory more than necessary.
 */
export async function fetchConnectionSettingsWithSecrets(
  connectorName: string,
): Promise<Record<string, unknown> | null> {
  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  const xReplitToken = process.env["REPL_IDENTITY"]
    ? `repl ${process.env["REPL_IDENTITY"]}`
    : process.env["WEB_REPL_RENEWAL"]
      ? `depl ${process.env["WEB_REPL_RENEWAL"]}`
      : null;
  if (!hostname || !xReplitToken) {
    // Distinguish infra misconfiguration from "user hasn't connected
    // anything" — saying "Stripe isn't connected" when the runtime is
    // missing REPLIT_CONNECTORS_HOSTNAME / REPL_IDENTITY would point
    // the user at the wrong fix.
    throw new Error(
      "Connectors environment isn't configured (REPLIT_CONNECTORS_HOSTNAME / REPL_IDENTITY missing). This is a server-side configuration problem, not a connection problem.",
    );
  }
  const url = `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=${encodeURIComponent(connectorName)}`;
  const resp = await fetch(url, {
    headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) {
    throw new Error(
      `Connector lookup failed for ${connectorName}: ${resp.status} ${resp.statusText}`,
    );
  }
  const data = (await resp.json()) as {
    items?: Array<{ settings?: Record<string, unknown> }>;
  };
  const settings = data.items?.[0]?.settings;
  return settings ?? null;
}

export async function getStripeKeys(
  _opts: { force?: boolean } = {},
): Promise<{
  publishableKey: string;
  secretKey: string;
}> {
  // Always re-read the underlying settings — the SDK-level connection
  // cache holds the connection identity but NOT the credentials, so
  // there's nothing to invalidate here. The `force` parameter is kept
  // for backward compatibility but isn't needed.
  const settings = await fetchConnectionSettingsWithSecrets("stripe");
  if (!settings) {
    throw new Error(
      "Stripe isn't connected — connect it on the Connections screen and run again.",
    );
  }
  const oauth = (settings["oauth"] ?? {}) as Record<string, unknown>;
  const credentials = (oauth["credentials"] ?? {}) as Record<string, unknown>;
  const pickStr = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      const v = settings[k] ?? credentials[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };
  const publishable = pickStr(
    "publishable",
    "publishable_key",
    "publishableKey",
    "publishable_api_key",
    "pk",
    "pk_live",
    "pk_test",
  );
  const secret = pickStr(
    "secret",
    "secret_key",
    "secretKey",
    "api_key",
    "apiKey",
    "sk",
    "sk_live",
    "sk_test",
    "access_token",
  );
  if (!secret || !publishable) {
    throw new Error(
      "Stripe credentials missing from the connection — please reconnect Stripe on the Connections screen.",
    );
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
