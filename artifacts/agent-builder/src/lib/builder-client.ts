import {
  BuilderStreamEvent,
  type Blueprint,
  type BuilderChatMessage,
} from "@workspace/api-zod";

const API_BASE = `${import.meta.env.BASE_URL}api`;

export interface BuilderStreamHandlers {
  onText: (delta: string) => void;
  onToolCall: (name: string, args: Record<string, unknown>) => void;
  onPatch: (patch: Partial<Blueprint>) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

export async function streamBuilderChat(
  blueprint: Blueprint,
  messages: BuilderChatMessage[],
  handlers: BuilderStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/builder/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blueprint, messages }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    handlers.onError(`Builder request failed: ${res.status} ${text}`);
    handlers.onDone();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const block of events) {
      const line = block
        .split("\n")
        .find((l) => l.startsWith("data:"));
      if (!line) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        continue;
      }
      const evt = BuilderStreamEvent.safeParse(parsed);
      if (!evt.success) continue;
      const data = evt.data;
      switch (data.type) {
        case "text":
          handlers.onText(data.content);
          break;
        case "tool_call":
          handlers.onToolCall(data.name, data.args);
          break;
        case "blueprint_patch":
          handlers.onPatch(data.patch);
          break;
        case "error":
          handlers.onError(data.message);
          break;
        case "done":
          handlers.onDone();
          return;
      }
    }
  }
  handlers.onDone();
}

export async function deployAgent(agentId: string): Promise<{
  deployment_id: string;
  url: string;
}> {
  const res = await fetch(`${API_BASE}/agents/${agentId}/deploy`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Deploy failed: ${res.status}`);
  }
  return res.json();
}
