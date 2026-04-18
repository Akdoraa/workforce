import { getSlackToken, slackApi } from "../slack";
import type { IntegrationDefinition, IntegrationPrimitive } from "./types";

export const SLACK_INTEGRATION: IntegrationDefinition = {
  id: "slack",
  connector_name: "slack",
  name: "Slack",
  label: "your Slack workspace",
  description:
    "Post messages to channels and direct-message teammates in Slack.",
  brand_color: "#4a154b",
};

interface PostMessageResponse {
  ok: boolean;
  ts?: string;
  channel?: string;
  error?: string;
}

async function slackPost<T>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = await getSlackToken();
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Slack ${method} HTTP ${res.status}`);
  const data = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!data.ok) {
    throw new Error(`Slack ${method} error: ${data.error ?? "unknown"}`);
  }
  return data as T;
}

interface SlackChannel {
  id: string;
  name: string;
  is_private?: boolean;
  is_archived?: boolean;
}

async function resolveChannel(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("channel required");
  // Already an ID (C…, G…, D…) — pass through.
  if (/^[CGD][A-Z0-9]{6,}$/.test(trimmed)) return trimmed;
  const name = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  const data = await slackApi<{ channels: SlackChannel[] }>(
    "conversations.list",
    {
      exclude_archived: "true",
      types: "public_channel,private_channel",
      limit: 200,
    },
  );
  const found = data.channels.find((c) => c.name === name);
  if (!found) throw new Error(`No Slack channel named "${name}"`);
  return found.id;
}

interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  profile?: { email?: string; display_name?: string };
}

async function resolveUserId(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("user required");
  if (/^[UW][A-Z0-9]{6,}$/.test(trimmed)) return trimmed;
  if (trimmed.includes("@")) {
    const data = await slackApi<{ user: SlackUser }>("users.lookupByEmail", {
      email: trimmed,
    });
    return data.user.id;
  }
  const handle = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const data = await slackApi<{ members: SlackUser[] }>("users.list", {
    limit: 200,
  });
  const found = data.members.find(
    (u) =>
      u.name === handle ||
      u.profile?.display_name === handle ||
      u.real_name === handle,
  );
  if (!found) throw new Error(`No Slack user matching "${trimmed}"`);
  return found.id;
}

export const SLACK_PRIMITIVES: IntegrationPrimitive[] = [
  {
    name: "slack_post_message",
    integration_id: "slack",
    label: "Post a message to a channel",
    description:
      "Post a message to a Slack channel. Channel may be a name (e.g. 'general' or '#general') or a channel ID.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string" },
        text: { type: "string" },
        thread_ts: {
          type: "string",
          description: "Optional thread timestamp to reply in a thread.",
        },
      },
      required: ["channel", "text"],
    },
    async handler(input, ctx) {
      const channel = await resolveChannel(String(input["channel"] ?? ""));
      const text = String(input["text"] ?? "");
      if (!text) throw new Error("text required");
      const body: Record<string, unknown> = { channel, text };
      if (input["thread_ts"]) body["thread_ts"] = String(input["thread_ts"]);
      const result = await slackPost<PostMessageResponse>(
        "chat.postMessage",
        body,
      );
      ctx.log(`Posted a message to Slack channel ${input["channel"]}.`);
      return {
        summary: `Posted message to Slack ${input["channel"]}.`,
        data: { ts: result.ts, channel: result.channel },
      };
    },
  },
  {
    name: "slack_send_dm",
    integration_id: "slack",
    label: "Direct-message a user",
    description:
      "Open a DM with a Slack user (by user ID, @handle, or email) and send them a message.",
    input_schema: {
      type: "object",
      properties: {
        user: {
          type: "string",
          description: "Slack user ID, @handle, or email address.",
        },
        text: { type: "string" },
      },
      required: ["user", "text"],
    },
    async handler(input, ctx) {
      const userId = await resolveUserId(String(input["user"] ?? ""));
      const text = String(input["text"] ?? "");
      if (!text) throw new Error("text required");
      const opened = await slackPost<{ channel: { id: string } }>(
        "conversations.open",
        { users: userId },
      );
      const channelId = opened.channel.id;
      const result = await slackPost<PostMessageResponse>("chat.postMessage", {
        channel: channelId,
        text,
      });
      ctx.log(`Sent a Slack DM to ${input["user"]}.`);
      return {
        summary: `Sent DM to ${input["user"]} on Slack.`,
        data: { ts: result.ts, channel: channelId, user_id: userId },
      };
    },
  },
  {
    name: "slack_list_channels",
    integration_id: "slack",
    label: "List channels",
    description:
      "List public and private Slack channels the bot is a member of (or can see).",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 50 },
      },
    },
    async handler(input, ctx) {
      const limit = Math.min(Number(input["limit"] ?? 50), 200);
      const data = await slackApi<{ channels: SlackChannel[] }>(
        "conversations.list",
        {
          exclude_archived: "true",
          types: "public_channel,private_channel",
          limit,
        },
      );
      const channels = data.channels.map((c) => ({
        id: c.id,
        name: c.name,
        is_private: c.is_private ?? false,
      }));
      ctx.log(`Listed ${channels.length} Slack channels.`);
      return {
        summary: `Found ${channels.length} Slack channels.`,
        data: channels,
      };
    },
  },
];
