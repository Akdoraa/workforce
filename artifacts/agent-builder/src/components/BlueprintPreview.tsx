import { type Blueprint } from "@workspace/api-zod";
import { Button } from "@/components/ui/button";
import { Calendar, Eye, Heart, Loader2, Sparkles, Wrench } from "lucide-react";
import { ConnectCard } from "./ConnectCard";
import { useEffect, useState } from "react";
import { fetchConnections, type ConnectionStatus } from "@/lib/agent-api";

interface BlueprintPreviewProps {
  blueprint: Blueprint;
  onDeploy: () => void;
  deploying: boolean;
}

function describeCronHuman(
  cron: string | undefined,
  tz: string | undefined,
): string {
  if (!cron) return "on demand";
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [m, h, , , dow] = parts;
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const tzLabel = tz ?? "UTC";
  if (dow !== "*") {
    const days = dow
      .split(",")
      .map((d) => dayNames[Number(d) % 7])
      .join(", ");
    return `every ${days} at ${time} ${tzLabel}`;
  }
  return `every day at ${time} ${tzLabel}`;
}

export function BlueprintPreview({
  blueprint,
  onDeploy,
  deploying,
}: BlueprintPreviewProps) {
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);

  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      const c = await fetchConnections();
      if (mounted) setConnections(c);
    };
    void refresh();
    const id = setInterval(refresh, 4000);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  const requiredIds = blueprint.integrations.map((i) => i.id);
  const allConnected =
    requiredIds.length > 0 &&
    requiredIds.every(
      (id) => connections.find((c) => c.id === id)?.connected,
    );

  const ready = blueprint.status === "ready" || allConnected;
  const canDeploy = ready && allConnected && !deploying;

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">
      <div className="px-6 py-5 border-b border-border shrink-0">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Your assistant
        </div>
        <div className="text-2xl font-semibold mt-1">{blueprint.name}</div>
        {blueprint.role_summary ? (
          <div className="text-sm text-muted-foreground mt-1">
            {blueprint.role_summary}
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-2xl mx-auto w-full">
        {blueprint.watches.length > 0 ? (
          <Section icon={<Eye className="h-4 w-4" />} title="What I'll watch">
            <ul className="space-y-1.5">
              {blueprint.watches.map((w, i) => (
                <li key={i} className="text-sm flex gap-2">
                  <span className="text-muted-foreground">•</span>
                  {w}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {blueprint.capabilities.length > 0 || blueprint.tools.length > 0 ? (
          <Section icon={<Wrench className="h-4 w-4" />} title="What I'll do">
            <ul className="space-y-1.5">
              {blueprint.capabilities.map((c) => (
                <li key={c.id} className="text-sm flex gap-2">
                  <span className="text-muted-foreground">•</span>
                  {c.description}
                </li>
              ))}
              {blueprint.tools.map((t) => (
                <li key={t.id} className="text-sm flex gap-2 text-muted-foreground">
                  <span>·</span>
                  Can {t.name.toLowerCase()}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {blueprint.triggers.length > 0 ? (
          <Section icon={<Calendar className="h-4 w-4" />} title="When I'll do it">
            <ul className="space-y-1.5">
              {blueprint.triggers.map((t) => (
                <li key={t.id} className="text-sm flex gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>
                    {t.description}
                    {t.cron ? (
                      <span className="text-muted-foreground">
                        {" "}
                        — {describeCronHuman(t.cron, t.timezone)}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {blueprint.integrations.length > 0 ? (
          <Section
            icon={<Sparkles className="h-4 w-4" />}
            title="Accounts I need access to"
          >
            <div className="space-y-2">
              {blueprint.integrations.map((i) => (
                <ConnectCard
                  key={i.id}
                  integrationId={i.id}
                  integrationName={i.name}
                  integrationLabel={i.label}
                />
              ))}
            </div>
          </Section>
        ) : null}

        {blueprint.soul ? (
          <Section icon={<Heart className="h-4 w-4" />} title="How I'll sound">
            <div className="text-sm text-muted-foreground italic whitespace-pre-wrap">
              {blueprint.soul}
            </div>
          </Section>
        ) : null}
      </div>

      <div className="border-t border-border p-4 shrink-0 bg-card/40">
        <Button
          className="w-full h-11 gap-2"
          disabled={!canDeploy}
          onClick={onDeploy}
        >
          {deploying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Deploying…
            </>
          ) : !ready ? (
            "Still planning…"
          ) : !allConnected ? (
            "Connect every account to deploy"
          ) : (
            "Deploy assistant"
          )}
        </Button>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <div className="text-primary">{icon}</div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
          {title}
        </div>
      </div>
      {children}
    </div>
  );
}
