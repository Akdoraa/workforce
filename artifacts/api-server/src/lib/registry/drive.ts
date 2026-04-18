import { connectorFetch } from "../connectors";
import { wrapExternalContent } from "./external";
import type { IntegrationDefinition, IntegrationPrimitive } from "./types";

export const DRIVE_INTEGRATION: IntegrationDefinition = {
  id: "drive",
  connector_name: "google-drive",
  name: "Google Drive",
  label: "your files",
  description: "Search, inspect, and share files in your Drive.",
  brand_color: "#1fa463",
  // The Drive integration includes a write primitive (sharing a file),
  // so a read-only scope is NOT sufficient. We accept the broad
  // `drive` scope or the narrower `drive.file` scope (which still
  // allows writing/sharing for app-created files); we deliberately do
  // NOT accept `drive.readonly` here, otherwise a connected account
  // could appear healthy yet 403 the moment the agent tried to share.
  required_scopes: ["https://www.googleapis.com/auth/drive"],
  scope_equivalents: {
    "https://www.googleapis.com/auth/drive": [
      "https://www.googleapis.com/auth/drive.file",
    ],
  },
  // Probe a write endpoint with a sentinel id: with a write-capable
  // scope (`drive` or `drive.file`) Google returns 404 once the scope
  // check passes; without one it returns 403 with
  // ACCESS_TOKEN_SCOPE_INSUFFICIENT, which flips the connection into
  // "needs reauthorization". A read-only `drive.readonly` token also
  // 403s here, so the card surfaces the gap instead of looking healthy
  // until the agent actually tries to share a file.
  scope_probe: {
    path: "/drive/v3/files/0?fields=id",
    method: "PATCH",
    body: {},
    treat_404_as_ok: true,
  },
};

async function driveRequest<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await connectorFetch("google-drive", path, {
    method: init.method,
    body: init.body,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Drive ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  owners?: Array<{ emailAddress?: string; displayName?: string }>;
  modifiedTime?: string;
  parents?: string[];
}

export const DRIVE_PRIMITIVES: IntegrationPrimitive[] = [
  {
    name: "drive_search_files",
    integration_id: "drive",
    label: "Search files",
    description:
      "Search Drive for files by name, mime-type, or folder. Returns file ids and metadata.",
    input_schema: {
      type: "object",
      properties: {
        name_contains: {
          type: "string",
          description: "Substring to match against the file name.",
        },
        mime_type: {
          type: "string",
          description:
            "Optional MIME type filter, e.g. 'application/vnd.google-apps.spreadsheet'.",
        },
        folder_id: {
          type: "string",
          description: "Optional Drive folder id to search within.",
        },
        max_results: { type: "number", default: 20 },
      },
    },
    async handler(input, ctx) {
      const max = Math.min(Number(input["max_results"] ?? 20), 50);
      const clauses: string[] = ["trashed = false"];
      if (input["name_contains"]) {
        const safe = String(input["name_contains"]).replace(/'/g, "\\'");
        clauses.push(`name contains '${safe}'`);
      }
      if (input["mime_type"]) {
        clauses.push(`mimeType = '${String(input["mime_type"])}'`);
      }
      if (input["folder_id"]) {
        clauses.push(`'${String(input["folder_id"])}' in parents`);
      }
      const q = encodeURIComponent(clauses.join(" and "));
      const fields = encodeURIComponent(
        "files(id,name,mimeType,webViewLink,owners(emailAddress,displayName),modifiedTime,parents)",
      );
      const data = await driveRequest<{ files?: DriveFile[] }>(
        `/drive/v3/files?q=${q}&pageSize=${max}&fields=${fields}`,
      );
      const files = (data.files ?? []).map((f) => ({
        id: f.id,
        name: wrapExternalContent("drive file name", f.name ?? ""),
        mime_type: f.mimeType,
        web_link: f.webViewLink,
        owners: (f.owners ?? []).map((o) => o.emailAddress ?? o.displayName ?? ""),
        modified: f.modifiedTime,
      }));
      ctx.log(`Searched your files — ${files.length} matched.`);
      return {
        summary: `Found ${files.length} files in your Drive.`,
        data: files,
      };
    },
  },
  {
    name: "drive_get_file_metadata",
    integration_id: "drive",
    label: "Get file metadata",
    description:
      "Fetch metadata for a single Drive file by id (name, mime-type, owners, web link).",
    input_schema: {
      type: "object",
      properties: {
        file_id: { type: "string" },
      },
      required: ["file_id"],
    },
    async handler(input, ctx) {
      const id = String(input["file_id"] ?? "");
      const fields = encodeURIComponent(
        "id,name,mimeType,webViewLink,owners(emailAddress,displayName),modifiedTime,parents,size",
      );
      const f = await driveRequest<DriveFile & { size?: string }>(
        `/drive/v3/files/${encodeURIComponent(id)}?fields=${fields}`,
      );
      ctx.log(`Read file metadata for "${f.name}".`);
      return {
        summary: `Read metadata for "${f.name}".`,
        data: {
          id: f.id,
          name: wrapExternalContent("drive file name", f.name ?? ""),
          mime_type: f.mimeType,
          web_link: f.webViewLink,
          owners: (f.owners ?? []).map(
            (o) => o.emailAddress ?? o.displayName ?? "",
          ),
          modified: f.modifiedTime,
          size: f.size,
        },
      };
    },
  },
  {
    name: "drive_share_file",
    integration_id: "drive",
    label: "Share a file",
    description:
      "Share a Drive file with an email address. role must be 'reader' or 'writer'.",
    input_schema: {
      type: "object",
      properties: {
        file_id: { type: "string" },
        email: { type: "string" },
        role: { type: "string", enum: ["reader", "writer"], default: "reader" },
        notify: { type: "boolean", default: false },
      },
      required: ["file_id", "email"],
    },
    async handler(input, ctx) {
      const id = String(input["file_id"]);
      const email = String(input["email"]);
      const role = String(input["role"] ?? "reader");
      const notify = Boolean(input["notify"] ?? false);
      const result = await driveRequest<{ id: string }>(
        `/drive/v3/files/${encodeURIComponent(id)}/permissions?sendNotificationEmail=${notify}`,
        {
          method: "POST",
          body: JSON.stringify({
            type: "user",
            role,
            emailAddress: email,
          }),
        },
      );
      ctx.log(`Shared file ${id} with ${email} (${role}).`);
      return {
        summary: `Shared file with ${email} as ${role}.`,
        data: { permission_id: result.id, file_id: id, email, role },
      };
    },
  },
];
