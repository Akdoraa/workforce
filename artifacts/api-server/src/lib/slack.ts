interface ConnectorItem {
  settings?: Record<string, unknown>;
}

let cachedToken: { token: string; fetchedAt: number } | null = null;

async function getReplitConnectorToken(connectorName: string): Promise<string> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;
  if (!hostname) throw new Error("REPLIT_CONNECTORS_HOSTNAME missing");
  if (!xReplitToken) throw new Error("X-Replit-Token not found");

  const isProduction = process.env.REPLIT_DEPLOYMENT === "1";
  const targetEnvironment = isProduction ? "production" : "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", connectorName);
  url.searchParams.set("environment", targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Replit-Token": xReplitToken,
    },
  });
  if (!response.ok) {
    throw new Error(`Replit connector lookup failed: ${response.status}`);
  }
  const data = (await response.json()) as { items?: ConnectorItem[] };
  const item = data.items?.[0];
  const settings = item?.settings ?? {};
  // Try common field names — different connectors use different keys.
  const token =
    (settings["access_token"] as string | undefined) ??
    (settings["bot_token"] as string | undefined) ??
    (settings["token"] as string | undefined) ??
    (settings["oauth_token"] as string | undefined) ??
    null;
  if (!token) {
    throw new Error(
      `Connector ${connectorName} returned no usable token. Keys: ${Object.keys(settings).join(",")}`,
    );
  }
  return token;
}

export async function getSlackToken(): Promise<string> {
  if (cachedToken && Date.now() - cachedToken.fetchedAt < 30 * 60 * 1000) {
    return cachedToken.token;
  }
  const token = await getReplitConnectorToken("slack");
  cachedToken = { token, fetchedAt: Date.now() };
  return token;
}

export async function slackApi<T>(
  method: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const token = await getSlackToken();
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Slack ${method} HTTP ${res.status}`);
  const data = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!data.ok) {
    // Force a token refresh next call in case it expired.
    cachedToken = null;
    throw new Error(`Slack ${method} error: ${data.error ?? "unknown"}`);
  }
  return data as T;
}
