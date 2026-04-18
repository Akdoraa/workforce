import { useEffect, useRef, useState } from "react";
import { type ActivityEvent, type DeployedAgent, type Run } from "@workspace/api-zod";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  Power,
  RefreshCw,
  Sparkles,
  WifiOff,
  XCircle,
} from "lucide-react";
import {
  fetchAgent,
  fetchConnections,
  fetchRuns,
  pauseAgent,
  resumeAgent,
  runAgentNow,
  streamActivity,
  type ConnectionStatus,
  type StreamState,
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
  /**
   * Open the global Connections screen, optionally scrolled to and
   * highlighting one integration row. Used by the run-status card to
   * deep-link a "Reconnect" button on missing-scope failures.
   */
  onOpenConnections: (highlightId?: string) => void;
}

export function DeployedAgentDashboard({
  deploymentId,
  onDisconnect,
  onOpenConnections,
}: Props) {
  const [agent, setAgent] = useState<DeployedAgent | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [streamState, setStreamState] = useState<StreamState>("connected");
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    const refreshRuns = () =>
      fetchRuns(deploymentId, 50).then((rs) => {
        if (!mounted) return;
        setRuns((prev) => {
          const next: Record<string, Run> = { ...prev };
          for (const r of rs) next[r.id] = r;
          return next;
        });
      });
    void fetchAgent(deploymentId).then((a) => mounted && setAgent(a));
    void fetchConnections().then((c) => mounted && setConnections(c));
    void refreshRuns();
    const close = streamActivity(
      deploymentId,
      (e) => {
        setActivity((prev) => [...prev, e].slice(-200));
      },
      (s) => {
        if (mounted) setStreamState(s);
      },
    );
    const t = setInterval(() => {
      void fetchAgent(deploymentId).then((a) => mounted && a && setAgent(a));
      void refreshRuns();
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
    setRunMessage(null);
    try {
      const result = await runAgentNow(agent.id);
      if (result.already_running) {
        setRunMessage(
          result.error ??
            "This assistant is already running. Wait for the current run to finish.",
        );
      }
    } finally {
      setRunning(false);
      const fresh = await fetchAgent(deploymentId);
      if (fresh) setAgent(fresh);
      const rs = await fetchRuns(deploymentId, 50);
      setRuns((prev) => {
        const next: Record<string, Run> = { ...prev };
        for (const r of rs) next[r.id] = r;
        return next;
      });
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
          <span className="truncate font-medium text-foreground/80">
            {bp.name}
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
              <h1 className="text-2xl font-semibold tracking-tight font-display">
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

          {(() => {
            const cur = agent.current_run ?? null;
            const last = agent.last_run ?? null;
            return (
              <Card title="Run status">
                {cur ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                    <span>
                      Running now — started {fmtRelative(cur.started_at)}
                      {cur.trigger_source === "cron"
                        ? " (on schedule)"
                        : " (you started it)"}
                    </span>
                  </div>
                ) : last ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          last.status === "succeeded"
                            ? "bg-emerald-400"
                            : last.status === "timed_out"
                              ? "bg-yellow-400"
                              : "bg-red-400"
                        }`}
                      />
                      <span>
                        {last.status === "succeeded"
                          ? "Last run finished cleanly"
                          : last.status === "timed_out"
                            ? "Last run took too long and was stopped"
                            : "Last run didn't finish"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {fmtRelative(last.ended_at ?? last.started_at)}
                      </span>
                    </div>
                    {last.failure_summary ? (
                      <div className="text-xs text-muted-foreground pl-4">
                        {last.failure_summary}
                      </div>
                    ) : null}
                    {last.failed_integration_id ? (
                      (() => {
                        const failed = bp.integrations.find(
                          (i) => i.id === last.failed_integration_id,
                        );
                        const connStatus = connections.find(
                          (c) => c.id === last.failed_integration_id,
                        );
                        const label =
                          connStatus?.identity ??
                          connStatus?.display_name ??
                          failed?.name ??
                          "this account";
                        return (
                          <div className="pl-4 pt-1">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                onOpenConnections(
                                  last.failed_integration_id ?? undefined,
                                )
                              }
                              className="h-7 gap-1.5"
                            >
                              <RefreshCw className="h-3 w-3" /> Reconnect{" "}
                              {label}
                            </Button>
                          </div>
                        );
                      })()
                    ) : null}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Hasn't run yet.
                  </div>
                )}
              </Card>
            );
          })()}

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <div className="text-sm font-medium">Live activity</div>
              <StreamStateBadge state={streamState} />
              <div className="ml-auto">
                <Button
                  size="sm"
                  onClick={handleRunNow}
                  disabled={
                    running || agent.paused || Boolean(agent.current_run)
                  }
                  title={
                    agent.current_run
                      ? "Already running — wait for the current run to finish"
                      : agent.paused
                        ? "Resume the assistant to run it now"
                        : undefined
                  }
                  className="h-8 gap-1.5"
                >
                  {running || agent.current_run ? (
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
            {runMessage ? (
              <div className="px-4 py-2 text-xs text-yellow-300 bg-yellow-500/10 border-b border-yellow-500/20">
                {runMessage}
              </div>
            ) : null}
            {streamState === "lost" ? (
              <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/40 border-b border-border flex items-center gap-2">
                <WifiOff className="h-3 w-3" />
                We lost the live feed — refresh the page to catch up.
              </div>
            ) : null}
            <div
              ref={scrollRef}
              className="max-h-96 overflow-y-auto divide-y divide-border"
            >
              {activity.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Nothing yet. Hit "Run now" to see your assistant work.
                </div>
              ) : (
                groupActivityByRun(activity).map((g) => {
                  const meta =
                    (g.runId ? runs[g.runId] : null) ??
                    (agent.current_run?.id === g.runId
                      ? agent.current_run
                      : agent.last_run?.id === g.runId
                        ? agent.last_run
                        : null);
                  return <RunGroup key={g.key} group={g} runMeta={meta} />;
                })
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

function StreamStateBadge({ state }: { state: StreamState }) {
  if (state === "connected") return null;
  if (state === "reconnecting") {
    return (
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full border border-border">
        <Loader2 className="h-3 w-3 animate-spin" />
        Reconnecting…
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full border border-border">
      <WifiOff className="h-3 w-3" />
      Live feed paused
    </span>
  );
}

interface RunGroupData {
  key: string;
  runId: string | null;
  startEvent: ActivityEvent | null;
  endEvent: ActivityEvent | null;
  body: ActivityEvent[];
  startTs: number;
}

function groupActivityByRun(events: ActivityEvent[]): RunGroupData[] {
  const groups = new Map<string, RunGroupData>();
  const order: string[] = [];
  for (const e of events) {
    const key = e.run_id ?? `__loose__:${e.id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        runId: e.run_id,
        startEvent: null,
        endEvent: null,
        body: [],
        startTs: e.ts,
      };
      groups.set(key, g);
      order.push(key);
    }
    if (e.kind === "run_start") {
      g.startEvent = e;
      g.startTs = e.ts;
    } else if (e.kind === "run_end") {
      g.endEvent = e;
    } else {
      g.body.push(e);
    }
  }
  return order.map((k) => groups.get(k)!).filter(Boolean);
}

function fmtDurationSec(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function RunGroup({
  group,
  runMeta,
}: {
  group: RunGroupData;
  runMeta: Run | null;
}) {
  const inFlight = !group.endEvent && (!runMeta || runMeta.status === "running");
  // Always prefer authoritative run-lifecycle status. Only fall back to
  // an indeterminate "finished" footer when we have an end event but no
  // run record yet (e.g. race between activity stream and runs poll).
  const status: Run["status"] | "unknown" =
    runMeta?.status ?? (group.endEvent ? "unknown" : "running");
  const triggerSource = runMeta?.trigger_source;
  const headerWhen = new Date(group.startTs).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const triggerLabel =
    triggerSource === "cron"
      ? "on schedule"
      : triggerSource === "manual"
        ? "you started it"
        : group.startEvent?.text?.startsWith("Triggered:")
          ? "on schedule"
          : "you started it";
  const endTs = group.endEvent?.ts ?? runMeta?.ended_at ?? null;
  const durationSec = endTs ? Math.max(1, Math.round((endTs - group.startTs) / 1000)) : null;

  if (!group.runId) {
    return (
      <div className="px-4 py-2.5">
        {[group.startEvent, ...group.body, group.endEvent]
          .filter((e): e is ActivityEvent => Boolean(e))
          .map((e) => (
            <ActivityRow key={e.id} event={e} />
          ))}
      </div>
    );
  }

  return (
    <div className="bg-card">
      <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center gap-2 text-xs text-muted-foreground">
        {inFlight ? (
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        )}
        <span className="font-medium text-foreground/80">Run at {headerWhen}</span>
        <span>· {triggerLabel}</span>
      </div>
      <div className="divide-y divide-border/60">
        {group.body.map((e) => (
          <ActivityRow key={e.id} event={e} />
        ))}
        {group.body.length === 0 && inFlight ? (
          <div className="px-4 py-2.5 text-xs text-muted-foreground italic">
            Working…
          </div>
        ) : null}
      </div>
      <div className="px-4 py-2 border-t border-border flex items-center gap-2 text-xs">
        {inFlight ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
            <span className="text-foreground/80">Running…</span>
          </>
        ) : status === "succeeded" ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-emerald-300">Finished cleanly</span>
            {durationSec ? (
              <span className="text-muted-foreground">· {fmtDurationSec(durationSec)}</span>
            ) : null}
          </>
        ) : status === "unknown" ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            <span className="text-muted-foreground">Finished</span>
            {durationSec ? (
              <span className="text-muted-foreground">· {fmtDurationSec(durationSec)}</span>
            ) : null}
          </>
        ) : status === "timed_out" ? (
          <>
            <AlertCircle className="h-3.5 w-3.5 text-yellow-400" />
            <span className="text-yellow-300">Took too long and was stopped</span>
            {durationSec ? (
              <span className="text-muted-foreground">· {fmtDurationSec(durationSec)}</span>
            ) : null}
          </>
        ) : (
          <>
            <XCircle className="h-3.5 w-3.5 text-red-400" />
            <span className="text-red-300">Didn't finish</span>
            {durationSec ? (
              <span className="text-muted-foreground">· {fmtDurationSec(durationSec)}</span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ event: e }: { event: ActivityEvent }) {
  return (
    <div className="px-4 py-2.5 flex items-start gap-3">
      <div
        className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${
          e.kind === "error"
            ? "bg-red-400"
            : e.kind === "tool_call"
              ? "bg-primary"
              : e.kind === "tool_result"
                ? "bg-emerald-400"
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
  );
}
