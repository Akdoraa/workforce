import { useState } from "react";
import { Agent } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Zap,
  Plug,
  Bell,
  Wrench,
  Sparkles,
  FileText,
  Rocket,
  CheckCircle2,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { deployAgent } from "@/lib/builder-client";
import { Blueprint } from "@workspace/api-zod";

interface BlueprintPreviewProps {
  agent: Agent;
  onUpdateAgent: (updates: Partial<Agent>) => void;
}

export function BlueprintPreview({
  agent,
  onUpdateAgent,
}: BlueprintPreviewProps) {
  const [isDeploying, setIsDeploying] = useState(false);
  const bp = agent.blueprint;

  const handleDeploy = async () => {
    setIsDeploying(true);
    onUpdateAgent({
      status: "Deploying",
      blueprint: Blueprint.parse({ ...bp, status: "deploying" }),
    });
    try {
      const result = await deployAgent(agent.id);
      onUpdateAgent({
        status: "Deployed",
        blueprint: Blueprint.parse({
          ...bp,
          status: "deployed",
          deployment: { id: result.deployment_id, url: result.url },
        }),
      });
    } catch (e) {
      console.error(e);
      onUpdateAgent({
        status: "Active",
        blueprint: Blueprint.parse({ ...bp, status: "ready" }),
      });
    } finally {
      setIsDeploying(false);
    }
  };

  const getStatusColor = (status: Agent["status"]) => {
    switch (status) {
      case "Building":
        return "bg-primary/20 text-primary border-primary/30";
      case "Active":
        return "bg-emerald-500/20 text-emerald-500 border-emerald-500/30";
      case "Needs Input":
        return "bg-amber-500/20 text-amber-500 border-amber-500/30";
      case "Deploying":
        return "bg-blue-500/20 text-blue-400 border-blue-400/30";
      case "Deployed":
        return "bg-emerald-500/20 text-emerald-500 border-emerald-500/30";
    }
  };

  const isBuilding = agent.status === "Building";
  const isReady = bp.status === "ready" || bp.status === "deploying" || bp.status === "deployed";
  const isDeployed = bp.status === "deployed";

  return (
    <div className="h-full flex flex-col bg-card relative z-0 min-w-0">
      <div className="px-6 py-4 border-b border-border bg-background/40 backdrop-blur-sm flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="h-11 w-11 rounded-xl border border-border shadow-sm shrink-0">
            <AvatarImage
              src={`https://api.dicebear.com/7.x/notionists/svg?seed=${agent.name}&backgroundColor=transparent`}
            />
            <AvatarFallback className="rounded-xl bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground truncate">
                {bp.name && bp.name !== "New Agent" ? bp.name : agent.name}
              </h2>
              <Badge
                variant="outline"
                className={`transition-colors duration-500 text-[10px] py-0 h-5 ${getStatusColor(
                  agent.status,
                )}`}
              >
                {(isBuilding || agent.status === "Deploying") && (
                  <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 animate-pulse" />
                )}
                {agent.status}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground capitalize">
              Blueprint · {bp.status}
            </div>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 p-6">
        <div className="space-y-6">
          {isReady && (
            <Card
              className={`p-5 border-2 ${
                isDeployed
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-primary/40 bg-primary/5"
              } animate-in fade-in slide-in-from-top-2 duration-500`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
                    isDeployed
                      ? "bg-emerald-500/20 text-emerald-500"
                      : "bg-primary/20 text-primary"
                  }`}
                >
                  {isDeployed ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <Rocket className="h-5 w-5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold mb-0.5">
                    {isDeployed
                      ? "Deployed (stub)"
                      : agent.status === "Deploying"
                        ? "Deploying…"
                        : "Ready to deploy"}
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    {isDeployed
                      ? "Your agent is live in stub mode. Real deployment lands in the next task."
                      : "Your blueprint is complete. Click deploy to spin up your agent."}
                  </p>
                  {isDeployed && bp.deployment ? (
                    <a
                      href={bp.deployment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-mono"
                    >
                      {bp.deployment.url}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <Button
                      onClick={handleDeploy}
                      disabled={isDeploying || agent.status === "Deploying"}
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                      size="sm"
                    >
                      {isDeploying || agent.status === "Deploying" ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          Deploying…
                        </>
                      ) : (
                        <>
                          <Rocket className="h-3.5 w-3.5 mr-1.5" />
                          Deploy agent
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )}

          <Section
            icon={<FileText className="h-4 w-4" />}
            title="System prompt"
          >
            {bp.system_prompt ? (
              <Card className="p-4 bg-background border-border">
                <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                  {bp.system_prompt}
                </p>
              </Card>
            ) : (
              <Placeholder text="The agent's purpose and tone will appear here as you describe it." />
            )}
          </Section>

          <Section
            icon={<Plug className="h-4 w-4" />}
            title="Integrations"
            count={bp.integrations.length}
          >
            {bp.integrations.length === 0 ? (
              <Placeholder text="Mention a tool like Slack, Stripe, or Jira and the builder will wire it in." />
            ) : (
              <div className="flex flex-wrap gap-2">
                {bp.integrations.map((integration) => (
                  <Badge
                    key={integration.id}
                    variant="outline"
                    className="px-2.5 py-1 text-xs bg-primary/10 text-primary border-primary/30 animate-in fade-in zoom-in-95 duration-300"
                    title={integration.reason}
                  >
                    <Plug className="h-3 w-3 mr-1.5" />
                    {integration.name}
                  </Badge>
                ))}
              </div>
            )}
          </Section>

          <Section
            icon={<Bell className="h-4 w-4" />}
            title="Triggers"
            count={bp.triggers.length}
          >
            {bp.triggers.length === 0 ? (
              <Placeholder text="What kicks the agent off? E.g. a new ticket, a daily schedule, a webhook." />
            ) : (
              <div className="space-y-2">
                {bp.triggers.map((trigger) => (
                  <Card
                    key={trigger.id}
                    className="p-3 bg-background border-border flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-300"
                  >
                    <div className="h-7 w-7 rounded bg-primary/10 flex items-center justify-center shrink-0">
                      <Bell className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="text-sm">{trigger.description}</div>
                  </Card>
                ))}
              </div>
            )}
          </Section>

          <Section
            icon={<Wrench className="h-4 w-4" />}
            title="Tools"
            count={bp.tools.length}
          >
            {bp.tools.length === 0 ? (
              <Placeholder text="Concrete actions the agent can take will appear here." />
            ) : (
              <div className="space-y-2">
                {bp.tools.map((tool) => (
                  <Card
                    key={tool.id}
                    className="p-3 bg-background border-border flex items-center gap-3 animate-in fade-in slide-in-from-left-2 duration-300"
                  >
                    <div className="h-7 w-7 rounded bg-secondary/15 flex items-center justify-center shrink-0">
                      <Wrench className="h-3.5 w-3.5 text-secondary" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {tool.name}
                      </div>
                      {tool.description && (
                        <div className="text-xs text-muted-foreground truncate">
                          {tool.description}
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Section>

          <Section
            icon={<Sparkles className="h-4 w-4" />}
            title="Capabilities"
            count={bp.capabilities.length}
          >
            {bp.capabilities.length === 0 ? (
              <Placeholder text="The builder will propose capabilities that go beyond your literal request." />
            ) : (
              <ul className="space-y-1.5">
                {bp.capabilities.map((cap) => (
                  <li
                    key={cap.id}
                    className="flex items-start gap-2 text-sm animate-in fade-in slide-in-from-left-2 duration-300"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                    <span className="text-foreground/85">
                      {cap.description}
                      {cap.proposed && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-primary/70">
                          proposed
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </ScrollArea>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className="text-muted-foreground">{icon}</div>
        <h4 className="text-sm font-medium">{title}</h4>
        {count !== undefined && count > 0 && (
          <Badge
            variant="secondary"
            className="text-[10px] h-4 px-1.5 rounded-full"
          >
            {count}
          </Badge>
        )}
      </div>
      {children}
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <Card className="p-3 bg-background/40 border-dashed border-border">
      <p className="text-xs text-muted-foreground italic">{text}</p>
    </Card>
  );
}
