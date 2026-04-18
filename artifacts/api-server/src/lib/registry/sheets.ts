import { connectorFetch } from "../connectors";
import { wrapExternalContent } from "./external";
import type { IntegrationDefinition, IntegrationPrimitive } from "./types";

export const SHEETS_INTEGRATION: IntegrationDefinition = {
  id: "sheets",
  connector_name: "google-sheet",
  name: "Google Sheets",
  label: "your spreadsheets",
  description: "Read and write rows in your Google Sheets.",
  brand_color: "#0f9d58",
  // Sheets primitives include writes (append/update/create), so the
  // read-only `spreadsheets.readonly` scope is intentionally NOT in
  // the equivalents. The probe hits the spreadsheets API with a
  // sentinel id: a connection with the right scope returns 404
  // (treated as ok), one without returns 403 with the standard
  // ACCESS_TOKEN_SCOPE_INSUFFICIENT marker that runScopeProbe picks up.
  required_scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  scope_equivalents: {
    "https://www.googleapis.com/auth/spreadsheets": [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/drive.file",
    ],
  },
  scope_probe: {
    path: "/v4/spreadsheets/0:batchUpdate",
    method: "POST",
    body: { requests: [] },
    treat_404_as_ok: true,
  },
};

const MAX_ROWS = 200;
const MAX_CELL_CHARS = 500;

async function sheetsRequest<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await connectorFetch("google-sheet", path, {
    method: init.method,
    body: init.body,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Sheets ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function clampCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return s.length > MAX_CELL_CHARS ? s.slice(0, MAX_CELL_CHARS) + "…" : s;
}

function toRows(input: unknown): unknown[][] {
  if (!Array.isArray(input)) return [];
  return input.map((row) =>
    Array.isArray(row) ? row.map((c) => (c == null ? "" : String(c))) : [String(row)],
  );
}

export const SHEETS_PRIMITIVES: IntegrationPrimitive[] = [
  {
    name: "sheets_read_range",
    integration_id: "sheets",
    label: "Read a sheet range",
    description:
      "Read a range from a spreadsheet. Provide spreadsheet_id and an A1-notation range like 'Sheet1!A1:D50'.",
    input_schema: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        range: { type: "string" },
      },
      required: ["spreadsheet_id", "range"],
    },
    async handler(input, ctx) {
      const id = String(input["spreadsheet_id"]);
      const range = String(input["range"]);
      const data = await sheetsRequest<{ values?: unknown[][]; range?: string }>(
        `/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`,
      );
      const values = (data.values ?? []).slice(0, MAX_ROWS).map((row) =>
        row.map(clampCell),
      );
      const wrapped = wrapExternalContent(
        "google sheet cells",
        values.map((r) => r.join("\t")).join("\n"),
      );
      ctx.log(`Read ${values.length} rows from your spreadsheet.`);
      return {
        summary: `Read ${values.length} rows from ${data.range ?? range}.`,
        data: { range: data.range ?? range, rows: values, content: wrapped },
      };
    },
  },
  {
    name: "sheets_append_rows",
    integration_id: "sheets",
    label: "Append rows to a sheet",
    description:
      "Append rows to the end of a sheet. 'rows' is an array of arrays of cell values (strings or numbers).",
    input_schema: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        range: {
          type: "string",
          description: "A1 range identifying the table to append to, e.g. 'Sheet1!A1'.",
        },
        rows: {
          type: "array",
          items: {
            type: "array",
            items: { type: ["string", "number", "boolean"] },
          },
        },
      },
      required: ["spreadsheet_id", "range", "rows"],
    },
    async handler(input, ctx) {
      const id = String(input["spreadsheet_id"]);
      const range = String(input["range"]);
      const rows = toRows(input["rows"]).slice(0, MAX_ROWS);
      const result = await sheetsRequest<{ updates?: { updatedRows?: number } }>(
        `/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: "POST",
          body: JSON.stringify({ values: rows }),
        },
      );
      const n = result.updates?.updatedRows ?? rows.length;
      ctx.log(`Appended ${n} row(s) to your spreadsheet.`);
      return {
        summary: `Appended ${n} row(s) to ${range}.`,
        data: { appended: n },
      };
    },
  },
  {
    name: "sheets_update_range",
    integration_id: "sheets",
    label: "Overwrite a sheet range",
    description:
      "Overwrite a range with new values. 'rows' is an array of arrays.",
    input_schema: {
      type: "object",
      properties: {
        spreadsheet_id: { type: "string" },
        range: { type: "string" },
        rows: {
          type: "array",
          items: {
            type: "array",
            items: { type: ["string", "number", "boolean"] },
          },
        },
      },
      required: ["spreadsheet_id", "range", "rows"],
    },
    async handler(input, ctx) {
      const id = String(input["spreadsheet_id"]);
      const range = String(input["range"]);
      const rows = toRows(input["rows"]).slice(0, MAX_ROWS);
      const result = await sheetsRequest<{ updatedCells?: number }>(
        `/v4/spreadsheets/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          body: JSON.stringify({ values: rows }),
        },
      );
      ctx.log(`Updated ${result.updatedCells ?? 0} cells in your spreadsheet.`);
      return {
        summary: `Updated ${range} (${result.updatedCells ?? 0} cells).`,
        data: { updated_cells: result.updatedCells ?? 0 },
      };
    },
  },
  {
    name: "sheets_create_spreadsheet",
    integration_id: "sheets",
    label: "Create a spreadsheet",
    description: "Create a new Google Spreadsheet with the given title.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
      },
      required: ["title"],
    },
    async handler(input, ctx) {
      const title = String(input["title"]);
      const result = await sheetsRequest<{
        spreadsheetId: string;
        spreadsheetUrl?: string;
      }>(`/v4/spreadsheets`, {
        method: "POST",
        body: JSON.stringify({ properties: { title } }),
      });
      ctx.log(`Created a new spreadsheet "${title}".`);
      return {
        summary: `Created spreadsheet "${title}".`,
        data: {
          spreadsheet_id: result.spreadsheetId,
          url: result.spreadsheetUrl,
        },
      };
    },
  },
];
