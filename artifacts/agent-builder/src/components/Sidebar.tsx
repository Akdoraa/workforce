import { Agent } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MessageSquare, Settings, User } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface SidebarProps {
  agents: Agent[];
  currentAgentId: string | null;
  onNewAgent: () => void;
  onSwitchAgent: (id: string) => void;
}

export function Sidebar({ agents, currentAgentId, onNewAgent, onSwitchAgent }: SidebarProps) {
  return (
    <div className="w-[260px] flex-shrink-0 bg-sidebar flex flex-col h-full text-sm">
      <div className="p-3">
        <Button 
          onClick={onNewAgent}
          variant="outline" 
          className="w-full justify-start gap-2 h-11 border-sidebar-border hover:bg-sidebar-accent text-sidebar-foreground"
        >
          <Plus className="h-4 w-4" />
          New Agent
        </Button>
      </div>

      <ScrollArea className="flex-1 px-3">
        <div className="flex flex-col gap-1 pb-4">
          {agents.map(agent => (
            <button
              key={agent.id}
              onClick={() => onSwitchAgent(agent.id)}
              className={`flex items-center gap-2 px-3 py-3 rounded-md text-left transition-colors duration-200 ${
                currentAgentId === agent.id 
                  ? "bg-sidebar-accent text-sidebar-foreground" 
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              }`}
            >
              <MessageSquare className="h-4 w-4 shrink-0" />
              <span className="truncate flex-1">{agent.name}</span>
            </button>
          ))}
        </div>
      </ScrollArea>

      <div className="p-3 border-t border-sidebar-border mt-auto">
        <div className="flex items-center gap-2 px-2 py-2 hover:bg-sidebar-accent rounded-md cursor-pointer transition-colors duration-200">
          <Avatar className="h-8 w-8 rounded-sm">
            <AvatarFallback className="rounded-sm bg-primary/20 text-primary text-xs">U</AvatarFallback>
          </Avatar>
          <div className="flex-1 truncate font-medium text-sidebar-foreground">User Profile</div>
          <Settings className="h-4 w-4 text-sidebar-foreground/70" />
        </div>
      </div>
    </div>
  );
}
