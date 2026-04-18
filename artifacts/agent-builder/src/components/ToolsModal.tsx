import { useState } from "react";
import { ToolConnection } from "@/lib/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface ToolsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tools: ToolConnection;
  onUpdateTools: (tools: ToolConnection) => void;
}

export function ToolsModal({ open, onOpenChange, tools, onUpdateTools }: ToolsModalProps) {
  const [localTools, setLocalTools] = useState(tools);
  const [creds, setCreds] = useState({ stripe: "", jira: "", slack: "" });

  const handleConnect = (tool: keyof ToolConnection) => {
    if (!creds[tool].trim() && !localTools[tool]) return;
    
    const newTools = { ...localTools, [tool]: !localTools[tool] };
    setLocalTools(newTools);
    onUpdateTools(newTools);
    
    if (newTools[tool]) {
      setCreds({ ...creds, [tool]: "" }); // clear on connect
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card text-foreground border-border">
        <DialogHeader>
          <DialogTitle>Connect Tools</DialogTitle>
          <DialogDescription>
            Give your agent access to external services.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <ToolItem 
            name="Stripe" 
            id="stripe"
            description="Access payment and subscription data"
            isConnected={localTools.stripe}
            credValue={creds.stripe}
            onCredChange={(v) => setCreds({ ...creds, stripe: v })}
            onConnect={() => handleConnect("stripe")}
          />
          <ToolItem 
            name="Jira" 
            id="jira"
            description="Manage issues and project boards"
            isConnected={localTools.jira}
            credValue={creds.jira}
            onCredChange={(v) => setCreds({ ...creds, jira: v })}
            onConnect={() => handleConnect("jira")}
          />
          <ToolItem 
            name="Slack" 
            id="slack"
            description="Send messages and monitor channels"
            isConnected={localTools.slack}
            credValue={creds.slack}
            onCredChange={(v) => setCreds({ ...creds, slack: v })}
            onConnect={() => handleConnect("slack")}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToolItem({ 
  name, 
  id, 
  description, 
  isConnected, 
  credValue, 
  onCredChange, 
  onConnect 
}: { 
  name: string; 
  id: string;
  description: string; 
  isConnected: boolean;
  credValue: string;
  onCredChange: (val: string) => void;
  onConnect: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg border border-border bg-background/50">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-sm">{name}</h4>
            <Badge variant="outline" className={isConnected ? "text-emerald-500 border-emerald-500/30" : "text-muted-foreground"}>
              {isConnected ? "Connected" : "Not Connected"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
      </div>
      
      <div className="flex gap-2 items-center mt-2">
        {!isConnected ? (
          <>
            <Input 
              placeholder={`Enter ${name} API Key...`} 
              value={credValue}
              onChange={(e) => onCredChange(e.target.value)}
              className="h-8 text-xs bg-background border-border"
              type="password"
            />
            <Button 
              size="sm" 
              onClick={onConnect}
              disabled={!credValue.trim()}
              className="h-8 bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
            >
              Connect
            </Button>
          </>
        ) : (
          <Button 
            size="sm" 
            variant="destructive"
            onClick={onConnect}
            className="h-8 w-full"
          >
            Disconnect
          </Button>
        )}
      </div>
    </div>
  );
}
