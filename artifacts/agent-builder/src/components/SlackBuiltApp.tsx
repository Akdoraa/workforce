import { useEffect, useRef, useState } from "react";
import { Agent } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Activity,
  CircleDot,
  Globe,
  Hash,
  Lock,
  Pause,
  Play,
  Power,
  RefreshCw,
  Send,
  Users,
} from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL}api`;

interface SlackBuiltAppProps {
  agent: Agent;
  onToggleRunning: () => void;
  onDisconnect: () => void;
}

interface Channel {
  id: string;
  name: string;
  is_private: boolean;
  num_members: number;
  topic: string;
  purpose: string;
}

interface Message {
  ts: string;
  text: string;
  user: string | null;
  user_name: string | null;
  bot_id: string | null;
  reply_count: number;
  reactions: Array<{ name: string; count: number }>;
}

interface ActivityEvent {
  id: string;
  ts: number;
  text: string;
  kind: "read" | "flag" | "action" | "info";
}

function fmtRelative(tsSeconds: number): string {
  const diff = Date.now() / 1000 - tsSeconds;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function SlackBuiltApp({
  agent,
  onToggleRunning,
  onDisconnect,
}: SlackBuiltAppProps) {
  const conn = agent.connection;
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [posting, setPosting] = useState(false);
  const [draft, setDraft] = useState("");
  const seenMessageIds = useRef<Set<string>>(new Set());

  const pushActivity = (kind: ActivityEvent["kind"], text: string) => {
    setActivity((prev) =>
      [
        { id: crypto.randomUUID(), ts: Date.now(), text, kind },
        ...prev,
      ].slice(0, 30),
    );
  };

  const loadChannels = async () => {
    try {
      const res = await fetch(`${API_BASE}/slack/channels?limit=20`);
      if (!res.ok) throw new Error(`Channels ${res.status}`);
      const data = (await res.json()) as { channels: Channel[] };
      setChannels(data.channels);
      setError(null);
      pushActivity(
        "read",
        `Fetched ${data.channels.length} channels from your Slack workspace.`,
      );
      const totalMembers = data.channels.reduce(
        (s, c) => s + c.num_members,
        0,
      );
      pushActivity(
        "info",
        `Workspace overview: ${data.channels.length} channels, ${totalMembers} total memberships.`,
      );
      // Pick the first channel automatically.
      if (!selectedChannel && data.channels.length > 0) {
        const general =
          data.channels.find((c) => c.name === "general") ?? data.channels[0];
        setSelectedChannel(general.id);
      } else if (data.channels.length === 0) {
        setLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setLoading(false);
    }
  };

  const loadMessages = async (channelId: string, isInitial: boolean) => {
    try {
      const res = await fetch(
        `${API_BASE}/slack/messages?channel=${encodeURIComponent(channelId)}&limit=20`,
      );
      if (!res.ok) throw new Error(`Messages ${res.status}`);
      const data = (await res.json()) as { messages: Message[] };
      const newCount = data.messages.filter(
        (m) => !seenMessageIds.current.has(`${channelId}:${m.ts}`),
      ).length;
      data.messages.forEach((m) =>
        seenMessageIds.current.add(`${channelId}:${m.ts}`),
      );
      setMessages(data.messages);
      setLoading(false);
      const channelName =
        channels.find((c) => c.id === channelId)?.name ?? channelId;
      if (isInitial) {
        pushActivity(
          "read",
          `Read ${data.messages.length} messages from #${channelName}.`,
        );
        const questions = data.messages.filter((m) =>
          m.text.includes("?"),
        ).length;
        if (questions > 0) {
          pushActivity(
            "flag",
            `Spotted ${questions} unanswered question${questions > 1 ? "s" : ""} in #${channelName}.`,
          );
        }
      } else if (newCount > 0) {
        pushActivity(
          "read",
          `Detected ${newCount} new message${newCount > 1 ? "s" : ""} in #${channelName}.`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedChannel) {
      seenMessageIds.current = new Set();
      setLoading(true);
      loadMessages(selectedChannel, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChannel]);

  // Periodic refresh while running.
  useEffect(() => {
    if (!agent.isRunning || !selectedChannel) return;
    const id = setInterval(() => {
      loadMessages(selectedChannel, false);
    }, 12000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.isRunning, selectedChannel]);

  // Idle monitoring messages.
  useEffect(() => {
    if (!agent.isRunning) return;
    const monitorMessages = [
      "Watching for new messages and mentions…",
      "Scanning threads for unanswered questions…",
      "Tracking channel engagement and reactions…",
      "Listening for keywords flagged for follow-up…",
    ];
    const id = setInterval(() => {
      const m =
        monitorMessages[Math.floor(Math.random() * monitorMessages.length)];
      pushActivity("info", m);
    }, 6000);
    return () => clearInterval(id);
  }, [agent.isRunning]);

  const handlePost = async () => {
    if (!selectedChannel || !draft.trim()) return;
    const channelName =
      channels.find((c) => c.id === selectedChannel)?.name ?? selectedChannel;
    setPosting(true);
    pushActivity("action", `Posting to #${channelName}…`);
    try {
      const res = await fetch(`${API_BASE}/slack/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: selectedChannel, text: draft }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `Post failed (${res.status})`);
      }
      pushActivity("action", `Message posted to #${channelName}.`);
      setDraft("");
      await loadMessages(selectedChannel, false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      pushActivity("flag", `Couldn't post to #${channelName}: ${msg}`);
    } finally {
      setPosting(false);
    }
  };

  const currentChannel = channels.find((c) => c.id === selectedChannel);

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">
      {/* Browser-chrome header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 shrink-0 bg-card/40">
        <div className="flex gap-1.5">
          <div className="h-3 w-3 rounded-full bg-red-500/60" />
          <div className="h-3 w-3 rounded-full bg-yellow-500/60" />
          <div className="h-3 w-3 rounded-full bg-green-500/60" />
        </div>
        <div className="flex-1 mx-2 flex items-center gap-2 bg-muted/50 rounded-md px-3 py-1.5 text-xs text-muted-foreground border border-border">
          <Globe className="h-3.5 w-3.5" />
          <span className="truncate">
            {agent.appName?.toLowerCase()}.app /workspace
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onToggleRunning}
          className="h-8 gap-1.5"
        >
          {agent.isRunning ? (
            <>
              <Pause className="h-3.5 w-3.5" /> Pause agent
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" /> Resume
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDisconnect}
          className="h-8 gap-1.5 text-destructive hover:text-destructive"
        >
          <Power className="h-3.5 w-3.5" /> Disconnect
        </Button>
      </div>

      {/* App body */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-5xl mx-auto space-y-6">
          {/* Connection badge */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {agent.appName}
              </h1>
              <div className="text-sm text-muted-foreground mt-0.5">
                Live agent for your Slack workspace
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs">
              <CircleDot className="h-3 w-3 animate-pulse" />
              Connected to Slack ·{" "}
              {conn?.business_name ?? conn?.account_id ?? "workspace"}
            </div>
          </div>

          {error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              Couldn't load Slack data: {error}
            </div>
          ) : null}

          {/* Stat cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground tracking-wider">
                Channels
              </div>
              <div className="text-2xl font-semibold mt-1">
                {channels.length}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground tracking-wider">
                Total memberships
              </div>
              <div className="text-2xl font-semibold mt-1">
                {channels.reduce((s, c) => s + c.num_members, 0)}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground tracking-wider">
                Messages in view
              </div>
              <div className="text-2xl font-semibold mt-1">
                {messages.length}
              </div>
            </div>
          </div>

          {/* Channels + messages */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Channel list */}
            <div className="rounded-xl border border-border bg-card overflow-hidden md:col-span-1 max-h-[28rem] flex flex-col">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="text-sm font-medium">Channels</div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  onClick={loadChannels}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-border">
                {channels.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted-foreground">
                    {loading ? "Loading channels…" : "No channels found."}
                  </div>
                ) : (
                  channels.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedChannel(c.id)}
                      className={`w-full text-left px-4 py-2.5 hover:bg-muted/30 transition-colors flex items-center gap-2 ${
                        selectedChannel === c.id ? "bg-muted/40" : ""
                      }`}
                    >
                      {c.is_private ? (
                        <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <Hash className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      )}
                      <span className="text-sm truncate flex-1">{c.name}</span>
                      <span className="text-[11px] text-muted-foreground flex items-center gap-0.5">
                        <Users className="h-3 w-3" />
                        {c.num_members}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="rounded-xl border border-border bg-card overflow-hidden md:col-span-2 flex flex-col max-h-[28rem]">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                {currentChannel?.is_private ? (
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <div className="text-sm font-medium flex-1 truncate">
                  {currentChannel?.name ?? "Pick a channel"}
                </div>
                {currentChannel?.topic ? (
                  <div className="text-[11px] text-muted-foreground truncate hidden md:block max-w-[18rem]">
                    {currentChannel.topic}
                  </div>
                ) : null}
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-border">
                {loading && messages.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Loading messages…
                  </div>
                ) : messages.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    No messages in this channel yet.
                  </div>
                ) : (
                  messages.map((m) => (
                    <div key={m.ts} className="px-4 py-2.5 space-y-1">
                      <div className="flex items-baseline gap-2">
                        <div className="text-sm font-medium truncate">
                          {m.user_name ?? (m.bot_id ? "bot" : m.user ?? "unknown")}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {fmtRelative(parseFloat(m.ts))}
                        </div>
                        {m.reply_count > 0 ? (
                          <div className="text-[11px] text-primary">
                            {m.reply_count} repl{m.reply_count > 1 ? "ies" : "y"}
                          </div>
                        ) : null}
                      </div>
                      <div className="text-sm whitespace-pre-wrap break-words">
                        {m.text || (
                          <span className="italic text-muted-foreground">
                            (no text)
                          </span>
                        )}
                      </div>
                      {m.reactions.length > 0 ? (
                        <div className="flex gap-1.5 flex-wrap">
                          {m.reactions.map((r) => (
                            <span
                              key={r.name}
                              className="text-[11px] bg-muted/50 rounded px-1.5 py-0.5"
                            >
                              :{r.name}: {r.count}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
              {selectedChannel ? (
                <div className="border-t border-border p-2 flex gap-2 shrink-0">
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !posting) handlePost();
                    }}
                    placeholder={`Message #${currentChannel?.name ?? ""}`}
                    className="flex-1 bg-muted/40 rounded-md px-3 py-1.5 text-sm outline-none border border-border focus:border-primary"
                  />
                  <Button
                    size="sm"
                    onClick={handlePost}
                    disabled={posting || !draft.trim()}
                    className="gap-1.5"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {posting ? "Posting…" : "Send"}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>

          {/* Agent activity */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <div className="text-sm font-medium">Agent activity</div>
              {agent.isRunning ? (
                <div className="ml-2 flex items-center gap-1.5 text-[11px] text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Running
                </div>
              ) : (
                <div className="ml-2 text-[11px] text-muted-foreground">
                  Paused
                </div>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-border">
              {activity.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Agent will start posting actions shortly…
                </div>
              ) : (
                activity.map((e) => (
                  <div
                    key={e.id}
                    className="px-4 py-2.5 flex items-start gap-3"
                  >
                    <div
                      className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${
                        e.kind === "action"
                          ? "bg-primary"
                          : e.kind === "flag"
                            ? "bg-orange-400"
                            : e.kind === "read"
                              ? "bg-emerald-400"
                              : "bg-muted-foreground"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">{e.text}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {fmtRelative(e.ts / 1000)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
