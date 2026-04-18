import {
  type Blueprint,
  type BlueprintPatch,
  type BuilderChatMessage,
  type BuilderStreamEvent,
} from "@workspace/api-zod";

const API_BASE = `${import.meta.env.BASE_URL}api`;

interface Handlers {
  onText: (delta: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onPatch: (patch: BlueprintPatch) => void;
  onError?: (msg: string) => void;
  onDone?: () => void;
}

export async function streamBuilderChat(
  blueprint: Blueprint,
  messages: BuilderChatMessage[],
  handlers: Handlers,
): Promise<void> {
  const res = await fetch(`${API_BASE}/builder/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blueprint, messages }),
  });
  if (!res.ok || !res.body) {
    handlers.onError?.(`Server returned ${res.status}`);
    handlers.onDone?.();
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneCalled = false;
  const fireDone = () => {
    if (doneCalled) return;
    doneCalled = true;
    handlers.onDone?.();
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const chunk of parts) {
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          const evt = JSON.parse(payload) as BuilderStreamEvent;
          if (evt.type === "text") handlers.onText(evt.content);
          else if (evt.type === "tool_call")
            handlers.onToolCall?.(evt.name, evt.args);
          else if (evt.type === "blueprint_patch")
            handlers.onPatch(evt.patch as BlueprintPatch);
          else if (evt.type === "error") handlers.onError?.(evt.message);
          else if (evt.type === "done") fireDone();
        } catch {
          // ignore malformed
        }
      }
    }
  } finally {
    fireDone();
  }
}
