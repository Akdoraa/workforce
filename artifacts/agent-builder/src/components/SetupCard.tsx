import { useState } from "react";
import { Agent } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { SERVICE_META } from "@/lib/agent-logic";
import { Loader2, ShieldCheck, Sparkles } from "lucide-react";

interface SetupCardProps {
  agent: Agent;
  onConnect: () => Promise<void>;
}

export function SetupCard({ agent, onConnect }: SetupCardProps) {
  const [loading, setLoading] = useState(false);
  const service = agent.service ?? "generic";
  const meta = SERVICE_META[service];

  const handleClick = async () => {
    if (!meta.enabled) return;
    setLoading(true);
    try {
      await onConnect();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full w-full flex items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card overflow-hidden">
        <div
          className={`h-24 bg-gradient-to-br ${meta.accent} flex items-center justify-center`}
        >
          <div className="h-14 w-14 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
            <Sparkles className="h-7 w-7 text-white" />
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div className="space-y-1.5 text-center">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Building {agent.appName ?? "your app"}
            </div>
            <h2 className="text-xl font-semibold">
              Connect {meta.name} to continue
            </h2>
            <p className="text-sm text-muted-foreground">{meta.tagline}</p>
          </div>

          {meta.enabled ? (
            <Button
              onClick={handleClick}
              disabled={loading}
              className={`w-full h-11 font-medium gap-2 ${meta.buttonClass}`}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verifying connection…
                </>
              ) : (
                <>Sign in with {meta.brandLabel}</>
              )}
            </Button>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground space-y-2">
              <p>
                Real{" "}
                <span className="text-foreground font-medium">{meta.name}</span>{" "}
                sign-in is coming next. For now, try a prompt about Stripe
                payments or your Slack workspace to build a real app.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground justify-center text-center">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span>
              Authentication happens through {meta.name}. Your password is
              never shared with this app.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
