import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Plug, RefreshCw } from "lucide-react";
import { fetchConnections, type ConnectionStatus } from "@/lib/agent-api";
import { BRAND_ICONS } from "@/lib/brand-icons";

interface ConnectCardProps {
  integrationId: string;
  integrationName: string;
  integrationLabel?: string;
  onConnected?: (status: ConnectionStatus) => void;
}

const BRAND_PROMPTS: Record<string, string> = {
  gmail: "Connect your inbox (Gmail)",
  hubspot: "Connect your customer list (HubSpot)",
  stripe: "Connect your payments (Stripe)",
  drive: "Connect your files (Google Drive)",
  sheets: "Connect your spreadsheets (Google Sheets)",
  docs: "Connect your documents (Google Docs)",
  notion: "Connect your workspace (Notion)",
};

// All Replit connectors are managed from the same account-level page. This is
// the same destination the workspace uses to walk a user through OAuth — we
// open it in a popup so the user can grant (or re-grant) access in one click
// without leaving the assistant.
const CONNECTOR_AUTH_URL = "https://replit.com/account#connections";

interface Hint {
  message: string;
  /** Shown when the popup didn't open (blocked by browser). */
  fallbackUrl?: string;
}

export function ConnectCard({
  integrationId,
  integrationName,
  integrationLabel,
  onConnected,
}: ConnectCardProps) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState<Hint | null>(null);
  const popupWatcher = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    try {
      const all = await fetchConnections();
      const found = all.find((c) => c.id === integrationId) ?? null;
      setStatus(found);
      if (found?.connected && !found.needs_reauthorization) {
        setHint(null);
        if (onConnected) onConnected(found);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integrationId]);

  useEffect(() => {
    return () => {
      if (popupWatcher.current) clearInterval(popupWatcher.current);
    };
  }, []);

  /**
   * Open the Replit connector authorization page in a popup. If the popup
   * is blocked, return null so the caller can surface a fallback link.
   */
  const openAuthPopup = (): Window | null => {
    const features = "popup=yes,width=560,height=720,noopener=no";
    let win: Window | null = null;
    try {
      win = window.open(CONNECTOR_AUTH_URL, "replit-connector-auth", features);
    } catch {
      win = null;
    }
    if (!win) return null;
    try {
      win.focus();
    } catch {
      // ignore — focus can throw in cross-origin scenarios
    }
    if (popupWatcher.current) clearInterval(popupWatcher.current);
    popupWatcher.current = setInterval(() => {
      if (win!.closed) {
        if (popupWatcher.current) {
          clearInterval(popupWatcher.current);
          popupWatcher.current = null;
        }
        // The user finished (or cancelled). Refresh immediately so the card
        // flips to Connected without waiting for the 5s poll.
        void refresh();
      }
    }, 800);
    return win;
  };

  const handleConnect = () => {
    const win = openAuthPopup();
    if (win) {
      setHint({
        message: `Approve the ${integrationName} sign-in in the popup. This card turns green as soon as it's ready.`,
      });
    } else {
      setHint({
        message: `Your browser blocked the popup. Open the Replit connections page and authorize ${integrationName}, then come back.`,
        fallbackUrl: CONNECTOR_AUTH_URL,
      });
    }
  };

  const handleReconnect = () => {
    const win = openAuthPopup();
    if (win) {
      setHint({
        message: `Approve the extra ${integrationName} permissions when the popup opens. This card updates as soon as the new access is granted.`,
      });
    } else {
      setHint({
        message: `Your browser blocked the popup. Open the Replit connections page and re-authorize ${integrationName} with the extra permissions, then come back.`,
        fallbackUrl: CONNECTOR_AUTH_URL,
      });
    }
  };

  const brand = BRAND_PROMPTS[integrationId] ?? `Connect ${integrationName}`;
  const needsReauth = Boolean(status?.connected && status?.needs_reauthorization);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        {BRAND_ICONS[integrationId] ? (
          <div className="h-9 w-9 rounded-lg bg-white border border-border flex items-center justify-center shrink-0 overflow-hidden">
            <img
              src={BRAND_ICONS[integrationId]}
              alt=""
              className="h-6 w-6 object-contain"
            />
          </div>
        ) : (
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0"
            style={{ backgroundColor: status?.brand_color ?? "#888" }}
          >
            {integrationName.slice(0, 1)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{brand}</div>
          {loading ? (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking…
            </div>
          ) : needsReauth ? (
            <div className="text-xs text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              {status?.reauthorization_message ??
                `Reconnect to grant ${integrationName} the access this assistant needs.`}
            </div>
          ) : status?.connected ? (
            <div className="text-xs text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3" />
              Connected as {status.identity ?? status.display_name ?? "your account"}
            </div>
          ) : status?.error ? (
            <div className="text-xs text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              Couldn't reach {integrationName}. Try again in a moment.
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              Not connected — {integrationLabel ?? "needed for this assistant"}
            </div>
          )}
        </div>
        {!loading && needsReauth ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleReconnect}
            className="h-8 gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Reconnect
          </Button>
        ) : !status?.connected && !loading ? (
          <Button
            size="sm"
            onClick={handleConnect}
            className="h-8 gap-1.5"
          >
            <Plug className="h-3.5 w-3.5" /> Connect
          </Button>
        ) : null}
      </div>
      {hint ? (
        <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/40 border-t border-border flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{hint.message}</span>
          {hint.fallbackUrl ? (
            <a
              href={hint.fallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-foreground/80 hover:text-foreground underline underline-offset-2"
            >
              Open Replit connections <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
