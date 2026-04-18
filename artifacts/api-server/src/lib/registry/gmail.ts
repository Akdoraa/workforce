import { connectorFetch } from "../connectors";
import type { IntegrationDefinition, IntegrationPrimitive } from "./types";

export const GMAIL_INTEGRATION: IntegrationDefinition = {
  id: "gmail",
  connector_name: "google-mail",
  name: "Gmail",
  label: "your inbox",
  description: "Read, search, and send email from your inbox.",
  brand_color: "#ea4335",
};

async function gmailRequest<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await connectorFetch("google-mail", path, {
    method: init.method,
    body: init.body,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Gmail ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function decodeBase64Url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf-8");
}

interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
  headers?: Array<{ name: string; value: string }>;
}

function extractText(part: GmailMessagePart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.parts) {
    for (const p of part.parts) {
      const t = extractText(p);
      if (t) return t;
    }
  }
  if (part.body?.data) return decodeBase64Url(part.body.data);
  return "";
}

function getHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string,
): string {
  if (!headers) return "";
  const h = headers.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return h?.value ?? "";
}

export const GMAIL_PRIMITIVES: IntegrationPrimitive[] = [
  {
    name: "gmail_search_threads",
    integration_id: "gmail",
    label: "Search inbox threads",
    description:
      "Search Gmail threads using a query (Gmail search syntax). Returns thread IDs and subjects.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Gmail search query, e.g. 'is:inbox newer_than:7d', 'from:foo@bar.com'.",
        },
        max_results: { type: "number", default: 10 },
      },
      required: ["query"],
    },
    async handler(input, ctx) {
      const query = String(input["query"] ?? "");
      const max = Math.min(Number(input["max_results"] ?? 10), 25);
      const data = await gmailRequest<{
        threads?: Array<{ id: string; snippet?: string }>;
      }>(
        `/gmail/v1/users/me/threads?q=${encodeURIComponent(query)}&maxResults=${max}`,
      );
      const threads = data.threads ?? [];
      const enriched = await Promise.all(
        threads.slice(0, max).map(async (t) => {
          try {
            const detail = await gmailRequest<{
              id: string;
              messages?: Array<{
                payload?: GmailMessagePart;
                snippet?: string;
              }>;
            }>(
              `/gmail/v1/users/me/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            );
            const first = detail.messages?.[0];
            return {
              thread_id: t.id,
              subject: getHeader(first?.payload?.headers, "Subject"),
              from: getHeader(first?.payload?.headers, "From"),
              date: getHeader(first?.payload?.headers, "Date"),
              snippet: t.snippet ?? first?.snippet ?? "",
            };
          } catch {
            return { thread_id: t.id, subject: "", from: "", snippet: "" };
          }
        }),
      );
      ctx.log(`Read ${enriched.length} threads from your inbox.`);
      return {
        summary: `Found ${enriched.length} threads matching "${query}".`,
        data: enriched,
      };
    },
  },
  {
    name: "gmail_get_thread",
    integration_id: "gmail",
    label: "Read a thread",
    description: "Get the full message bodies of a Gmail thread.",
    input_schema: {
      type: "object",
      properties: {
        thread_id: { type: "string" },
      },
      required: ["thread_id"],
    },
    async handler(input, ctx) {
      const id = String(input["thread_id"] ?? "");
      const detail = await gmailRequest<{
        id: string;
        messages?: Array<{
          id: string;
          payload?: GmailMessagePart;
          snippet?: string;
          internalDate?: string;
        }>;
      }>(`/gmail/v1/users/me/threads/${id}?format=full`);
      const messages = (detail.messages ?? []).map((m) => ({
        id: m.id,
        from: getHeader(m.payload?.headers, "From"),
        to: getHeader(m.payload?.headers, "To"),
        subject: getHeader(m.payload?.headers, "Subject"),
        date: getHeader(m.payload?.headers, "Date"),
        snippet: m.snippet,
        body: extractText(m.payload).slice(0, 4000),
      }));
      ctx.log(`Read thread ${id} (${messages.length} messages).`);
      return {
        summary: `Read thread "${messages[0]?.subject ?? id}" (${messages.length} messages).`,
        data: messages,
      };
    },
  },
  {
    name: "gmail_send_email",
    integration_id: "gmail",
    label: "Send email",
    description:
      "Send an email from your account. Supports plain text body. Provide 'to' (comma-separated) and 'subject' and 'body'.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        reply_to_message_id: { type: "string" },
      },
      required: ["to", "subject", "body"],
    },
    async handler(input, ctx) {
      const to = String(input["to"] ?? "");
      const subject = String(input["subject"] ?? "");
      const body = String(input["body"] ?? "");
      const replyId = input["reply_to_message_id"]
        ? String(input["reply_to_message_id"])
        : undefined;
      const lines = [
        `To: ${to}`,
        `Subject: ${subject}`,
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "",
        body,
      ];
      const raw = Buffer.from(lines.join("\r\n"), "utf-8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      const payload: Record<string, unknown> = { raw };
      if (replyId) payload["threadId"] = replyId;
      const result = await gmailRequest<{ id: string; threadId: string }>(
        `/gmail/v1/users/me/messages/send`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
      ctx.log(`Sent email to ${to} ("${subject}").`);
      return {
        summary: `Sent email to ${to} ("${subject}").`,
        data: { id: result.id, thread_id: result.threadId },
      };
    },
  },
];
