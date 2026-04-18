import { Button } from "@/components/ui/button";
import { Plus, Settings } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface SidebarProps {
  onNewAgent: () => void;
}

export function Sidebar({ onNewAgent }: SidebarProps) {
  return (
    <div className="h-full bg-sidebar flex flex-col text-sm border-r border-sidebar-border">
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

      <div className="flex-1" />

      <div className="p-3 border-t border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-2 hover:bg-sidebar-accent rounded-md cursor-pointer transition-colors duration-200">
          <Avatar className="h-8 w-8 rounded-sm">
            <AvatarFallback className="rounded-sm bg-primary/20 text-primary text-xs">
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
