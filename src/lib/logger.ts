/**
 * Minimal structured JSON logger.
 *
 * Privacy rule (spec §9): no PII in logs. This logger redacts values whose
 * keys look sensitive (passwords, PINs, tokens, patient/customer identifiers).
 * Call sites must still avoid passing PII in free-text messages.
 */

const REDACTED = "[redacted]";

const SENSITIVE_KEY =
  /(pass(word|wd)?|pin|secret|token|authorization|cookie|email|phone|patient|allerg|dob|licen[cs]e)/i;

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

function redactValue(value: unknown, depth: number): JsonValue {
  if (depth > 6) return "[truncated]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1));
  if (typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactValue(item, depth + 1);
    }
    return out;
  }
  return String(value);
}

function redact(fields: Record<string, unknown>): JsonValue {
  return redactValue(fields, 0);
}

type LogLevel = "debug" | "info" | "warn" | "error";

export function log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level,
    msg: message,
    time: new Date().toISOString(),
    ...(redact(fields) as Record<string, JsonValue>),
  });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => log("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => log("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => log("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => log("error", message, fields),
};
