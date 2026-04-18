import { Agent } from "@/lib/store";
import { SERVICE_META } from "@/lib/agent-logic";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useEffect, useState } from "react";
import {
  Play,
  Pause,
  CreditCard,
  Activity,
  CheckCircle2,
  Clock,
  RefreshCw,
  Bell,
  TrendingUp,
  Hash,
  AlertCircle,
  MessageSquare,
  LinkIcon,
  LogOut,
} from "lucide-react";

interface BuiltAppProps {
  agent: Agent;
  onToggleRunning: () => void;
  onDisconnect: () => void;
}

export function BuiltApp({
  agent,
  onToggleRunning,
  onDisconnect,
}: BuiltAppProps) {
  const meta = SERVICE_META[agent.service];
  const conn = agent.connection;
  if (!conn) return null;

  return (
    <div className="h-full flex flex-col bg-card min-w-0">
      {/* App browser-like header */}
      <div className="px-5 py-3 border-b border-border bg-background/60 backdrop-blur-sm flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-500/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500/60" />
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/60" />
          </div>
          <div className="bg-muted/60 rounded-md px-3 py-1 text-xs text-muted-foreground flex items-center gap-2 min-w-0">
            <LinkIcon className="h-3 w-3 shrink-0" />
            <span className="truncate font-mono">
              {agent.appName.toLowerCase()}.app/dashboard
            </span>
          </div>
        </div>
        <ConnectionBadge service={agent.service} email={conn.accountEmail} />
      </div>

      {/* App brand row */}
      <div className="px-6 py-4 border-b border-border bg-background/40 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-sm">
              {agent.appName.charAt(0)}
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold truncate">
              {agent.appName}
            </h1>
            <div className="text-xs text-muted-foreground truncate">
              Powered by {agent.name} · {meta.label} {conn.accountId}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={onDisconnect}
          >
            <LogOut className="h-3.5 w-3.5 mr-1" /> Disconnect
          </Button>
          <Button
            size="sm"
            onClick={onToggleRunning}
            className="h-8 bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {agent.isRunning ? (
              <>
                <Pause className="h-3.5 w-3.5 mr-1" /> Pause agent
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 mr-1" /> Run agent
              </>
            )}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          {agent.service === "stripe" && (
            <StripeApp isRunning={agent.isRunning} email={conn.accountEmail} />
          )}
          {agent.service === "jira" && (
            <JiraApp isRunning={agent.isRunning} />
          )}
          {agent.service === "slack" && (
            <SlackApp isRunning={agent.isRunning} />
          )}
          {agent.service === "generic" && (
            <GenericApp
              isRunning={agent.isRunning}
              prompt={agent.prompt}
              appName={agent.appName}
            />
          )}

          <AgentActivityFeed agent={agent} />
        </div>
      </ScrollArea>
    </div>
  );
}

function ConnectionBadge({
  service,
  email,
}: {
  service: Agent["service"];
  email: string;
}) {
  const meta = SERVICE_META[service];
  return (
    <div className="flex items-center gap-2 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      <span className="hidden sm:inline">
        Connected to {meta.label} · {email}
      </span>
      <span className="sm:hidden">{meta.label} live</span>
    </div>
  );
}

/* ---------- STRIPE APP ---------- */
function StripeApp({
  isRunning,
  email,
}: {
  isRunning: boolean;
  email: string;
}) {
  const [mrr, setMrr] = useState(42580);
  useEffect(() => {
    if (!isRunning) return;
    const t = setInterval(() => setMrr((v) => v + Math.floor(Math.random() * 50)), 2500);
    return () => clearInterval(t);
  }, [isRunning]);

  return (
    <div className="space-y-5">
      <SectionTitle icon={<TrendingUp className="h-4 w-4" />} title="Your account at a glance" />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="MRR" value={`$${(mrr / 100).toFixed(2)}k`} sub="↑ 12% MoM" />
        <Stat label="Active subs" value="1,204" sub="↑ 5% MoM" />
        <Stat label="Failed charges" value={isRunning ? "0" : "3"} sub={isRunning ? "Auto-retried" : "Awaiting retry"} />
      </div>

      <SectionTitle icon={<CreditCard className="h-4 w-4" />} title="Recent charges from your Stripe account" right={<RefreshDot active={isRunning} />} />
      <div className="space-y-2">
        {[
          { id: "ch_3PqL2k", customer: "Acme Corp", amount: "$1,200.00", status: "Succeeded" },
          { id: "ch_3PqL1f", customer: "Jane Doe", amount: "$45.00", status: "Succeeded" },
          { id: "ch_3PqKxj", customer: "Globex Inc", amount: "$8,500.00", status: isRunning ? "Refunded by agent" : "Disputed" },
          { id: "ch_3PqKsa", customer: "Initech", amount: "$320.00", status: "Succeeded" },
        ].map((c, i) => (
          <Card key={i} className="p-3 bg-background border-border flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-8 w-8 rounded bg-indigo-500/10 flex items-center justify-center shrink-0">
                <CreditCard className="h-4 w-4 text-indigo-400" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{c.customer}</div>
                <div className="text-[11px] text-muted-foreground font-mono truncate">{c.id} · {email}</div>
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-sm font-semibold">{c.amount}</div>
              <div className="text-[11px] text-muted-foreground">{c.status}</div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------- JIRA APP ---------- */
function JiraApp({ isRunning }: { isRunning: boolean }) {
  return (
    <div className="space-y-5">
      <SectionTitle icon={<TrendingUp className="h-4 w-4" />} title="Sprint at a glance" />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Open" value="14" sub={isRunning ? "−2 by agent" : ""} />
        <Stat label="In review" value="6" />
        <Stat label="Done this sprint" value={isRunning ? "23" : "21"} sub="↑ 4 today" />
      </div>

      <SectionTitle icon={<Hash className="h-4 w-4" />} title="Issues from your Jira board" right={<RefreshDot active={isRunning} />} />
      <div className="space-y-2">
        {[
          { id: "ENG-1042", title: "Login fails on Safari 17", priority: "High", status: isRunning ? "Triaged by agent" : "Untriaged" },
          { id: "ENG-1041", title: "Stripe webhook retry storm", priority: "High", status: "In progress" },
          { id: "ENG-1039", title: "Add dark mode to billing page", priority: "Low", status: "Backlog" },
          { id: "ENG-1037", title: "Onboarding email typo", priority: "Low", status: isRunning ? "Closed by agent" : "Open" },
        ].map((t, i) => (
          <Card key={i} className="p-3 bg-background border-border flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-blue-400">{t.id}</span>
                <Badge variant="outline" className={t.priority === "High" ? "text-red-400 border-red-400/30 text-[10px] h-4 py-0" : "text-muted-foreground text-[10px] h-4 py-0"}>{t.priority}</Badge>
              </div>
              <div className="text-sm font-medium truncate mt-0.5">{t.title}</div>
            </div>
            <div className="text-[11px] text-muted-foreground shrink-0">{t.status}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------- SLACK APP ---------- */
function SlackApp({ isRunning }: { isRunning: boolean }) {
  return (
    <div className="space-y-5">
      <SectionTitle icon={<TrendingUp className="h-4 w-4" />} title="Your workspace today" />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Channels watched" value="12" />
        <Stat label="Messages handled" value={isRunning ? "47" : "0"} sub={isRunning ? "live" : "paused"} />
        <Stat label="Mentions for you" value="3" sub="2 replied" />
      </div>

      <SectionTitle icon={<MessageSquare className="h-4 w-4" />} title="Recent activity in your channels" right={<RefreshDot active={isRunning} />} />
      <div className="space-y-2">
        {[
          { ch: "#support", from: "Mia", msg: "Customer can't reset password", reply: isRunning ? "Agent replied with reset steps" : "Awaiting reply" },
          { ch: "#alerts", from: "PagerDuty bot", msg: "API p99 latency 1.2s", reply: isRunning ? "Agent acknowledged & created issue" : "Unacknowledged" },
          { ch: "#sales", from: "Tom", msg: "Trial expiring for TechNova", reply: isRunning ? "Agent drafted follow-up email" : "No action" },
        ].map((m, i) => (
          <Card key={i} className="p-3 bg-background border-border">
            <div className="flex items-center gap-2 text-[11px] mb-1">
              <span className="text-rose-400 font-mono">{m.ch}</span>
              <span className="text-muted-foreground">· {m.from}</span>
            </div>
            <div className="text-sm">{m.msg}</div>
            <div className="text-[11px] text-muted-foreground mt-1">{m.reply}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------- GENERIC APP ---------- */
function GenericApp({
  isRunning,
  prompt,
  appName,
}: {
  isRunning: boolean;
  prompt: string;
  appName: string;
}) {
  return (
    <div className="space-y-5">
      <SectionTitle icon={<TrendingUp className="h-4 w-4" />} title={`${appName} overview`} />
      <Card className="p-4 bg-background border-border">
        <div className="text-xs text-muted-foreground mb-1">Your goal</div>
        <div className="text-sm">"{prompt}"</div>
      </Card>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Items synced" value="284" />
        <Stat label="Handled today" value={isRunning ? "12" : "0"} sub={isRunning ? "live" : "paused"} />
        <Stat label="Needs review" value="2" />
      </div>
    </div>
  );
}

/* ---------- AGENT ACTIVITY FEED ---------- */
function AgentActivityFeed({ agent }: { agent: Agent }) {
  const [events, setEvents] = useState<
    { id: string; text: string; time: string; type: "ok" | "info" | "warn" }[]
  >([]);

  useEffect(() => {
    if (!agent.isRunning) return;
    const samples = ACTIVITY_SAMPLES[agent.service];
    let cancelled = false;

    function push() {
      if (cancelled) return;
      const sample = samples[Math.floor(Math.random() * samples.length)];
      setEvents((prev) =>
        [
          {
            id: crypto.randomUUID(),
            text: sample.text,
            type: sample.type,
            time: "just now",
          },
          ...prev.map((e, i) => ({
            ...e,
            time: `${(i + 1) * 8}s ago`,
          })),
        ].slice(0, 6),
      );
    }

    push();
    const t = setInterval(push, 2800);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [agent.isRunning, agent.service]);

  return (
    <div>
      <SectionTitle
        icon={<Activity className="h-4 w-4" />}
        title={`${agent.name} activity`}
        right={<RefreshDot active={agent.isRunning} />}
      />
      {!agent.isRunning && events.length === 0 ? (
        <Card className="p-4 bg-background border-border border-dashed text-center">
          <div className="text-xs text-muted-foreground">
            Press <span className="text-foreground font-medium">Run agent</span> and your {agent.name} will start working on your account.
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <Card
              key={e.id}
              className="p-3 bg-background border-border flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
            >
              <div
                className={`h-7 w-7 rounded flex items-center justify-center shrink-0 ${
                  e.type === "ok"
                    ? "bg-emerald-500/10 text-emerald-400"
                    : e.type === "warn"
                      ? "bg-amber-500/10 text-amber-400"
                      : "bg-primary/10 text-primary"
                }`}
              >
                {e.type === "ok" ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : e.type === "warn" ? (
                  <AlertCircle className="h-3.5 w-3.5" />
                ) : (
                  <Bell className="h-3.5 w-3.5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm">{e.text}</div>
              </div>
              <div className="text-[11px] text-muted-foreground shrink-0 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {e.time}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

const ACTIVITY_SAMPLES: Record<
  Agent["service"],
  { text: string; type: "ok" | "info" | "warn" }[]
> = {
  stripe: [
    { text: "Retried failed charge ch_3PqL9a — succeeded", type: "ok" },
    { text: "Refunded ch_3PqKxj for Globex Inc ($8,500.00)", type: "ok" },
    { text: "Detected duplicate invoice in_1NaB2c — flagged", type: "warn" },
    { text: "Reconciled 14 payouts with bank deposits", type: "ok" },
    { text: "Updated subscription sub_1MqAa to annual plan", type: "info" },
  ],
  jira: [
    { text: "Triaged ENG-1042 → priority High, assigned to @maria", type: "ok" },
    { text: "Closed ENG-1037 — duplicate of ENG-1010", type: "ok" },
    { text: "Detected stale issue ENG-989 — pinged @owner", type: "warn" },
    { text: "Created sprint summary for Sprint 42", type: "info" },
  ],
  slack: [
    { text: "Replied to @customer in #support with reset steps", type: "ok" },
    { text: "Acknowledged PagerDuty alert in #alerts", type: "ok" },
    { text: "Drafted follow-up to TechNova in #sales", type: "info" },
    { text: "Detected toxic message — flagged to admins", type: "warn" },
  ],
  generic: [
    { text: "Synced 12 new items from your data source", type: "ok" },
    { text: "Auto-categorized 4 records", type: "info" },
    { text: "1 item needs review", type: "warn" },
  ],
};

/* ---------- shared bits ---------- */
function SectionTitle({
  icon,
  title,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <h3 className="font-medium flex items-center gap-2 text-sm">
        {icon} {title}
      </h3>
      {right}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="p-3 bg-background border-border">
      <div className="text-[11px] text-muted-foreground mb-1 truncate">
        {label}
      </div>
      <div className="text-xl font-bold">{value}</div>
      {sub && (
        <div className="text-[11px] text-emerald-500 mt-0.5 truncate">
          {sub}
        </div>
      )}
    </Card>
  );
}

function RefreshDot({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-500">
      <RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: "3s" }} />
      Syncing
    </span>
  );
}
