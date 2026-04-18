import { connectorFetch } from "../connectors";
import { wrapExternalContent } from "./external";
import type { IntegrationDefinition, IntegrationPrimitive } from "./types";

export const DOCS_INTEGRATION: IntegrationDefinition = {
  id: "docs",
  connector_name: "google-docs",
  name: "Google Docs",
  label: "your documents",
  description: "Create, read, and append text in your Google Docs.",
  brand_color: "#4285f4",
  // Docs primitives include writes (create/append), so the read-only
  // `documents.readonly` scope is intentionally NOT in the
  // equivalents. The probe hits the docs API with a sentinel id: a
  // connection with the right scope returns 404 (ok); one without
  // returns 403 with ACCESS_TOKEN_SCOPE_INSUFFICIENT, which
  // runScopeProbe picks up and flips needs_reauthorization.
  required_scopes: ["https://www.googleapis.com/auth/documents"],
  scope_equivalents: {
    "https://www.googleapis.com/auth/documents": [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/drive.file",
    ],
  },
  scope_probe: {
    path: "/v1/documents/0:batchUpdate",
    method: "POST",
    body: { requests: [] },
    treat_404_as_ok: true,
  },
};

const MAX_DOC_CHARS = 8000;

async function docsRequest<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await connectorFetch("google-docs", path, {
    method: init.method,
    body: init.body,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Docs ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

interface DocElement {
  paragraph?: {
    elements?: Array<{ textRun?: { content?: string } }>;
  };
  table?: {
    tableRows?: Array<{
      tableCells?: Array<{ content?: DocElement[] }>;
    }>;
  };
}

function extractDocText(content: DocElement[] | undefined): string {
  if (!content) return "";
  const parts: string[] = [];
  for (const el of content) {
    if (el.paragraph?.elements) {
      for (const e of el.paragraph.elements) {
        if (e.textRun?.content) parts.push(e.textRun.content);
      }
    } else if (el.table?.tableRows) {
      for (const row of el.table.tableRows) {
        for (const cell of row.tableCells ?? []) {
          parts.push(extractDocText(cell.content));
        }
      }
    }
  }
  return parts.join("");
}

export const DOCS_PRIMITIVES: IntegrationPrimitive[] = [
  {
    name: "docs_create_document",
    integration_id: "docs",
    label: "Create a document",
    description:
      "Create a new Google Doc with a title and (optional) initial body text.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["title"],
    },
    async handler(input, ctx) {
      const title = String(input["title"]);
      const body = input["body"] ? String(input["body"]) : "";
      const created = await docsRequest<{ documentId: string }>(
        `/v1/documents`,
        {
          method: "POST",
          body: JSON.stringify({ title }),
        },
      );
      if (body) {
        await docsRequest(
          `/v1/documents/${encodeURIComponent(created.documentId)}:batchUpdate`,
          {
            method: "POST",
            body: JSON.stringify({
              requests: [
                {
                  insertText: {
                    location: { index: 1 },
                    text: body,
                  },
                },
              ],
            }),
          },
        );
      }
      ctx.log(`Created a new document "${title}".`);
      return {
        summary: `Created document "${title}".`,
        data: {
          document_id: created.documentId,
          url: `https://docs.google.com/document/d/${created.documentId}/edit`,
        },
      };
    },
  },
  {
    name: "docs_read_document",
    integration_id: "docs",
    label: "Read a document",
    description: "Read the plain-text contents of a Google Doc by id.",
    input_schema: {
      type: "object",
      properties: {
        document_id: { type: "string" },
      },
      required: ["document_id"],
    },
    async handler(input, ctx) {
      const id = String(input["document_id"]);
      const data = await docsRequest<{
        title?: string;
        body?: { content?: DocElement[] };
      }>(`/v1/documents/${encodeURIComponent(id)}`);
      const fullText = extractDocText(data.body?.content);
      const text = fullText.slice(0, MAX_DOC_CHARS);
      const title = data.title ?? "";
      ctx.log(`Read document "${title}" (${text.length} chars).`);
      return {
        summary: `Read document "${title}" (${text.length} chars).`,
        data: {
          document_id: id,
          title: wrapExternalContent("google doc title", title),
          content: wrapExternalContent("google doc body", text),
          truncated: fullText.length > text.length,
        },
      };
    },
  },
  {
    name: "docs_append_text",
    integration_id: "docs",
    label: "Append text to a document",
    description:
      "Append plain text to the end of a Google Doc. The text is added on a new line.",
    input_schema: {
      type: "object",
      properties: {
        document_id: { type: "string" },
        text: { type: "string" },
      },
      required: ["document_id", "text"],
    },
    async handler(input, ctx) {
      const id = String(input["document_id"]);
      const text = String(input["text"]);
      const toInsert = text.startsWith("\n") ? text : `\n${text}`;
      await docsRequest(
        `/v1/documents/${encodeURIComponent(id)}:batchUpdate`,
        {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                insertText: {
                  endOfSegmentLocation: {},
                  text: toInsert,
                },
              },
            ],
          }),
        },
      );
      ctx.log(`Appended ${text.length} chars to document ${id}.`);
      return {
        summary: `Appended ${text.length} characters to the document.`,
        data: { document_id: id, appended_chars: text.length },
      };
    },
  },
];
