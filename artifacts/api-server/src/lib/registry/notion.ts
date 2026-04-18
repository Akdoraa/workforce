import { connectorFetch } from "../connectors";
import { wrapExternalContent } from "./external";
import type { IntegrationDefinition, IntegrationPrimitive } from "./types";

const NOTION_VERSION = "2022-06-28";
const MAX_RESULTS = 25;
const MAX_BLOCK_CHARS = 8000;

export const NOTION_INTEGRATION: IntegrationDefinition = {
  id: "notion",
  connector_name: "notion",
  name: "Notion",
  label: "your workspace",
  description: "Search, read, and write pages and databases in Notion.",
  brand_color: "#000000",
  scope_probe: { path: "/v1/users/me", method: "GET" },
};

async function notionRequest<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await connectorFetch("notion", path, {
    method: init.method,
    body: init.body,
    headers: {
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Notion ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

interface RichTextItem {
  plain_text?: string;
  text?: { content?: string };
}

interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

function richToText(rich: RichTextItem[] | undefined): string {
  if (!rich) return "";
  return rich
    .map((r) => r.plain_text ?? r.text?.content ?? "")
    .join("");
}

function blockToText(block: NotionBlock): string {
  const t = block.type;
  const inner = (block as Record<string, unknown>)[t] as
    | { rich_text?: RichTextItem[]; text?: RichTextItem[]; title?: RichTextItem[] }
    | undefined;
  if (!inner) return "";
  const rich = inner.rich_text ?? inner.text ?? inner.title ?? [];
  const text = richToText(rich);
  switch (t) {
    case "heading_1":
      return `# ${text}`;
    case "heading_2":
      return `## ${text}`;
    case "heading_3":
      return `### ${text}`;
    case "bulleted_list_item":
    case "numbered_list_item":
      return `- ${text}`;
    case "to_do": {
      const checked = (inner as { checked?: boolean }).checked;
      return `- [${checked ? "x" : " "}] ${text}`;
    }
    case "code":
      return `\`\`\`\n${text}\n\`\`\``;
    case "quote":
      return `> ${text}`;
    default:
      return text;
  }
}

function pageTitle(page: Record<string, unknown>): string {
  const props = (page["properties"] ?? {}) as Record<string, unknown>;
  for (const v of Object.values(props)) {
    const prop = v as { type?: string; title?: RichTextItem[] };
    if (prop?.type === "title" && prop.title) {
      return richToText(prop.title);
    }
  }
  return "";
}

function paragraphBlocksFromText(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .map((line) => ({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: line
          ? [{ type: "text", text: { content: line.slice(0, 2000) } }]
          : [],
      },
    }));
}

export const NOTION_PRIMITIVES: IntegrationPrimitive[] = [
  {
    name: "notion_search",
    integration_id: "notion",
    label: "Search Notion",
    description:
      "Search pages and databases in your Notion workspace by free-text query.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        filter: {
          type: "string",
          enum: ["page", "database"],
          description: "Optional: restrict to pages or databases.",
        },
        max_results: { type: "number", default: 10 },
      },
      required: ["query"],
    },
    async handler(input, ctx) {
      const query = String(input["query"]);
      const max = Math.min(Number(input["max_results"] ?? 10), MAX_RESULTS);
      const body: Record<string, unknown> = { query, page_size: max };
      if (input["filter"]) {
        body["filter"] = {
          property: "object",
          value: String(input["filter"]),
        };
      }
      const data = await notionRequest<{
        results?: Array<Record<string, unknown>>;
      }>(`/v1/search`, { method: "POST", body: JSON.stringify(body) });
      const results = (data.results ?? []).slice(0, max).map((r) => {
        const obj = String(r["object"] ?? "");
        const id = String(r["id"] ?? "");
        const url = String(r["url"] ?? "");
        let title = "";
        if (obj === "database") {
          const t = (r["title"] as RichTextItem[] | undefined) ?? [];
          title = richToText(t);
        } else {
          title = pageTitle(r);
        }
        return {
          id,
          object: obj,
          title: wrapExternalContent("notion item title", title),
          url,
        };
      });
      ctx.log(`Searched your workspace — ${results.length} matched.`);
      return {
        summary: `Found ${results.length} items matching "${query}".`,
        data: results,
      };
    },
  },
  {
    name: "notion_read_page",
    integration_id: "notion",
    label: "Read a page",
    description:
      "Read a Notion page's title and plain-text body. Returns up to ~8000 characters of content.",
    input_schema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
      },
      required: ["page_id"],
    },
    async handler(input, ctx) {
      const id = String(input["page_id"]);
      const page = await notionRequest<Record<string, unknown>>(
        `/v1/pages/${encodeURIComponent(id)}`,
      );
      const title = pageTitle(page);
      const blocks = await notionRequest<{ results?: NotionBlock[] }>(
        `/v1/blocks/${encodeURIComponent(id)}/children?page_size=100`,
      );
      const lines = (blocks.results ?? []).map(blockToText).filter(Boolean);
      const fullText = lines.join("\n");
      const text = fullText.slice(0, MAX_BLOCK_CHARS);
      ctx.log(`Read Notion page "${title}".`);
      return {
        summary: `Read page "${title}" (${text.length} chars).`,
        data: {
          page_id: id,
          title: wrapExternalContent("notion page title", title),
          content: wrapExternalContent("notion page body", text),
          truncated: fullText.length > text.length,
        },
      };
    },
  },
  {
    name: "notion_create_page",
    integration_id: "notion",
    label: "Create a page",
    description:
      "Create a Notion page. Provide either parent_page_id (creates a child page) or parent_database_id (creates a database row). 'title' is required. Optional 'body' adds paragraph blocks.",
    input_schema: {
      type: "object",
      properties: {
        parent_page_id: { type: "string" },
        parent_database_id: { type: "string" },
        title: { type: "string" },
        body: { type: "string" },
      },
      required: ["title"],
    },
    async handler(input, ctx) {
      const title = String(input["title"]);
      const body = input["body"] ? String(input["body"]) : "";
      const parentPage = input["parent_page_id"]
        ? String(input["parent_page_id"])
        : undefined;
      const parentDb = input["parent_database_id"]
        ? String(input["parent_database_id"])
        : undefined;
      if (!parentPage && !parentDb) {
        throw new Error("parent_page_id or parent_database_id required");
      }
      const titleProp = [
        { type: "text", text: { content: title.slice(0, 2000) } },
      ];
      let titleKey = "title";
      if (parentDb) {
        // Notion databases are free to rename their title column. Look
        // up the database's schema and use whatever key holds the
        // `title` property type instead of assuming "Name".
        try {
          const db = await notionRequest<{
            properties?: Record<string, { type?: string }>;
          }>(`/v1/databases/${encodeURIComponent(parentDb)}`);
          const found = Object.entries(db.properties ?? {}).find(
            ([, v]) => v?.type === "title",
          );
          titleKey = found?.[0] ?? "Name";
        } catch {
          titleKey = "Name";
        }
      }
      const payload: Record<string, unknown> = {
        properties: parentDb
          ? { [titleKey]: { title: titleProp } }
          : { title: titleProp },
        parent: parentDb
          ? { database_id: parentDb }
          : { page_id: parentPage },
      };
      if (body) {
        payload["children"] = paragraphBlocksFromText(body);
      }
      const result = await notionRequest<{ id: string; url?: string }>(
        `/v1/pages`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      ctx.log(`Created Notion page "${title}".`);
      return {
        summary: `Created page "${title}".`,
        data: { page_id: result.id, url: result.url },
      };
    },
  },
  {
    name: "notion_query_database",
    integration_id: "notion",
    label: "Query a database",
    description:
      "Query a Notion database. Optional 'filter_property' + 'equals' value applies a simple equality filter.",
    input_schema: {
      type: "object",
      properties: {
        database_id: { type: "string" },
        filter_property: { type: "string" },
        equals: { type: "string" },
        max_results: { type: "number", default: 10 },
      },
      required: ["database_id"],
    },
    async handler(input, ctx) {
      const id = String(input["database_id"]);
      const max = Math.min(Number(input["max_results"] ?? 10), MAX_RESULTS);
      const body: Record<string, unknown> = { page_size: max };
      if (input["filter_property"] && input["equals"] !== undefined) {
        body["filter"] = {
          property: String(input["filter_property"]),
          rich_text: { equals: String(input["equals"]) },
        };
      }
      const data = await notionRequest<{
        results?: Array<Record<string, unknown>>;
      }>(`/v1/databases/${encodeURIComponent(id)}/query`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const rows = (data.results ?? []).slice(0, max).map((r) => ({
        id: String(r["id"] ?? ""),
        url: String(r["url"] ?? ""),
        title: wrapExternalContent("notion row title", pageTitle(r)),
      }));
      ctx.log(`Queried your database — ${rows.length} rows.`);
      return {
        summary: `Got ${rows.length} rows from the database.`,
        data: rows,
      };
    },
  },
  {
    name: "notion_append_blocks",
    integration_id: "notion",
    label: "Append text to a page",
    description:
      "Append plain text to a Notion page as paragraph blocks. Each line becomes its own paragraph.",
    input_schema: {
      type: "object",
      properties: {
        page_id: { type: "string" },
        text: { type: "string" },
      },
      required: ["page_id", "text"],
    },
    async handler(input, ctx) {
      const id = String(input["page_id"]);
      const text = String(input["text"]);
      const children = paragraphBlocksFromText(text).slice(0, 100);
      await notionRequest(
        `/v1/blocks/${encodeURIComponent(id)}/children`,
        {
          method: "PATCH",
          body: JSON.stringify({ children }),
        },
      );
      ctx.log(`Appended ${children.length} block(s) to Notion page ${id}.`);
      return {
        summary: `Appended ${children.length} paragraph(s) to the page.`,
        data: { page_id: id, appended_blocks: children.length },
      };
    },
  },
];
