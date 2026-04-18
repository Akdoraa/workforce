import type Anthropic from "@anthropic-ai/sdk";

type Schema = Anthropic.Tool.InputSchema | Record<string, unknown>;

export interface ValidationError {
  path: string;
  message: string;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function checkType(value: unknown, expected: string | string[]): boolean {
  const actual = typeOf(value);
  const types = Array.isArray(expected) ? expected : [expected];
  for (const t of types) {
    if (t === "integer") {
      if (typeof value === "number" && Number.isInteger(value)) return true;
      continue;
    }
    if (t === "number" && actual === "number") return true;
    if (t === actual) return true;
  }
  return false;
}

function validate(
  value: unknown,
  schema: Schema | undefined,
  path: string,
  errors: ValidationError[],
): void {
  if (!schema || typeof schema !== "object") return;
  const s = schema as Record<string, unknown>;

  if (s["type"] !== undefined) {
    const ok = checkType(value, s["type"] as string | string[]);
    if (!ok) {
      errors.push({
        path,
        message: `expected type ${JSON.stringify(s["type"])}, got ${typeOf(value)}`,
      });
      return;
    }
  }

  if (Array.isArray(s["enum"])) {
    if (!s["enum"].some((opt) => opt === value)) {
      errors.push({
        path,
        message: `must be one of ${JSON.stringify(s["enum"])}`,
      });
    }
  }

  const t = typeOf(value);

  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const required = Array.isArray(s["required"])
      ? (s["required"] as string[])
      : [];
    for (const r of required) {
      if (!(r in obj) || obj[r] === undefined || obj[r] === null) {
        errors.push({
          path: path ? `${path}.${r}` : r,
          message: "required property missing",
        });
      }
    }
    const properties = (s["properties"] ?? {}) as Record<string, Schema>;
    for (const [key, sub] of Object.entries(properties)) {
      if (key in obj && obj[key] !== undefined) {
        validate(obj[key], sub, path ? `${path}.${key}` : key, errors);
      }
    }
  } else if (t === "array") {
    const items = s["items"] as Schema | undefined;
    if (items) {
      const arr = value as unknown[];
      arr.forEach((v, i) => validate(v, items, `${path}[${i}]`, errors));
    }
  }
}

export function validateAgainstSchema(
  input: unknown,
  schema: Schema | undefined,
): ValidationError[] {
  const errors: ValidationError[] = [];
  validate(input, schema, "", errors);
  return errors;
}

export function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => (e.path ? `${e.path}: ${e.message}` : e.message))
    .join("; ");
}
