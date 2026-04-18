import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Plug } from "lucide-react";
import { fetchConnections, type ConnectionStatus } from "@/lib/agent-api";

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
};

export function ConnectCard({
  integrationId,
  integrationName,
  integrationLabel,
  onConnected,
}: ConnectCardProps) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const all = await fetchConnections();
      const found = all.find((c) => c.id === integrationId) ?? null;
      setStatus(found);
      if (found?.connected && onConnected) onConnected(found);
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

  const handleConnect = () => {
    // Replit connector OAuth happens through the platform — when the user
    // completes setup the polling above will detect it.
    window.alert(
      `To connect ${integrationName}, accept the connection prompt that appears in the workspace. This card will turn green once it's wired up.`,
    );
    void refresh();
  };

  const brand = BRAND_PROMPTS[integrationId] ?? `Connect ${integrationName}`;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        <div
          className="h-9 w-9 rounded-lg flex items-center justify-center text-white text-sm font-bold shrink-0"
          style={{ backgroundColor: status?.brand_color ?? "#888" }}
        >
          {integrationName.slice(0, 1)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{brand}</div>
          {loading ? (
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking…
            </div>
          ) : status?.connected ? (
            <div className="text-xs text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3" />
              Connected as {status.identity ?? status.display_name ?? "your account"}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              Not connected — {integrationLabel ?? "needed for this assistant"}
            </div>
          )}
        </div>
        {!status?.connected && !loading ? (
          <Button
            size="sm"
            onClick={handleConnect}
            className="h-8 gap-1.5"
          >
            <Plug className="h-3.5 w-3.5" /> Connect
          </Button>
        ) : null}
      </div>
    </div>
  );
}
