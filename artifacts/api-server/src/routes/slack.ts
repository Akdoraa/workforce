import { Router, type IRouter } from "express";
import { slackApi } from "../lib/slack";

const router: IRouter = Router();

interface AuthTest {
  url: string;
  team: string;
  user: string;
  team_id: string;
  user_id: string;
}

interface Channel {
  id: string;
  name: string;
  is_private: boolean;
  is_archived: boolean;
  num_members?: number;
  topic?: { value?: string };
  purpose?: { value?: string };
}

interface ChannelsList {
  channels: Channel[];
}

interface SlackMessage {
  type: string;
  user?: string;
  bot_id?: string;
  text: string;
  ts: string;
  reply_count?: number;
  reactions?: Array<{ name: string; count: number }>;
}

interface History {
  messages: SlackMessage[];
}

interface UsersInfo {
  user: { id: string; name: string; real_name?: string; profile?: { display_name?: string; image_48?: string } };
}

router.get("/slack/account", async (req, res) => {
  try {
    const auth = await slackApi<AuthTest>("auth.test");
    res.json({
      connected: true,
      account_id: auth.team_id,
      team: auth.team,
      user: auth.user,
      user_id: auth.user_id,
      url: auth.url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log?.warn({ err }, "Slack account fetch failed");
    res.status(503).json({ connected: false, error: message });
  }
});

router.get("/slack/channels", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const data = await slackApi<ChannelsList>("conversations.list", {
      exclude_archived: "true",
      types: "public_channel,private_channel",
      limit,
    });
    res.json({
      channels: data.channels.map((c) => ({
        id: c.id,
        name: c.name,
        is_private: c.is_private,
        num_members: c.num_members ?? 0,
        topic: c.topic?.value ?? "",
        purpose: c.purpose?.value ?? "",
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log?.warn({ err }, "Slack channels fetch failed");
    res.status(503).json({ error: message });
  }
});

router.get("/slack/messages", async (req, res) => {
  try {
    const channel = String(req.query.channel ?? "");
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    if (!channel) {
      res.status(400).json({ error: "channel query param required" });
      return;
    }
    const data = await slackApi<History>("conversations.history", {
      channel,
      limit,
    });
    // Resolve user names for nicer display (best effort, parallel, capped).
    const userIds = Array.from(
      new Set(
        data.messages
          .map((m) => m.user)
          .filter((u): u is string => Boolean(u)),
      ),
    ).slice(0, 25);
    const userMap = new Map<string, string>();
    await Promise.all(
      userIds.map(async (uid) => {
        try {
          const u = await slackApi<UsersInfo>("users.info", { user: uid });
          userMap.set(
            uid,
            u.user.profile?.display_name ||
              u.user.real_name ||
              u.user.name ||
              uid,
          );
        } catch {
          // ignore
        }
      }),
    );
    res.json({
      channel,
      messages: data.messages.map((m) => ({
        ts: m.ts,
        text: m.text,
        user: m.user ?? null,
        user_name: m.user ? userMap.get(m.user) ?? null : null,
        bot_id: m.bot_id ?? null,
        reply_count: m.reply_count ?? 0,
        reactions: m.reactions ?? [],
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log?.warn({ err }, "Slack messages fetch failed");
    res.status(503).json({ error: message });
  }
});

router.post("/slack/post", async (req, res) => {
  try {
    const channel = String(req.body?.channel ?? "");
    const text = String(req.body?.text ?? "");
    if (!channel || !text) {
      res.status(400).json({ error: "channel and text required" });
      return;
    }
    // chat.postMessage expects POST form/json, use fetch directly.
    const token = await (await import("../lib/slack")).getSlackToken();
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ channel, text }),
    });
    const data = (await r.json()) as { ok: boolean; ts?: string; error?: string };
    if (!data.ok) {
      res.status(400).json({ error: data.error ?? "post failed" });
      return;
    }
    res.json({ ok: true, ts: data.ts });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    req.log?.warn({ err }, "Slack post failed");
    res.status(500).json({ error: message });
  }
});

export default router;
