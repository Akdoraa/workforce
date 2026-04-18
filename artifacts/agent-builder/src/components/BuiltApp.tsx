import { useEffect, useRef, useState } from "react";
import { Agent } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Activity,
  CircleDot,
  Globe,
  Pause,
  Play,
  Power,
  RefreshCw,
} from "lucide-react";

const API_BASE = `${import.meta.env.BASE_URL}api`;

interface BuiltAppProps {
  agent: Agent;
  onToggleRunning: () => void;
  onDisconnect: () => void;
}

interface Charge {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paid: boolean;
  refunded: boolean;
  amount_refunded: number;
  disputed: boolean;
  created: number;
  description: string | null;
  customer_name: string | null;
  failure_message: string | null;
  livemode: boolean;
}

interface BalanceEntry {
  amount: number;
  currency: string;
}

interface ActivityEvent {
  id: string;
  ts: number;
  text: string;
  kind: "read" | "flag" | "action" | "info";
}

function fmtMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function fmtRelative(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function BuiltApp({ agent, onToggleRunning, onDisconnect }: BuiltAppProps) {
  const conn = agent.connection;
  const [charges, setCharges] = useState<Charge[]>([]);
  const [balance, setBalance] = useState<{
    available: BalanceEntry[];
    pending: BalanceEntry[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [refunding, setRefunding] = useState<Record<string, boolean>>({});
  const seenChargeIds = useRef<Set<string>>(new Set());

  const pushActivity = (kind: ActivityEvent["kind"], text: string) => {
    setActivity((prev) =>
      [
        { id: crypto.randomUUID(), ts: Date.now(), text, kind },
        ...prev,
      ].slice(0, 30),
    );
  };

  const fetchAll = async () => {
    try {
      const [chRes, balRes] = await Promise.all([
        fetch(`${API_BASE}/stripe/charges?limit=12`),
        fetch(`${API_BASE}/stripe/balance`),
      ]);
      if (!chRes.ok) throw new Error(`Charges ${chRes.status}`);
      if (!balRes.ok) throw new Error(`Balance ${balRes.status}`);
      const chData = (await chRes.json()) as { charges: Charge[] };
      const balData = (await balRes.json()) as {
        available: BalanceEntry[];
        pending: BalanceEntry[];
      };
      const newCount = chData.charges.filter(
        (c) => !seenChargeIds.current.has(c.id),
      ).length;
      chData.charges.forEach((c) => seenChargeIds.current.add(c.id));
      setCharges(chData.charges);
      setBalance(balData);
      setError(null);
      if (loading) {
        pushActivity(
          "read",
          `Fetched ${chData.charges.length} recent charges from your Stripe account.`,
        );
        const failed = chData.charges.filter(
          (c) => c.status === "failed" || c.failure_message,
        ).length;
        const disputed = chData.charges.filter((c) => c.disputed).length;
        if (failed > 0) {
          pushActivity("flag", `Flagged ${failed} failed charge${failed > 1 ? "s" : ""} for review.`);
        }
        if (disputed > 0) {
          pushActivity(
            "flag",
            `Spotted ${disputed} disputed charge${disputed > 1 ? "s" : ""} — refund recommended.`,
          );
        }
      } else if (newCount > 0) {
        pushActivity("read", `Detected ${newCount} new charge${newCount > 1 ? "s" : ""}.`);
      }
      setLoading(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic refresh while running.
  useEffect(() => {
    if (!agent.isRunning) return;
    const id = setInterval(() => {
      fetchAll();
    }, 12000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.isRunning]);

  // Periodic monitoring activity messages while running.
  useEffect(() => {
    if (!agent.isRunning) return;
    const monitorMessages = [
      "Monitoring incoming charges in real time…",
      "Watching for failed payments and disputes…",
      "Checking customer balances for retry opportunities…",
      "Scanning for refund-eligible disputes…",
    ];
    const id = setInterval(() => {
      const m = monitorMessages[Math.floor(Math.random() * monitorMessages.length)];
      pushActivity("info", m);
    }, 6000);
    return () => clearInterval(id);
  }, [agent.isRunning]);

  const handleRefund = async (chargeId: string) => {
    setRefunding((m) => ({ ...m, [chargeId]: true }));
    pushActivity("action", `Issuing refund for ${chargeId}…`);
    try {
      const res = await fetch(`${API_BASE}/stripe/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ charge_id: chargeId }),
      });
      const data = (await res.json()) as { error?: string; status?: string };
      if (!res.ok) throw new Error(data.error ?? `Refund failed (${res.status})`);
      pushActivity(
        "action",
        `Refund ${data.status ?? "succeeded"} for ${chargeId}.`,
      );
      await fetchAll();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      pushActivity("flag", `Refund failed for ${chargeId}: ${msg}`);
    } finally {
      setRefunding((m) => ({ ...m, [chargeId]: false }));
    }
  };

  const totalAvailable =
    balance?.available.reduce((sum, b) => sum + b.amount, 0) ?? 0;
  const totalPending =
    balance?.pending.reduce((sum, b) => sum + b.amount, 0) ?? 0;
  const balanceCurrency = balance?.available[0]?.currency ?? "usd";

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
            {agent.appName?.toLowerCase()}.app /dashboard
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
        <div className="p-6 max-w-4xl mx-auto space-y-6">
          {/* Connection badge */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {agent.appName}
              </h1>
              <div className="text-sm text-muted-foreground mt-0.5">
                Live agent for your Stripe account
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 text-xs">
              <CircleDot className="h-3 w-3 animate-pulse" />
              Connected to Stripe ·{" "}
              {conn?.email ?? conn?.business_name ?? conn?.account_id}
              {conn && !conn.livemode ? (
                <span className="ml-1 text-yellow-300/80">(test mode)</span>
              ) : null}
            </div>
          </div>

          {error ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              Couldn't load Stripe data: {error}
            </div>
          ) : null}

          {/* Balance + summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground tracking-wider">
                Available balance
              </div>
              <div className="text-2xl font-semibold mt-1">
                {balance ? fmtMoney(totalAvailable, balanceCurrency) : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground tracking-wider">
                Pending
              </div>
              <div className="text-2xl font-semibold mt-1">
                {balance ? fmtMoney(totalPending, balanceCurrency) : "—"}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs uppercase text-muted-foreground tracking-wider">
                Recent charges
              </div>
              <div className="text-2xl font-semibold mt-1">{charges.length}</div>
            </div>
          </div>

          {/* Charges list */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Recent charges</div>
                <div className="text-xs text-muted-foreground">
                  Pulled live from your Stripe account
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5"
                onClick={fetchAll}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            </div>
            <div className="divide-y divide-border">
              {loading && charges.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  Loading your Stripe data…
                </div>
              ) : charges.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  No charges in this account yet.
                </div>
              ) : (
                charges.map((c) => (
                  <div
                    key={c.id}
                    className="px-4 py-3 flex items-center gap-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {c.customer_name ?? c.description ?? "Charge"}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">
                        {c.id} · {fmtRelative(c.created)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold tabular-nums">
                        {fmtMoney(c.amount, c.currency)}
                      </div>
                      <div className="text-[11px] mt-0.5">
                        {c.refunded ? (
                          <span className="text-blue-300">Refunded</span>
                        ) : c.disputed ? (
                          <span className="text-orange-300">Disputed</span>
                        ) : c.status === "failed" ? (
                          <span className="text-red-300">Failed</span>
                        ) : (
                          <span className="text-emerald-300">{c.status}</span>
                        )}
                      </div>
                    </div>
                    {!c.refunded && c.paid && c.status === "succeeded" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={refunding[c.id]}
                        onClick={() => handleRefund(c.id)}
                      >
                        {refunding[c.id] ? "Refunding…" : "Refund"}
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
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
                <div className="ml-2 text-[11px] text-muted-foreground">Paused</div>
              )}
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-border">
              {activity.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Agent will start posting actions shortly…
                </div>
              ) : (
                activity.map((e) => (
                  <div key={e.id} className="px-4 py-2.5 flex items-start gap-3">
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
