import { useState, useRef, useEffect } from "react";
import { Agent, type MessageActivity } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ArrowUp, User, Check, Loader2 } from "lucide-react";
import logoUrl from "@assets/workforce_logo_(1)_1776495693230.png";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface ChatAreaProps {
  agent: Agent | null;
  onSendMessage: (text: string) => void;
  variant: "welcome" | "compact";
}

// Internal tool kinds that are pure plumbing — never shown.
const HIDDEN_KINDS = new Set([
  "set_voice",
  "set_rules",
  "finalize_blueprint",
]);

// Internal tool kinds that we collapse into a single summary row when they
// appear in a run, instead of showing each invocation.
const COLLAPSE_KINDS: Record<string, (n: number) => string> = {
  add_capability: (n) => (n === 1 ? "Added a capability" : `Added ${n} capabilities`),
  add_trigger: (n) => (n === 1 ? "Set up a trigger" : `Set up ${n} triggers`),
};

interface DisplayActivity {
  id: string;
  label: string;
}

/**
 * Filter and group raw activities into a short, human-readable list.
 * - Hides low-signal internal steps entirely.
 * - Collapses repeated generic steps into a single summary row.
 * - Keeps named steps (set_role, add_integration, add_tool) as-is.
 * - De-duplicates immediate repeats of the same label.
 */
function groupActivities(activities: MessageActivity[]): DisplayActivity[] {
  // Pre-count collapsible kinds, and remember the *last* index at which
  // each collapsed kind appears. Emitting the summary at the last position
  // (instead of the first) keeps the live "in progress" spinner attached
  // to the most chronologically recent meaningful step.
  const counts: Record<string, number> = {};
  const lastIndex: Record<string, number> = {};
  activities.forEach((a, idx) => {
    if (a.kind && a.kind in COLLAPSE_KINDS) {
      counts[a.kind] = (counts[a.kind] ?? 0) + 1;
      lastIndex[a.kind] = idx;
    }
  });

  const out: DisplayActivity[] = [];
  let lastLabel: string | null = null;

  activities.forEach((a, idx) => {
    const kind = a.kind ?? "";
    if (HIDDEN_KINDS.has(kind)) return;

    if (kind in COLLAPSE_KINDS) {
      if (idx !== lastIndex[kind]) return;
      const total = counts[kind] ?? 1;
      const label = COLLAPSE_KINDS[kind]!(total);
      out.push({ id: `summary-${kind}-${a.id}`, label });
      lastLabel = label;
      return;
    }

    if (a.label === lastLabel) return;
    out.push({ id: a.id, label: a.label });
    lastLabel = a.label;
  });

  return out;
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
        placeholder="Describe the workflow you want to automate..."
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
          <div className="h-14 w-14 rounded-2xl bg-card border border-border flex items-center justify-center p-2">
            <img
              src={logoUrl}
              alt="Logo"
              className="h-full w-full object-contain"
            />
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              What should we automate?
            </h1>
            <p className="text-muted-foreground">
              Describe the workflow. We'll deploy the agent.
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
        <div className="h-7 w-7 rounded-lg bg-card border border-border flex items-center justify-center p-1">
          <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
        </div>
        <div className="text-sm font-medium truncate">
          {agent?.name ?? "Agent"}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-6 space-y-5"
      >
        {agent?.messages.map((msg, idx) => {
          const isLastAssistant =
            msg.role === "assistant" &&
            idx === (agent?.messages.length ?? 0) - 1;
          const liveAssistant = isLastAssistant && isBuilding;
          const activities = groupActivities(msg.activities ?? []);
          const hasContent = msg.content.length > 0;
          return (
            <div
              key={msg.id}
              className={`flex gap-3 ${
                msg.role === "user" ? "flex-row-reverse" : "flex-row"
              } animate-in fade-in slide-in-from-bottom-2 duration-300`}
            >
              <Avatar className="h-7 w-7 shrink-0 bg-muted">
                <AvatarFallback className="bg-transparent">
                  {msg.role === "assistant" ? (
                    <img src={logoUrl} alt="" className="h-4 w-4 object-contain" />
                  ) : (
                    <User className="h-4 w-4 text-foreground/70" />
                  )}
                </AvatarFallback>
              </Avatar>

              <div
                className={`flex flex-col gap-1.5 ${
                  msg.role === "user" ? "items-end" : "items-start"
                } max-w-[85%]`}
              >
                {msg.role === "assistant" && activities.length > 0 && (
                  <div className="flex flex-col gap-1 w-full">
                    {activities.map((act, i) => {
                      const isLastActivity =
                        i === activities.length - 1 && liveAssistant;
                      return (
                        <div
                          key={act.id}
                          className="flex items-center gap-2 text-xs text-muted-foreground animate-in fade-in slide-in-from-left-2 duration-300"
                        >
                          <div
                            className={`h-4 w-4 rounded-full flex items-center justify-center shrink-0 ${
                              isLastActivity
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-foreground/60"
                            }`}
                          >
                            {isLastActivity ? (
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            ) : (
                              <Check className="h-2.5 w-2.5" />
                            )}
                          </div>
                          <span
                            className={
                              isLastActivity
                                ? "text-foreground/80"
                                : "text-muted-foreground"
                            }
                          >
                            {act.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {hasContent && (
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
                )}

                {liveAssistant && !hasContent && activities.length === 0 && (
                  <div className="px-3.5 py-2.5 rounded-2xl bg-card border border-border text-foreground rounded-tl-sm flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                    <span className="text-xs text-muted-foreground">
                      Thinking…
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isBuilding &&
          (() => {
            const last = agent?.messages[agent.messages.length - 1];
            if (last && last.role === "assistant") return null;
            return (
              <div className="flex gap-3 flex-row animate-in fade-in slide-in-from-bottom-2">
                <Avatar className="h-7 w-7 shrink-0 bg-muted">
                  <AvatarFallback className="bg-transparent">
                    <img src={logoUrl} alt="" className="h-4 w-4 object-contain" />
                  </AvatarFallback>
                </Avatar>
                <div className="px-3.5 py-2.5 rounded-2xl bg-card border border-border text-foreground rounded-tl-sm flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                  <span className="text-xs text-muted-foreground">
                    Thinking…
                  </span>
                </div>
              </div>
            );
          })()}
      </div>

      <div className="p-3 border-t border-border shrink-0">{inputForm}</div>
    </div>
  );
}
