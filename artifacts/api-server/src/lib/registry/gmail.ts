import { connectorFetch } from "../connectors";
import { wrapExternalContent } from "./external";
import type { IntegrationDefinition, IntegrationPrimitive } from "./types";

export const GMAIL_INTEGRATION: IntegrationDefinition = {
  id: "gmail",
  connector_name: "google-mail",
  name: "Gmail",
  label: "your inbox",
  description: "Read, search, and send email from your inbox.",
  brand_color: "#ea4335",
  required_scopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ],
  scope_equivalents: {
    "https://www.googleapis.com/auth/gmail.readonly": [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://mail.google.com/",
    ],
    "https://www.googleapis.com/auth/gmail.send": [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://mail.google.com/",
    ],
  },
  // /users/me/profile requires gmail.readonly (or modify/full-mail). If it
  // returns 403 with ACCESS_TOKEN_SCOPE_INSUFFICIENT, the connection only
  // has the addons-scoped permissions and needs to be reauthorized.
  scope_probe: { path: "/gmail/v1/users/me/profile" },
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
              subject: wrapExternalContent(
                "gmail email subject",
                getHeader(first?.payload?.headers, "Subject"),
              ),
              from: wrapExternalContent(
                "gmail email sender",
                getHeader(first?.payload?.headers, "From"),
              ),
              date: getHeader(first?.payload?.headers, "Date"),
              snippet: wrapExternalContent(
                "gmail email snippet",
                t.snippet ?? first?.snippet ?? "",
              ),
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
        from: wrapExternalContent(
          "gmail email sender",
          getHeader(m.payload?.headers, "From"),
        ),
        to: getHeader(m.payload?.headers, "To"),
        subject: wrapExternalContent(
          "gmail email subject",
          getHeader(m.payload?.headers, "Subject"),
        ),
        date: getHeader(m.payload?.headers, "Date"),
        snippet: wrapExternalContent(
          "gmail email snippet",
          m.snippet ?? "",
        ),
        body: wrapExternalContent(
          "gmail email body",
          extractText(m.payload).slice(0, 4000),
        ),
      }));
      ctx.log(`Read thread ${id} (${messages.length} messages).`);
      return {
        summary: `Read thread ${id} (${messages.length} messages). Subject: ${wrapExternalContent(
          "gmail email subject",
          getHeader(detail.messages?.[0]?.payload?.headers, "Subject") || "",
        )}`,
        data: messages,
      };
    },
  },
  {
    name: "gmail_send_email",
    integration_id: "gmail",
    label: "Send email",
    description:
      "Send a plain-text email from your account. Provide 'to' (comma-separated), 'subject', and 'body'. Optionally pass `summary_metrics` ({ kind, count, total }) — when set, the activity stream and tool result will use a canonical payoff line like 'Sent revenue summary for N charges totaling $X to <to>. Gmail message id: <id>.' so the deployed agent doesn't have to format that line itself.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string" },
        subject: { type: "string" },
        body: { type: "string" },
        reply_to_message_id: { type: "string" },
        summary_metrics: {
          type: "object",
          properties: {
            kind: {
              type: "string",
              description:
                "Short noun describing what was summarized, e.g. 'revenue summary', 'open invoices'.",
            },
            count: {
              type: "number",
              description: "How many items the summary covers (e.g. number of charges).",
            },
            unit: {
              type: "string",
              description: "Plural noun for the items, e.g. 'charges', 'invoices'.",
            },
            total: {
              type: "string",
              description:
                "Pre-formatted total string, e.g. '$1,234.56' or '€500.00'. Use the formatted total returned by stripe_list_charges.",
            },
          },
        },
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
      const metricsRaw = input["summary_metrics"];
      const metrics =
        metricsRaw && typeof metricsRaw === "object"
          ? (metricsRaw as Record<string, unknown>)
          : null;
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
      // When the caller supplies summary_metrics, format the canonical
      // payoff line in code so the activity stream and the deployed
      // agent both get the exact same wording. This is what the
      // "Stripe daily revenue" demo relies on for its closing line.
      let payoff: string;
      if (metrics) {
        const kind = String(metrics["kind"] ?? "summary");
        const count =
          typeof metrics["count"] === "number"
            ? metrics["count"]
            : Number(metrics["count"] ?? 0);
        const unit = String(
          metrics["unit"] ?? (count === 1 ? "item" : "items"),
        );
        const total = metrics["total"]
          ? ` totaling ${String(metrics["total"])}`
          : "";
        payoff = `Sent ${kind} for ${count} ${unit}${total} to ${to}. Gmail message id: ${result.id}.`;
      } else {
        payoff = `Sent email to ${to} ("${subject}"). Gmail message id: ${result.id}.`;
      }
      ctx.log(payoff);
      return {
        summary: payoff,
        data: {
          id: result.id,
          message_id: result.id,
          thread_id: result.threadId,
          to,
          subject,
          payoff,
        },
      };
    },
  },
];
