import { Button } from "@/components/ui/button";
import { Plug2, Plus, Settings } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Agent } from "@/lib/store";

interface SidebarProps {
  onNewAgent: () => void;
  onOpenConnections: () => void;
  onSelectAgent: (id: string) => void;
  activeView: "agent" | "connections";
  agents: Agent[];
  currentAgentId: string | null;
}

export function Sidebar({
  onNewAgent,
  onOpenConnections,
  onSelectAgent,
  activeView,
  agents,
  currentAgentId,
}: SidebarProps) {
  return (
    <div className="h-full bg-sidebar flex flex-col text-sm border-r border-sidebar-border">
      <div className="p-3 pl-12">
        <Button
          onClick={onNewAgent}
          variant="outline"
          className="w-full justify-start gap-2 h-11 border-sidebar-border hover:bg-sidebar-accent text-sidebar-foreground"
        >
          <Plus className="h-4 w-4" />
          New Agent
        </Button>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={onOpenConnections}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-md transition-colors duration-150 text-sm ${
            activeView === "connections"
              ? "bg-sidebar-accent text-sidebar-foreground"
              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          }`}
        >
          <Plug2 className="h-4 w-4" />
          <span className="font-medium">Connections</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 mt-2">
        {agents.length > 0 && (
          <div className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50 px-3 pt-2 pb-1">
            Agents
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {agents.map((a) => {
            const isActive = activeView === "agent" && a.id === currentAgentId;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelectAgent(a.id)}
                className={`w-full text-left px-3 py-2 rounded-md transition-colors duration-150 truncate ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
                title={a.name}
              >
                <span className="font-medium truncate">{a.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-2 hover:bg-sidebar-accent rounded-md cursor-pointer transition-colors duration-200">
          <Avatar className="h-8 w-8 rounded-sm">
            <AvatarFallback className="rounded-sm bg-muted text-foreground/70 text-xs">
              U
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 truncate font-medium text-sidebar-foreground">
            User Profile
          </div>
          <Settings className="h-4 w-4 text-sidebar-foreground/70" />
        </div>
      </div>
    </div>
  );
}
