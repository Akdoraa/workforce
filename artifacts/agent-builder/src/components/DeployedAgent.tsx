import { useEffect, useRef, useState } from "react";
import { type ActivityEvent, type DeployedAgent } from "@workspace/api-zod";
import { Button } from "@/components/ui/button";
import {
  Activity,
  CheckCircle2,
  Globe,
  Loader2,
  Pause,
  Play,
  Power,
  Sparkles,
} from "lucide-react";
import {
  fetchAgent,
  fetchConnections,
  pauseAgent,
  resumeAgent,
  runAgentNow,
  streamActivity,
  type ConnectionStatus,
} from "@/lib/agent-api";

function describeCronHuman(
  cron: string | undefined,
  tz: string | undefined,
): string {
  if (!cron) return "on demand";
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [m, h, , , dow] = parts;
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const tzLabel = tz ?? "UTC";
  if (dow !== "*") {
    const days = dow
      .split(",")
      .map((d) => dayNames[Number(d) % 7])
      .join(", ");
    return `${days} at ${time} ${tzLabel}`;
  }
  return `Daily at ${time} ${tzLabel}`;
}

function fmtRelative(ts: number): string {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface Props {
  deploymentId: string;
  onDisconnect: () => void;
}

export function DeployedAgentDashboard({ deploymentId, onDisconnect }: Props) {
  const [agent, setAgent] = useState<DeployedAgent | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    void fetchAgent(deploymentId).then((a) => mounted && setAgent(a));
    void fetchConnections().then((c) => mounted && setConnections(c));
    const close = streamActivity(deploymentId, (e) => {
      setActivity((prev) => [...prev, e].slice(-200));
    });
    const t = setInterval(() => {
      void fetchAgent(deploymentId).then((a) => mounted && a && setAgent(a));
    }, 10000);
    return () => {
      mounted = false;
      close();
      clearInterval(t);
    };
  }, [deploymentId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activity.length]);

  const handlePauseResume = async () => {
    if (!agent) return;
    const updated = agent.paused
      ? await resumeAgent(agent.id)
      : await pauseAgent(agent.id);
    setAgent(updated);
  };

  const handleRunNow = async () => {
    if (!agent || running) return;
    setRunning(true);
    try {
      await runAgentNow(agent.id);
    } finally {
      setRunning(false);
      const fresh = await fetchAgent(deploymentId);
      if (fresh) setAgent(fresh);
    }
  };

  if (!agent) {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
        <div className="text-sm text-muted-foreground">Loading assistant…</div>
      </div>
    );
  }

  const bp = agent.blueprint;
  const activeConnections = bp.integrations
    .map((i) => connections.find((c) => c.id === i.id))
    .filter((c): c is ConnectionStatus => Boolean(c));
  const nextTrig = bp.triggers.find((t) => t.cron);

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-3 shrink-0 bg-card/40">
        <div className="flex gap-1.5">
          <div className="h-3 w-3 rounded-full bg-red-500/60" />
          <div className="h-3 w-3 rounded-full bg-yellow-500/60" />
          <div className="h-3 w-3 rounded-full bg-green-500/60" />
        </div>
        <div className="flex-1 mx-2 flex items-center gap-2 bg-muted/50 rounded-md px-3 py-1.5 text-xs text-muted-foreground border border-border">
          <Globe className="h-3.5 w-3.5" />
          <span className="truncate">
            {bp.name.toLowerCase().replace(/\s+/g, "-")}.deployed
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handlePauseResume}
          className="h-8 gap-1.5"
        >
          {agent.paused ? (
            <>
              <Play className="h-3.5 w-3.5" /> Resume
            </>
          ) : (
            <>
              <Pause className="h-3.5 w-3.5" /> Pause
            </>
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDisconnect}
          className="h-8 gap-1.5 text-destructive hover:text-destructive"
        >
          <Power className="h-3.5 w-3.5" /> Close
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {bp.name}
              </h1>
              <div className="text-sm text-muted-foreground mt-0.5">
                {bp.role_summary || "Your assistant"}
              </div>
            </div>
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs ${
                agent.paused
                  ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-300"
                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${agent.paused ? "bg-yellow-400" : "bg-emerald-400 animate-pulse"}`}
              />
              {agent.paused ? "Paused" : "Live"}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card title="Connected accounts">
              <div className="space-y-2">
                {activeConnections.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No accounts connected.
                  </div>
                ) : (
                  activeConnections.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-3 text-sm"
                    >
                      <div
                        className="h-7 w-7 rounded-md flex items-center justify-center text-white text-xs font-bold shrink-0"
                        style={{ backgroundColor: c.brand_color }}
                      >
                        {c.name.slice(0, 1)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {c.connected
                            ? c.identity ?? c.display_name ?? "Connected"
                            : "Not connected"}
                        </div>
                      </div>
                      {c.connected ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card title="Schedule">
              <div className="space-y-1.5">
                {bp.triggers.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    Runs only when you ask it to.
                  </div>
                ) : (
                  bp.triggers.map((t) => (
                    <div key={t.id} className="text-sm">
                      <div>{t.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {describeCronHuman(t.cron, t.timezone)}
                      </div>
                    </div>
                  ))
                )}
              </div>
              {nextTrig ? (
                <div className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
                  Next: {describeCronHuman(nextTrig.cron, nextTrig.timezone)}
                </div>
              ) : null}
            </Card>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <div className="text-sm font-medium">Live activity</div>
              <div className="ml-auto">
                <Button
                  size="sm"
                  onClick={handleRunNow}
                  disabled={running || agent.paused}
                  className="h-8 gap-1.5"
                >
                  {running ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" /> Run now
                    </>
                  )}
                </Button>
              </div>
            </div>
            <div
              ref={scrollRef}
              className="max-h-96 overflow-y-auto divide-y divide-border"
            >
              {activity.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Nothing yet. Hit "Run now" to see your assistant work.
                </div>
              ) : (
                activity.map((e) => (
                  <div
                    key={e.id}
                    className="px-4 py-2.5 flex items-start gap-3"
                  >
                    <div
                      className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${
                        e.kind === "error"
                          ? "bg-red-400"
                          : e.kind === "tool_call"
                            ? "bg-primary"
                            : e.kind === "tool_result"
                              ? "bg-emerald-400"
                              : e.kind === "run_start"
                                ? "bg-blue-400"
                                : e.kind === "run_end"
                                  ? "bg-purple-400"
                                  : "bg-muted-foreground"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-sm ${
                          e.kind === "error"
                            ? "text-red-300"
                            : e.kind === "thought"
                              ? "text-muted-foreground italic"
                              : ""
                        }`}
                      >
                        {e.text}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {fmtRelative(e.ts)}
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">
        {title}
      </div>
      {children}
    </div>
  );
}
