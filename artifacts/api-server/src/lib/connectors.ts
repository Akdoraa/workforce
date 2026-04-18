import { ReplitConnectors, type Connection } from "@replit/connectors-sdk";

const sdk = new ReplitConnectors();

const cache = new Map<string, { item: Connection | null; expires: number }>();

export interface ConnectorAccount {
  connected: boolean;
  identity: string | null;
  display_name: string | null;
  raw?: Connection;
  error?: string;
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

export async function getConnectorAccount(
  connectorName: string,
): Promise<ConnectorAccount> {
  try {
    const item = await fetchConnection(connectorName);
    if (!item) return { connected: false, identity: null, display_name: null };
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
    return { connected: true, identity, display_name, raw: item };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      connected: false,
      identity: null,
      display_name: null,
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
  if (connectorName) cache.delete(connectorName);
  else cache.clear();
}
