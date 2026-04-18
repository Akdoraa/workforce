import { Agent } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { FileText, CreditCard, Users, Settings, LayoutDashboard, CheckSquare, Activity, MessageSquare, Briefcase, Zap } from "lucide-react";

interface RightPanelProps {
  agent: Agent | null;
}

export function RightPanel({ agent }: RightPanelProps) {
  if (!agent) return null;

  const getStatusColor = (status: Agent["status"]) => {
    switch (status) {
      case "Building": return "bg-primary/20 text-primary border-primary/30";
      case "Active": return "bg-emerald-500/20 text-emerald-500 border-emerald-500/30";
      case "Needs Input": return "bg-amber-500/20 text-amber-500 border-amber-500/30";
    }
  };

  const renderPreview = () => {
    switch (agent.archetype) {
      case "support":
        return <SupportPreview />;
      case "finance":
        return <FinancePreview />;
      case "sales":
        return <SalesPreview />;
      default:
        return <GenericPreview />;
    }
  };

  return (
    <div className="h-full flex flex-col bg-card relative z-0 border-l border-border">
      {/* Header / Identity Card */}
      <div className="p-6 border-b border-border bg-background/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Live Preview</div>
          <Badge variant="outline" className={`transition-colors duration-500 ${getStatusColor(agent.status)}`}>
            {agent.status === "Building" && (
              <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 animate-pulse" />
            )}
            {agent.status}
          </Badge>
        </div>
        
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 rounded-xl border border-border shadow-sm">
            <AvatarImage src={`https://api.dicebear.com/7.x/notionists/svg?seed=${agent.name}&backgroundColor=transparent`} />
            <AvatarFallback className="rounded-xl bg-primary/10">
              <Zap className="h-6 w-6 text-primary" />
            </AvatarFallback>
          </Avatar>
          <div>
            <h2 className="text-xl font-bold text-foreground transition-all duration-300">{agent.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground capitalize">{agent.archetype} Agent</span>
              {Object.values(agent.tools).some(Boolean) && (
                <>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground" />
                  <span className="text-xs text-muted-foreground flex gap-1">
                    {agent.tools.stripe && <span className="bg-indigo-500/20 text-indigo-400 px-1.5 rounded text-[10px]">Stripe</span>}
                    {agent.tools.jira && <span className="bg-blue-500/20 text-blue-400 px-1.5 rounded text-[10px]">Jira</span>}
                    {agent.tools.slack && <span className="bg-rose-500/20 text-rose-400 px-1.5 rounded text-[10px]">Slack</span>}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Generated Interface Preview */}
      <ScrollArea className="flex-1 p-6">
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both" key={agent.archetype}>
          {renderPreview()}
        </div>
      </ScrollArea>
    </div>
  );
}

function SupportPreview() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium flex items-center gap-2"><LayoutDashboard className="h-4 w-4" /> Tickets Dashboard</h3>
        <Badge variant="secondary">3 Open</Badge>
      </div>
      
      {[
        { id: "T-1042", title: "Login issue on mobile", status: "High", time: "10m ago" },
        { id: "T-1041", title: "Billing cycle clarification", status: "Medium", time: "1h ago" },
        { id: "T-1040", title: "Feature request: dark mode", status: "Low", time: "2h ago" },
      ].map((ticket, i) => (
        <Card key={i} className="p-4 bg-background border-border hover:bg-muted/50 transition-colors cursor-pointer">
          <div className="flex justify-between items-start mb-2">
            <div className="text-xs text-muted-foreground">{ticket.id}</div>
            <Badge variant="outline" className={ticket.status === "High" ? "text-red-400 border-red-400/30" : "text-muted-foreground"}>
              {ticket.status}
            </Badge>
          </div>
          <div className="font-medium text-sm mb-3">{ticket.title}</div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="h-7 text-xs w-full">Draft Reply</Button>
            <Button size="sm" variant="outline" className="h-7 w-7 p-0 shrink-0"><CheckSquare className="h-3 w-3" /></Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function FinancePreview() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium flex items-center gap-2"><Activity className="h-4 w-4" /> Financial Metrics</h3>
      </div>
      
      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card className="p-4 bg-background border-border">
          <div className="text-xs text-muted-foreground mb-1">MRR</div>
          <div className="text-2xl font-bold">$42.5k</div>
          <div className="text-xs text-emerald-500 mt-1">↑ 12% vs last month</div>
        </Card>
        <Card className="p-4 bg-background border-border">
          <div className="text-xs text-muted-foreground mb-1">Active Subs</div>
          <div className="text-2xl font-bold">1,204</div>
          <div className="text-xs text-emerald-500 mt-1">↑ 5% vs last month</div>
        </Card>
      </div>

      <h4 className="text-sm font-medium mb-3">Recent Transactions</h4>
      {[
        { amount: "$1,200.00", customer: "Acme Corp", status: "Completed" },
        { amount: "$450.00", customer: "Jane Doe", status: "Completed" },
        { amount: "$8,500.00", customer: "Globex Inc", status: "Pending" },
      ].map((tx, i) => (
        <Card key={i} className="p-3 bg-background border-border flex justify-between items-center">
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

function SalesPreview() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium flex items-center gap-2"><Briefcase className="h-4 w-4" /> Leads Pipeline</h3>
      </div>
      
      <div className="space-y-3">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Hot Leads</div>
        {[
          { name: "TechNova Solutions", value: "$24k", probability: "80%" },
          { name: "Apex Dynamics", value: "$12k", probability: "65%" },
        ].map((lead, i) => (
          <Card key={i} className="p-4 bg-background border-border border-l-4 border-l-primary">
            <div className="flex justify-between mb-1">
              <div className="font-medium text-sm">{lead.name}</div>
              <div className="font-bold text-sm">{lead.value}</div>
            </div>
            <div className="flex justify-between items-center mt-3">
              <div className="text-xs text-muted-foreground">Close Prob: {lead.probability}</div>
              <Button size="sm" className="h-7 text-xs bg-primary text-primary-foreground hover:bg-primary/90">Follow Up</Button>
            </div>
          </Card>
        ))}
      </div>

      <div className="space-y-3 mt-6">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Outreach Queue</div>
        {[
          { name: "Vanguard IT", contact: "Sarah L." },
          { name: "Quantum Media", contact: "Mike T." },
        ].map((lead, i) => (
          <Card key={i} className="p-3 bg-background border-border flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <div className="text-sm font-medium">{lead.name}</div>
                <div className="text-xs text-muted-foreground">{lead.contact}</div>
              </div>
            </div>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0"><MessageSquare className="h-3 w-3" /></Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function GenericPreview() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-medium flex items-center gap-2"><CheckSquare className="h-4 w-4" /> Agent Tasks</h3>
      </div>
      
      <div className="grid gap-3">
        {[
          { title: "Analyze incoming data", desc: "Monitor connected sources", active: true },
          { title: "Generate reports", desc: "Weekly automated summaries", active: false },
          { title: "Send notifications", desc: "Alert on critical events", active: false },
        ].map((task, i) => (
          <Card key={i} className="p-4 bg-background border-border">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 h-4 w-4 rounded border flex items-center justify-center ${task.active ? "bg-primary border-primary" : "border-muted-foreground"}`}>
                {task.active && <CheckSquare className="h-3 w-3 text-primary-foreground" />}
              </div>
              <div>
                <div className="font-medium text-sm">{task.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{task.desc}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
