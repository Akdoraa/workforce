import { useState } from "react";
import { Agent } from "@/lib/store";
import { SERVICE_META } from "@/lib/agent-logic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Lock, ShieldCheck, Loader2 } from "lucide-react";

const SERVICE_COLORS: Record<
  Agent["service"],
  { bg: string; border: string; text: string }
> = {
  stripe: { bg: "bg-indigo-500/15", border: "border-indigo-500/30", text: "text-indigo-400" },
  jira: { bg: "bg-blue-500/15", border: "border-blue-500/30", text: "text-blue-400" },
  slack: { bg: "bg-rose-500/15", border: "border-rose-500/30", text: "text-rose-400" },
  generic: { bg: "bg-violet-500/15", border: "border-violet-500/30", text: "text-violet-400" },
};

interface SetupCardProps {
  agent: Agent;
  onConnect: (apiKey: string, email: string) => void;
}

export function SetupCard({ agent, onConnect }: SetupCardProps) {
  const meta = SERVICE_META[agent.service];
  const colors = SERVICE_COLORS[agent.service];
  const [apiKey, setApiKey] = useState("");
  const [email, setEmail] = useState("");
  const isBuilding = agent.phase === "building-app";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim() || !email.trim() || isBuilding) return;
    onConnect(apiKey.trim(), email.trim());
  };

  return (
    <div className="h-full overflow-auto p-8 flex items-start justify-center">
      <Card className="w-full max-w-md p-7 bg-background border-border">
        <div className="flex items-center gap-3 mb-5">
          <div
            className={`h-12 w-12 rounded-xl ${colors.bg} flex items-center justify-center border ${colors.border}`}
          >
            <span className={`text-xl font-bold ${colors.text}`}>
              {meta.label.charAt(0)}
            </span>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Step 1 of 2 · Connect data
            </div>
            <h2 className="text-lg font-semibold leading-tight">
              Connect {meta.label} to build {agent.appName}
            </h2>
          </div>
        </div>

        <p className="text-sm text-muted-foreground mb-5">{meta.description}</p>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs">
              Account email
            </Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-card border-border"
              disabled={isBuilding}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="apikey" className="text-xs">
              {meta.fieldLabel}
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                id="apikey"
                type="password"
                autoComplete="off"
                placeholder={meta.keyPlaceholder}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="bg-card border-border pl-9 font-mono text-xs"
                disabled={isBuilding}
              />
            </div>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3" />
              Stored locally in this session. We never send it anywhere.
            </p>
          </div>

          <Button
            type="submit"
            disabled={!apiKey.trim() || !email.trim() || isBuilding}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-10"
          >
            {isBuilding ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Building your {agent.appName}…
              </>
            ) : (
              <>Connect {meta.label} & build my app</>
            )}
          </Button>
        </form>
      </Card>
    </div>
  );
}

