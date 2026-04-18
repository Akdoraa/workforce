import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export async function atomicWriteFile(
  filePath: string,
  contents: string | Buffer,
): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${randomUUID().slice(0, 8)}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await fs.open(tmp, "w");
    await handle.writeFile(contents);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(tmp, filePath);
  } catch (err) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // ignore
      }
    }
    try {
      await fs.unlink(tmp);
    } catch {
      // ignore
    }
    throw err;
  }
}

const TAIL_CHUNK = 64 * 1024;

/**
 * Read the trailing portion of a file as utf-8. Bounded by `maxBytes`.
 * Skips a leading partial line so callers can JSON-parse line-by-line.
 */
export async function readFileTail(
  filePath: string,
  maxBytes: number,
): Promise<string> {
  let fh: fs.FileHandle | undefined;
  try {
    fh = await fs.open(filePath, "r");
    const stat = await fh.stat();
    const size = stat.size;
    if (size === 0) return "";
    const readLen = Math.min(size, maxBytes);
    const start = size - readLen;
    const buf = Buffer.alloc(readLen);
    await fh.read(buf, 0, readLen, start);
    let text = buf.toString("utf-8");
    if (start > 0) {
      // Drop first (likely partial) line.
      const nl = text.indexOf("\n");
      if (nl >= 0) text = text.slice(nl + 1);
    }
    return text;
  } finally {
    if (fh) {
      try {
        await fh.close();
      } catch {
        // ignore
      }
    }
  }
}

export async function fileSize(filePath: string): Promise<number> {
  try {
    const s = await fs.stat(filePath);
    return s.size;
  } catch {
    return 0;
  }
}

/**
 * Rotate a file when it exceeds `maxBytes`. The current contents are moved
 * to `<file>.1` (overwriting any existing rotation). Single-segment retention
 * keeps the helper trivial — we only need to bound disk usage, not maintain
 * deep history. Returns true if a rotation happened.
 */
export async function rotateIfNeeded(
  filePath: string,
  maxBytes: number,
): Promise<boolean> {
  const size = await fileSize(filePath);
  if (size < maxBytes) return false;
  try {
    await fs.rename(filePath, `${filePath}.1`);
    return true;
  } catch {
    return false;
  }
}
