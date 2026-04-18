import { useState, useRef, useEffect } from "react";
import { Agent } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ArrowUp, Bot, User, Sparkles } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface ChatAreaProps {
  agent: Agent | null;
  onSendMessage: (text: string) => void;
  variant: "welcome" | "compact";
}

export function ChatArea({ agent, onSendMessage, variant }: ChatAreaProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const isBuilding = !!agent?.generating;

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

  const inputForm = (
    <form onSubmit={handleSubmit} className="relative flex items-center">
      <div className="absolute inset-0 bg-muted/50 rounded-2xl border border-border" />
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
          }
        }}
        placeholder="Describe the AI agent dashboard you want to build..."
        className="w-full bg-transparent border-0 focus:ring-0 resize-none py-4 pl-4 pr-12 max-h-[200px] min-h-[56px] text-sm relative z-10 outline-none"
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
  );

  if (variant === "welcome") {
    return (
      <div className="flex-1 flex flex-col h-full items-center justify-center px-6">
        <div className="w-full max-w-2xl flex flex-col items-center text-center space-y-6">
          <div className="h-14 w-14 rounded-2xl bg-card border border-border flex items-center justify-center">
            <Sparkles className="h-7 w-7 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              What dashboard should I build for you?
            </h1>
            <p className="text-muted-foreground">
              Describe the AI agent you want. I'll generate the live dashboard
              on the right — then you can run it.
            </p>
          </div>
          <div className="w-full">{inputForm}</div>
          <div className="flex flex-wrap gap-2 justify-center pt-2">
            {[
              "A customer support triage agent",
              "A finance metrics & invoices agent",
              "A sales pipeline outreach agent",
            ].map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => setInput(suggestion)}
                className="text-xs text-muted-foreground hover:text-foreground border border-border rounded-full px-3 py-1.5 transition-colors hover-elevate"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full relative min-w-0">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 shrink-0">
        <div className="h-7 w-7 rounded-lg bg-card border border-border flex items-center justify-center">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="text-sm font-medium truncate">
          {agent?.name ?? "Agent"}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 space-y-5"
      >
        {agent?.messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${
              msg.role === "user" ? "flex-row-reverse" : "flex-row"
            } animate-in fade-in slide-in-from-bottom-2 duration-300`}
          >
            <Avatar className="h-7 w-7 shrink-0 bg-muted">
              <AvatarFallback className="bg-transparent">
                {msg.role === "assistant" ? (
                  <Bot className="h-4 w-4 text-foreground/70" />
                ) : (
                  <User className="h-4 w-4 text-foreground/70" />
                )}
              </AvatarFallback>
            </Avatar>

            <div
              className={`flex flex-col ${
                msg.role === "user" ? "items-end" : "items-start"
              } max-w-[85%]`}
            >
              <div
                className={`px-3.5 py-2.5 rounded-2xl ${
                  msg.role === "user"
                    ? "bg-secondary text-secondary-foreground rounded-tr-sm"
                    : "bg-card border border-border text-foreground rounded-tl-sm"
                }`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </p>
              </div>
            </div>
          </div>
        ))}

        {isBuilding && (
          <div className="flex gap-3 flex-row animate-in fade-in slide-in-from-bottom-2">
            <Avatar className="h-7 w-7 shrink-0 bg-muted">
              <AvatarFallback className="bg-transparent">
                <Bot className="h-4 w-4 text-foreground/70" />
              </AvatarFallback>
            </Avatar>
            <div className="px-3.5 py-2.5 rounded-2xl bg-card border border-border text-foreground rounded-tl-sm flex items-center gap-1.5">
              <div
                className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
                style={{ animationDelay: "0ms" }}
              />
              <div
                className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
                style={{ animationDelay: "150ms" }}
              />
              <div
                className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce"
                style={{ animationDelay: "300ms" }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="p-3 border-t border-border shrink-0">{inputForm}</div>
    </div>
  );
}
