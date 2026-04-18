import { useState, useRef, useEffect } from "react";
import { Agent, ToolConnection } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowUp, Bot, User } from "lucide-react";
import { ToolsModal } from "./ToolsModal";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface ChatAreaProps {
  agent: Agent | null;
  onSendMessage: (text: string) => void;
  tools: ToolConnection;
  onUpdateTools: (tools: ToolConnection) => void;
}

export function ChatArea({ agent, onSendMessage, tools, onUpdateTools }: ChatAreaProps) {
  const [input, setInput] = useState("");
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const isBuilding = agent?.status === "Building";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [agent?.messages, isBuilding]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isBuilding) return;
    onSendMessage(input);
    setInput("");
  };

  return (
    <div className="flex-1 flex flex-col h-full relative max-w-3xl mx-auto w-full">
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-8 pb-32 space-y-6"
      >
        {agent?.messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4 px-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-2xl font-semibold">What kind of agent can I help you build?</h2>
            <p className="text-muted-foreground max-w-md">
              Describe its purpose, tools it needs, or the workflows it should automate. I'll build it for you live.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {agent?.messages.map((msg) => (
              <div 
                key={msg.id} 
                className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"} animate-in fade-in slide-in-from-bottom-2 duration-300`}
              >
                <Avatar className={`h-8 w-8 shrink-0 ${msg.role === "assistant" ? "bg-primary/20" : "bg-secondary/20"}`}>
                  <AvatarFallback className="bg-transparent">
                    {msg.role === "assistant" ? <Bot className="h-5 w-5 text-primary" /> : <User className="h-5 w-5 text-secondary" />}
                  </AvatarFallback>
                </Avatar>
                
                <div className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} max-w-[80%]`}>
                  <div className={`px-4 py-3 rounded-2xl ${
                    msg.role === "user" 
                      ? "bg-primary text-primary-foreground rounded-tr-sm" 
                      : "bg-muted text-foreground rounded-tl-sm"
                  }`}>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              </div>
            ))}
            
            {isBuilding && (
              <div className="flex gap-4 flex-row animate-in fade-in slide-in-from-bottom-2">
                <Avatar className="h-8 w-8 shrink-0 bg-primary/20">
                  <AvatarFallback className="bg-transparent">
                    <Bot className="h-5 w-5 text-primary" />
                  </AvatarFallback>
                </Avatar>
                <div className="px-4 py-3 rounded-2xl bg-muted text-foreground rounded-tl-sm flex items-center gap-1.5">
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="h-2 w-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-background via-background to-transparent pt-10">
        <div className="max-w-3xl mx-auto w-full">
          <div className="mb-2">
            <Button 
              variant="outline" 
              size="sm" 
              className="rounded-full bg-background border-border text-xs text-muted-foreground hover:text-foreground h-7"
              onClick={() => setIsToolsOpen(true)}
            >
              + Connect Tools
            </Button>
          </div>
          
          <form onSubmit={handleSubmit} className="relative flex items-center">
            <div className="absolute inset-0 bg-muted/50 rounded-2xl border border-border" />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="Describe the AI agent you want to build..."
              className="w-full bg-transparent border-0 focus:ring-0 resize-none py-4 pl-4 pr-12 max-h-[200px] min-h-[56px] text-sm relative z-10"
              rows={1}
              disabled={isBuilding}
            />
            <Button 
              type="submit" 
              size="icon"
              disabled={!input.trim() || isBuilding}
              className="absolute right-2 bottom-2 h-10 w-10 rounded-full z-10 bg-primary hover:bg-primary/90 text-primary-foreground disabled:opacity-50 disabled:bg-muted disabled:text-muted-foreground"
            >
              <ArrowUp className="h-5 w-5" />
            </Button>
          </form>
          <div className="text-center mt-2">
            <span className="text-[11px] text-muted-foreground">Agent Builder can make mistakes. Check important information.</span>
          </div>
        </div>
      </div>

      <ToolsModal 
        open={isToolsOpen} 
        onOpenChange={setIsToolsOpen} 
        tools={tools} 
        onUpdateTools={onUpdateTools} 
      />
    </div>
  );
}
