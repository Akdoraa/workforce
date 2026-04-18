import { Agent } from "@/lib/store";
import { StripeBuiltApp } from "./StripeBuiltApp";
import { SlackBuiltApp } from "./SlackBuiltApp";

interface BuiltAppProps {
  agent: Agent;
  onToggleRunning: () => void;
  onDisconnect: () => void;
}

export function BuiltApp(props: BuiltAppProps) {
  const service = props.agent.service ?? "generic";
  if (service === "stripe") return <StripeBuiltApp {...props} />;
  if (service === "slack") return <SlackBuiltApp {...props} />;
  return (
    <div className="h-full w-full flex items-center justify-center bg-background text-sm text-muted-foreground">
      No live dashboard for this service yet.
    </div>
  );
}
