import { Agent } from "@/lib/store";
import { SetupCard } from "./SetupCard";
import { BuiltApp } from "./BuiltApp";
import { Loader2 } from "lucide-react";

interface RightPanelProps {
  agent: Agent;
  onConnect: (apiKey: string, email: string) => void;
  onToggleRunning: () => void;
  onDisconnect: () => void;
}

export function RightPanel({
  agent,
  onConnect,
  onToggleRunning,
  onDisconnect,
}: RightPanelProps) {
  if (agent.phase === "building-app" && !agent.connection) {
    return (
      <div className="h-full flex items-center justify-center bg-card text-center px-6">
        <div className="space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <div className="text-sm text-muted-foreground">
            Scaffolding {agent.appName}…
          </div>
        </div>
      </div>
    );
  }

  if (agent.phase === "awaiting-credentials" || agent.phase === "building-app") {
    if (!agent.connection) {
      return <SetupCard agent={agent} onConnect={onConnect} />;
    }
  }

  if (agent.phase === "app-ready" && agent.connection) {
    return (
      <BuiltApp
        agent={agent}
        onToggleRunning={onToggleRunning}
        onDisconnect={onDisconnect}
      />
    );
  }

  return null;
}
