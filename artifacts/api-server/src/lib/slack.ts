import { fetchConnectionSettingsWithSecrets } from "./connectors";

export async function getSlackToken(): Promise<string> {
  // Always re-read the underlying settings so a reconnect (or a token
  // rotation) takes effect on the very next call. The connectors SDK's
  // `listConnections` strips secret material, so we go through the
  // shared `include_secrets=true` helper instead.
  const settings = await fetchConnectionSettingsWithSecrets("slack");
  if (!settings) {
    throw new Error(
      "Slack isn't connected — connect it on the Connections screen and run again.",
    );
  }
  const token =
    (settings["access_token"] as string | undefined) ??
    (settings["bot_token"] as string | undefined) ??
    (settings["token"] as string | undefined) ??
    (settings["oauth_token"] as string | undefined) ??
    null;
  if (!token) {
    throw new Error(
      "Slack credentials missing from the connection — please reconnect Slack on the Connections screen.",
    );
  }
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
    throw new Error(`Slack ${method} error: ${data.error ?? "unknown"}`);
  }
  return data as T;
}
