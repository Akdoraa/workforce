const MAX_STRING_LEN = 200;
const MAX_DEPTH = 6;
const MAX_KEYS = 50;
const MAX_ARRAY = 20;

const SENSITIVE_KEY_RE =
  /(token|secret|api[_-]?key|access[_-]?key|auth|password|passwd|credential|cookie|session|authorization|bearer|refresh|client[_-]?secret|signature|otp|pin)/i;

const TOKEN_LIKE_RE =
  /^(sk-|pk_|rk_|whsec_|xoxb-|xoxp-|xoxa-|xoxs-|ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16}|ya29\.)/;

function looksLikeOpaqueToken(s: string): boolean {
  if (TOKEN_LIKE_RE.test(s)) return true;
  // High-entropy long opaque string with no whitespace.
  if (s.length >= 32 && /^[A-Za-z0-9_\-+/=.]+$/.test(s) && !/\s/.test(s)) {
    return true;
  }
  return false;
}

function truncateString(s: string): string {
  if (s.length <= MAX_STRING_LEN) return s;
  return `${s.slice(0, MAX_STRING_LEN)}…[+${s.length - MAX_STRING_LEN} chars]`;
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return "[truncated: max depth]";
  if (typeof value === "string") {
    if (looksLikeOpaqueToken(value)) return "[redacted: token]";
    return truncateString(value);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const out = value
      .slice(0, MAX_ARRAY)
      .map((v) => redactValue(v, depth + 1));
    if (value.length > MAX_ARRAY) {
      out.push(`[+${value.length - MAX_ARRAY} more items]`);
    }
    return out;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).slice(0, MAX_KEYS);
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = redactValue(obj[k], depth + 1);
      }
    }
    if (Object.keys(obj).length > MAX_KEYS) {
      out["__truncated__"] = `+${Object.keys(obj).length - MAX_KEYS} more keys`;
    }
    return out;
  }
  return String(value);
}

export function redactArgs(
  args: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  return redactValue(args) as Record<string, unknown>;
}
