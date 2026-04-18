import { randomBytes } from "node:crypto";
import { connectorFetch } from "../connectors";
import { wrapExternalContent } from "./external";
import type { IntegrationDefinition, IntegrationPrimitive } from "./types";

const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DEFAULT_TEXT_PREVIEW_CHARS = 20_000;
const MAX_TEXT_PREVIEW_CHARS = 200_000;

function isLikelyBase64(s: string): boolean {
  if (s.length === 0) return true;
  const stripped = s.replace(/\s+/g, "");
  if (stripped.length === 0) return true;
  if (stripped.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(stripped);
}

const NATIVE_EXPORT_MAP: Record<string, { mime: string; kind: "text" }> = {
  "application/vnd.google-apps.document": { mime: "text/plain", kind: "text" },
  "application/vnd.google-apps.spreadsheet": { mime: "text/csv", kind: "text" },
  "application/vnd.google-apps.presentation": { mime: "text/plain", kind: "text" },
};

function isTextMime(mime: string): boolean {
  if (!mime) return false;
  if (mime.startsWith("text/")) return true;
  return (
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/csv" ||
    mime === "application/javascript"
  );
}

export const DRIVE_INTEGRATION: IntegrationDefinition = {
  id: "drive",
  connector_name: "google-drive",
  name: "Google Drive",
  label: "your files",
  description:
    "Search, inspect, share, upload, and download files in your Drive.",
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
  {
    name: "drive_download_file",
    integration_id: "drive",
    label: "Download a file",
    description:
      "Download the contents of a Drive file by id. Native Google Docs/Sheets/Slides are exported as text/CSV; other files are returned as their raw bytes (text inline, binary base64-encoded). Text content is truncated to max_chars (default 20000, max 200000). Files larger than 5 MB are rejected.",
    input_schema: {
      type: "object",
      properties: {
        file_id: { type: "string" },
        max_chars: {
          type: "number",
          description:
            "How many characters of text content to return. Default 20000; capped at 200000. Ignored for binary files.",
          default: DEFAULT_TEXT_PREVIEW_CHARS,
        },
      },
      required: ["file_id"],
    },
    async handler(input, ctx) {
      const id = String(input["file_id"]);
      const requestedChars = Number(
        input["max_chars"] ?? DEFAULT_TEXT_PREVIEW_CHARS,
      );
      const maxChars = Math.min(
        Math.max(
          Number.isFinite(requestedChars) ? requestedChars : DEFAULT_TEXT_PREVIEW_CHARS,
          1,
        ),
        MAX_TEXT_PREVIEW_CHARS,
      );
      const metaFields = encodeURIComponent("id,name,mimeType,size,webViewLink");
      const meta = await driveRequest<{
        id: string;
        name: string;
        mimeType: string;
        size?: string;
        webViewLink?: string;
      }>(`/drive/v3/files/${encodeURIComponent(id)}?fields=${metaFields}`);

      const native = NATIVE_EXPORT_MAP[meta.mimeType];
      const url = native
        ? `/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(native.mime)}`
        : `/drive/v3/files/${encodeURIComponent(id)}?alt=media`;

      if (!native && meta.size) {
        const sizeNum = Number(meta.size);
        if (Number.isFinite(sizeNum) && sizeNum > MAX_DOWNLOAD_BYTES) {
          throw new Error(
            `File "${meta.name}" is ${sizeNum} bytes; the 5 MB download cap was exceeded.`,
          );
        }
      }
      if (meta.mimeType.startsWith("application/vnd.google-apps.") && !native) {
        throw new Error(
          `Drive file "${meta.name}" is a Google ${meta.mimeType.split(".").pop()} which can't be exported as text. Try sharing it instead.`,
        );
      }

      const res = await connectorFetch("google-drive", url, { method: "GET" });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Drive ${res.status}: ${body.slice(0, 300)}`);
      }
      const ab = await res.arrayBuffer();
      if (ab.byteLength > MAX_DOWNLOAD_BYTES) {
        throw new Error(
          `File "${meta.name}" content is ${ab.byteLength} bytes; the 5 MB download cap was exceeded.`,
        );
      }
      const buf = Buffer.from(ab);
      const effectiveMime = native
        ? native.mime
        : (res.headers.get("content-type")?.split(";")[0]?.trim() ||
            meta.mimeType ||
            "application/octet-stream");

      const treatAsText = native?.kind === "text" || isTextMime(effectiveMime);
      ctx.log(
        `Downloaded "${meta.name}" (${buf.length} bytes, ${effectiveMime}).`,
      );

      if (treatAsText) {
        const fullText = buf.toString("utf8");
        const text = fullText.slice(0, maxChars);
        return {
          summary: `Downloaded "${meta.name}" as text (${text.length} chars).`,
          data: {
            file_id: meta.id,
            name: wrapExternalContent("drive file name", meta.name),
            mime_type: effectiveMime,
            web_link: meta.webViewLink,
            encoding: "text",
            content: wrapExternalContent("drive file body", text),
            byte_size: buf.length,
            truncated: fullText.length > text.length,
          },
        };
      }

      return {
        summary: `Downloaded "${meta.name}" as binary (${buf.length} bytes).`,
        data: {
          file_id: meta.id,
          name: wrapExternalContent("drive file name", meta.name),
          mime_type: effectiveMime,
          web_link: meta.webViewLink,
          encoding: "base64",
          content_base64: buf.toString("base64"),
          byte_size: buf.length,
          truncated: false,
        },
      };
    },
  },
  {
    name: "drive_upload_file",
    integration_id: "drive",
    label: "Upload a file",
    description:
      "Upload a new file to Drive. Provide either text content (encoding='text') or base64-encoded bytes (encoding='base64'). Optionally drop it into a folder by id. Returns the new file id and web link. Max 5 MB.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Filename to create in Drive, e.g. 'report.pdf'.",
        },
        mime_type: {
          type: "string",
          description:
            "MIME type of the uploaded bytes, e.g. 'text/plain', 'application/pdf'. Defaults to 'text/plain' for text content.",
        },
        content: {
          type: "string",
          description:
            "File contents. UTF-8 text when encoding='text', base64-encoded bytes when encoding='base64'.",
        },
        encoding: {
          type: "string",
          enum: ["text", "base64"],
          default: "text",
        },
        folder_id: {
          type: "string",
          description: "Optional Drive folder id to upload into.",
        },
      },
      required: ["name", "content"],
    },
    async handler(input, ctx) {
      const name = String(input["name"]);
      const encoding = String(input["encoding"] ?? "text");
      const rawContent = String(input["content"] ?? "");
      const mimeType =
        String(input["mime_type"] ?? "") ||
        (encoding === "base64" ? "application/octet-stream" : "text/plain");
      const folderId = input["folder_id"]
        ? String(input["folder_id"])
        : undefined;

      let bytes: Buffer;
      if (encoding === "base64") {
        if (!isLikelyBase64(rawContent)) {
          throw new Error(
            "content was not valid base64 (expected only A-Z, a-z, 0-9, +, /, optional = padding, length divisible by 4).",
          );
        }
        bytes = Buffer.from(rawContent, "base64");
        // Round-trip check: Node silently drops malformed input rather
        // than throwing, so we re-encode and compare (modulo whitespace
        // and trailing padding) to catch anything the regex missed.
        const normalized = rawContent.replace(/\s+/g, "").replace(/=+$/, "");
        const reEncoded = bytes
          .toString("base64")
          .replace(/=+$/, "");
        if (normalized !== reEncoded) {
          throw new Error("content was not valid base64 (decode round-trip failed).");
        }
      } else {
        bytes = Buffer.from(rawContent, "utf8");
      }
      if (bytes.length > MAX_UPLOAD_BYTES) {
        throw new Error(
          `Upload is ${bytes.length} bytes; the 5 MB upload cap was exceeded.`,
        );
      }

      const metadata: Record<string, unknown> = { name, mimeType };
      if (folderId) metadata["parents"] = [folderId];

      const boundary = `drive_boundary_${randomBytes(8).toString("hex")}`;
      const head = Buffer.from(
        `--${boundary}\r\n` +
          `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
          `${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\n` +
          `Content-Type: ${mimeType}\r\n\r\n`,
        "utf8",
      );
      const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
      const body = Buffer.concat([head, bytes, tail]);

      const res = await connectorFetch(
        "google-drive",
        `/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink`,
        {
          method: "POST",
          body,
          headers: {
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
        },
      );
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Drive ${res.status}: ${text.slice(0, 300)}`);
      }
      const created = JSON.parse(text) as {
        id: string;
        name: string;
        mimeType: string;
        webViewLink?: string;
      };
      ctx.log(
        `Uploaded "${created.name}" to Drive (${bytes.length} bytes, ${mimeType}).`,
      );
      return {
        summary: `Uploaded "${created.name}" (${bytes.length} bytes) to Drive.`,
        data: {
          file_id: created.id,
          name: created.name,
          mime_type: created.mimeType,
          web_link: created.webViewLink,
          byte_size: bytes.length,
          folder_id: folderId,
        },
      };
    },
  },
];
