import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plug,
  Plug2,
  RefreshCw,
} from "lucide-react";
import {
  fetchConnections,
  refreshConnection,
  type ConnectionStatus,
} from "@/lib/agent-api";
import { BRAND_ICONS } from "@/lib/brand-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CONNECTOR_AUTH_URL = "https://replit.com/account#connections";

interface Props {
  /**
   * If set, scroll to and highlight the matching integration row when the
   * screen mounts. Used by deep-links from the deployed agent dashboard
   * (e.g. "Reconnect Gmail" on a missing-scope failure card).
   */
  highlightId?: string | null;
  /**
   * Cleared after we consume the highlight so we don't keep re-scrolling
   * on every state update.
   */
  onHighlightConsumed?: () => void;
}

interface PendingAction {
  integrationId: string;
  /** Hint text shown beneath the row while waiting for the popup to close. */
  message: string;
}

export function ConnectionsScreen({ highlightId, onHighlightConsumed }: Props) {
  const [connections, setConnections] = useState<ConnectionStatus[] | null>(
    null,
  );
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] =
    useState<ConnectionStatus | null>(null);
  const [popupBlocked, setPopupBlocked] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const popupWatcher = useRef<ReturnType<typeof setInterval> | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      const list = await fetchConnections();
      if (mounted) setConnections(list);
    };
    void refresh();
    const id = setInterval(refresh, 5000);
    return () => {
      mounted = false;
      clearInterval(id);
      if (popupWatcher.current) clearInterval(popupWatcher.current);
    };
  }, []);

  // Scroll-to and highlight on deep-link.
  useEffect(() => {
    if (!highlightId || !connections) return;
    setHighlight(highlightId);
    const el = rowRefs.current.get(highlightId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (onHighlightConsumed) onHighlightConsumed();
    const t = setTimeout(() => setHighlight(null), 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, Boolean(connections)]);

  const refreshOne = async (integrationId: string) => {
    const updated = await refreshConnection(integrationId);
    if (!updated) return;
    setConnections((prev) =>
      (prev ?? []).map((c) => (c.id === integrationId ? updated : c)),
    );
  };

  const openAuthPopup = (integrationId: string, message: string) => {
    const features = "popup=yes,width=560,height=720,noopener=no";
    let win: Window | null = null;
    try {
      win = window.open(CONNECTOR_AUTH_URL, "replit-connector-auth", features);
    } catch {
      win = null;
    }
    if (!win) {
      setPopupBlocked(integrationId);
      return;
    }
    setPopupBlocked(null);
    setPending({ integrationId, message });
    try {
      win.focus();
    } catch {
      // ignore
    }
    if (popupWatcher.current) clearInterval(popupWatcher.current);
    popupWatcher.current = setInterval(() => {
      if (win!.closed) {
        if (popupWatcher.current) {
          clearInterval(popupWatcher.current);
          popupWatcher.current = null;
        }
        setPending(null);
        // Force-refresh this integration so the row flips state immediately
        // instead of waiting for the 5s poll.
        void refreshOne(integrationId);
      }
    }, 800);
  };

  const handleConnect = (c: ConnectionStatus) => {
    openAuthPopup(
      c.id,
      `Approve the ${c.name} sign-in in the popup. We'll update this row as soon as it's ready.`,
    );
  };

  const handleReconnect = (c: ConnectionStatus) => {
    openAuthPopup(
      c.id,
      `Approve the extra ${c.name} permissions in the popup. We'll update this row as soon as the new access is granted.`,
    );
  };

  const handleDisconnectConfirm = () => {
    const c = confirmDisconnect;
    setConfirmDisconnect(null);
    if (!c) return;
    // We can't revoke a Replit connection from this app — the user has to
    // do it on their account page. Open it for them and re-check when they
    // come back.
    openAuthPopup(
      c.id,
      `Remove ${c.name} from your Replit connections in the popup. We'll mark it disconnected as soon as you're done.`,
    );
  };

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">
      <div className="px-6 py-5 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
            <Plug2 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-2xl font-semibold font-display">Connections</div>
            <div className="text-sm text-muted-foreground mt-0.5">
              The accounts your assistants can use.
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-3">
          {connections === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your connections…
            </div>
          ) : connections.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No integrations are configured yet.
            </div>
          ) : (
            connections.map((c) => {
              const needsReauth =
                Boolean(c.connected) && Boolean(c.needs_reauthorization);
              const showPending = pending?.integrationId === c.id;
              const showBlocked = popupBlocked === c.id;
              const isHighlighted = highlight === c.id;
              return (
                <div
                  key={c.id}
                  ref={(el) => {
                    rowRefs.current.set(c.id, el);
                  }}
                  className={`rounded-xl border bg-card overflow-hidden transition-shadow ${
                    isHighlighted
                      ? "border-primary shadow-[0_0_0_2px_hsl(var(--primary)/0.4)]"
                      : "border-border"
                  }`}
                >
                  <div className="px-4 py-4 flex items-center gap-3">
                    {BRAND_ICONS[c.id] ? (
                      <div className="h-10 w-10 rounded-lg bg-white border border-border flex items-center justify-center shrink-0 overflow-hidden">
                        <img
                          src={BRAND_ICONS[c.id]}
                          alt=""
                          className="h-7 w-7 object-contain"
                        />
                      </div>
                    ) : (
                      <div
                        className="h-10 w-10 rounded-lg flex items-center justify-center text-white text-base font-bold shrink-0"
                        style={{ backgroundColor: c.brand_color || "#888" }}
                      >
                        {c.name.slice(0, 1)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-2">
                        {c.name}
                        <StatusBadge connection={c} />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">
                        {c.connected
                          ? c.identity ?? c.display_name ?? "Connected"
                          : `Not connected — ${c.label}`}
                      </div>
                      {needsReauth && c.reauthorization_message ? (
                        <div className="text-xs text-amber-300 mt-1">
                          {c.reauthorization_message}
                        </div>
                      ) : null}
                      {c.error ? (
                        <div className="text-xs text-amber-300 mt-1">
                          Couldn't reach {c.name}. Try again in a moment.
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {needsReauth ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleReconnect(c)}
                          className="h-8 gap-1.5"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Reconnect
                        </Button>
                      ) : c.connected ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmDisconnect(c)}
                          className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
                        >
                          Disconnect
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleConnect(c)}
                          className="h-8 gap-1.5"
                        >
                          <Plug className="h-3.5 w-3.5" /> Connect
                        </Button>
                      )}
                    </div>
                  </div>
                  {showPending ? (
                    <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/40 border-t border-border">
                      {pending!.message}
                    </div>
                  ) : null}
                  {showBlocked ? (
                    <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/40 border-t border-border flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>
                        Your browser blocked the popup. Open the Replit
                        connections page and finish there, then come back.
                      </span>
                      <a
                        href={CONNECTOR_AUTH_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-foreground/80 hover:text-foreground underline underline-offset-2"
                      >
                        Open Replit connections{" "}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>

      <Dialog
        open={Boolean(confirmDisconnect)}
        onOpenChange={(open) => {
          if (!open) setConfirmDisconnect(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect {confirmDisconnect?.name}?</DialogTitle>
            <DialogDescription>
              Any deployed assistant that depends on {confirmDisconnect?.name}{" "}
              will fail on its next run until you reconnect it. You'll be sent
              to your Replit connections page to remove the connection.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDisconnect(null)}>
              Cancel
            </Button>
            <Button onClick={handleDisconnectConfirm}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ connection }: { connection: ConnectionStatus }) {
  if (connection.connected && connection.needs_reauthorization) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
        <AlertTriangle className="h-3 w-3" /> Needs reconnect
      </span>
    );
  }
  if (connection.connected) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
        <CheckCircle2 className="h-3 w-3" /> Connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
      Not connected
    </span>
  );
}
