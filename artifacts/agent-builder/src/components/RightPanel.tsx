import { Agent } from "@/lib/store";
import { SetupCard } from "./SetupCard";
import { BuiltApp } from "./BuiltApp";
import { Loader2 } from "lucide-react";

interface RightPanelProps {
  agent: Agent;
  onConnect: () => Promise<void>;
  onToggleRunning: () => void;
  onDisconnect: () => void;
}

export function RightPanel({
  agent,
  onConnect,
  onToggleRunning,
  onDisconnect,
}: RightPanelProps) {
  if (agent.phase === "awaiting-credentials") {
    return <SetupCard agent={agent} onConnect={onConnect} />;
  }
  if (agent.phase === "building-app") {
    return (
      <div className="h-full w-full flex flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
        <div className="text-sm text-muted-foreground">
          Building {agent.appName ?? "your app"}…
        </div>
      </div>
    );
  }
  if (agent.phase === "app-ready") {
    return (
      <BuiltApp
        agent={agent}
        onToggleRunning={onToggleRunning}
        onDisconnect={onDisconnect}
      />
    );
  }
  // welcome — never rendered (App.tsx hides the right panel)
  return null;
}
