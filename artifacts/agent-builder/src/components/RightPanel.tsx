import { useState } from "react";
import { Agent, ToolConnection } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { ToolsModal } from "./ToolsModal";
import { extractEntities, pastTense } from "@/lib/prompt-extract";
import {
  CreditCard,
  Users,
  LayoutDashboard,
  CheckSquare,
  Activity,
  MessageSquare,
  Briefcase,
  Zap,
  Play,
  Pause,
  Sparkles,
  Inbox,
  Bell,
} from "lucide-react";

interface RightPanelProps {
  agent: Agent;
  tools: ToolConnection;
  onUpdateTools: (tools: ToolConnection) => void;
}

export function RightPanel({ agent, tools, onUpdateTools }: RightPanelProps) {
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const getStatusColor = (status: Agent["status"]) => {
    switch (status) {
      case "Building":
        return "bg-primary/20 text-primary border-primary/30";
      case "Active":
        return "bg-emerald-500/20 text-emerald-500 border-emerald-500/30";
      case "Needs Input":
        return "bg-amber-500/20 text-amber-500 border-amber-500/30";
    }
  };

  const renderDashboard = () => {
    switch (agent.archetype) {
      case "support":
        return <SupportDashboard isRunning={isRunning} />;
      case "finance":
        return <FinanceDashboard isRunning={isRunning} />;
      case "sales":
        return <SalesDashboard isRunning={isRunning} />;
      default:
        return (
          <CustomDashboard
            isRunning={isRunning}
            prompt={agent.prompt ?? ""}
          />
        );
    }
  };

  const isBuilding = agent.status === "Building";
  const anyToolConnected = Object.values(tools).some(Boolean);

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
                {agent.name}
              </h2>
              <Badge
                variant="outline"
                className={`transition-colors duration-500 text-[10px] py-0 h-5 ${getStatusColor(
                  agent.status,
                )}`}
              >
                {isBuilding && (
                  <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 animate-pulse" />
                )}
                {agent.status}
              </Badge>
            </div>
            <div className="text-xs text-muted-foreground capitalize">
              {agent.archetype} agent dashboard
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="rounded-full text-xs h-8"
            onClick={() => setIsToolsOpen(true)}
          >
            + Connect Tools
            {anyToolConnected && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary/20 text-primary text-[10px] font-medium">
                {Object.values(tools).filter(Boolean).length}
              </span>
            )}
          </Button>
          <Button
            size="sm"
            className="rounded-full h-8 bg-primary hover:bg-primary/90 text-primary-foreground"
            disabled={isBuilding}
            onClick={() => setIsRunning((r) => !r)}
          >
            {isRunning ? (
              <>
                <Pause className="h-3.5 w-3.5 mr-1" /> Stop
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 mr-1" /> Run agent
              </>
            )}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 p-6">
        <div
          className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both"
          key={agent.archetype}
        >
          {renderDashboard()}
        </div>
      </ScrollArea>

      <ToolsModal
        open={isToolsOpen}
        onOpenChange={setIsToolsOpen}
        tools={tools}
        onUpdateTools={onUpdateTools}
      />
    </div>
  );
}

function RunningDot({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-500">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      Live
    </span>
  );
}

function SupportDashboard({ isRunning }: { isRunning: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4" /> Tickets queue
        </h3>
        <div className="flex items-center gap-3">
          <RunningDot active={isRunning} />
          <Badge variant="secondary">3 open</Badge>
        </div>
      </div>

      {[
        {
          id: "T-1042",
          title: "Login issue on mobile",
          status: "High",
          time: "10m ago",
        },
        {
          id: "T-1041",
          title: "Billing cycle clarification",
          status: "Medium",
          time: "1h ago",
        },
        {
          id: "T-1040",
          title: "Feature request: dark mode",
          status: "Low",
          time: "2h ago",
        },
      ].map((ticket, i) => (
        <Card
          key={i}
          className="p-4 bg-background border-border hover-elevate cursor-pointer"
        >
          <div className="flex justify-between items-start mb-2">
            <div className="text-xs text-muted-foreground">
              {ticket.id} · {ticket.time}
            </div>
            <Badge
              variant="outline"
              className={
                ticket.status === "High"
                  ? "text-red-400 border-red-400/30"
                  : "text-muted-foreground"
              }
            >
              {ticket.status}
            </Badge>
          </div>
          <div className="font-medium text-sm mb-3">{ticket.title}</div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              className="h-7 text-xs flex-1"
            >
              {isRunning ? "Reply drafted by agent" : "Draft reply"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0 shrink-0"
            >
              <CheckSquare className="h-3 w-3" />
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function FinanceDashboard({ isRunning }: { isRunning: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium flex items-center gap-2">
          <Activity className="h-4 w-4" /> Financial metrics
        </h3>
        <RunningDot active={isRunning} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-2">
        <Card className="p-4 bg-background border-border">
          <div className="text-xs text-muted-foreground mb-1">MRR</div>
          <div className="text-2xl font-bold">$42.5k</div>
          <div className="text-xs text-emerald-500 mt-1">↑ 12% vs last mo</div>
        </Card>
        <Card className="p-4 bg-background border-border">
          <div className="text-xs text-muted-foreground mb-1">Active subs</div>
          <div className="text-2xl font-bold">1,204</div>
          <div className="text-xs text-emerald-500 mt-1">↑ 5% vs last mo</div>
        </Card>
      </div>

      <h4 className="text-sm font-medium mb-3 mt-4">Recent transactions</h4>
      {[
        { amount: "$1,200.00", customer: "Acme Corp", status: "Completed" },
        { amount: "$450.00", customer: "Jane Doe", status: "Completed" },
        { amount: "$8,500.00", customer: "Globex Inc", status: "Pending" },
      ].map((tx, i) => (
        <Card
          key={i}
          className="p-3 bg-background border-border flex justify-between items-center"
        >
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-muted flex items-center justify-center">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <div className="text-sm font-medium">{tx.customer}</div>
              <div className="text-xs text-muted-foreground">{tx.status}</div>
            </div>
          </div>
          <div className="font-medium">{tx.amount}</div>
        </Card>
      ))}
    </div>
  );
}

function SalesDashboard({ isRunning }: { isRunning: boolean }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium flex items-center gap-2">
          <Briefcase className="h-4 w-4" /> Leads pipeline
        </h3>
        <RunningDot active={isRunning} />
      </div>

      <div className="space-y-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Hot leads
        </div>
        {[
          { name: "TechNova Solutions", value: "$24k", probability: "80%" },
          { name: "Apex Dynamics", value: "$12k", probability: "65%" },
        ].map((lead, i) => (
          <Card
            key={i}
            className="p-4 bg-background border-border border-l-4 border-l-primary"
          >
            <div className="flex justify-between mb-1">
              <div className="font-medium text-sm">{lead.name}</div>
              <div className="font-bold text-sm">{lead.value}</div>
            </div>
            <div className="flex justify-between items-center mt-3">
              <div className="text-xs text-muted-foreground">
                Close prob: {lead.probability}
              </div>
              <Button
                size="sm"
                className="h-7 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {isRunning ? "Outreach sent" : "Follow up"}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <div className="space-y-3 mt-6">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Outreach queue
        </div>
        {[
          { name: "Vanguard IT", contact: "Sarah L." },
          { name: "Quantum Media", contact: "Mike T." },
        ].map((lead, i) => (
          <Card
            key={i}
            className="p-3 bg-background border-border flex justify-between items-center"
          >
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <div className="text-sm font-medium">{lead.name}</div>
                <div className="text-xs text-muted-foreground">
                  {lead.contact}
                </div>
              </div>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
              <MessageSquare className="h-3 w-3" />
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CustomDashboard({
  isRunning,
  prompt,
}: {
  isRunning: boolean;
  prompt: string;
}) {
  const entities = extractEntities(prompt || "items");
  const domainTitle =
    entities.domainPlural.charAt(0).toUpperCase() +
    entities.domainPlural.slice(1);
  const verb = entities.verbs[0]
    ? entities.verbs[0].charAt(0).toUpperCase() + entities.verbs[0].slice(1)
    : "Process";

  const counts = [
    { label: entities.metricLabels[0], value: isRunning ? "1,284" : "1,210", trend: "+74" },
    { label: entities.metricLabels[1], value: isRunning ? "42" : "0", trend: isRunning ? "live" : "idle" },
    { label: entities.metricLabels[2], value: "7", trend: "" },
  ];

  const verbPast = pastTense(verb);
  const feed = isRunning
    ? entities.itemNames.slice(0, 4).map((name, i) => ({
        title: `${verbPast} ${name}`,
        desc: `Agent ${pastTense(entities.verbs[0] ?? "process")} this ${entities.domain} automatically`,
        time: `${(i + 1) * 2}s ago`,
      }))
    : [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-medium flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> {domainTitle} workspace
        </h3>
        <RunningDot active={isRunning} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {counts.map((c, i) => (
          <Card key={i} className="p-3 bg-background border-border">
            <div className="text-[11px] text-muted-foreground mb-1 truncate">
              {c.label}
            </div>
            <div className="text-xl font-bold">{c.value}</div>
            {c.trend && (
              <div className="text-[11px] text-emerald-500 mt-0.5">
                {c.trend}
              </div>
            )}
          </Card>
        ))}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">{domainTitle} queue</h4>
        </div>
        <div className="grid gap-2">
          {entities.itemNames.map((item, i) => (
            <Card
              key={i}
              className="p-3 bg-background border-border flex items-center justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{item}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {isRunning
                    ? `${verbPast} by agent`
                    : `Awaiting ${entities.verbs[0] ?? "review"}`}
                </div>
              </div>
              <Button
                size="sm"
                variant={isRunning ? "secondary" : "outline"}
                className="h-7 text-xs ml-3 shrink-0"
                disabled={isRunning}
              >
                {isRunning ? "Done" : verb}
              </Button>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-medium">Live activity</h4>
        </div>
        {feed.length === 0 ? (
          <Card className="p-4 bg-background border-border border-dashed text-center">
            <div className="text-xs text-muted-foreground">
              Press <span className="text-foreground font-medium">Run agent</span> to start processing.
            </div>
          </Card>
        ) : (
          <div className="space-y-2">
            {feed.map((event, i) => (
              <Card
                key={i}
                className="p-3 bg-background border-border flex items-start gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300"
              >
                <div className="h-7 w-7 rounded bg-primary/10 flex items-center justify-center shrink-0">
                  <Activity className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {event.title}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {event.desc}
                  </div>
                </div>
                <div className="text-[11px] text-muted-foreground shrink-0">
                  {event.time}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
