import { getDb } from "@/db/client";
import { auditLog, type JsonValue } from "@/db/schema/system";
import { requestContext } from "@/lib/request-context";

/**
 * Audit trail writer (spec §5.1 `audit_log`, §9).
 *
 * Rules:
 * - Call this for every privileged mutation (role changes, voids, price edits,
 *   Rx overrides, …). The `action` string is a verb object like
 *   `user.role_changed`.
 * - Never pass secrets or PII: `before`/`after` snapshots must contain only the
 *   business fields that changed. Values are capped at 4 KB each.
 * - The table is append-only (UPDATE/DELETE blocked by triggers).
 */

export interface AuditEntry {
  /** Verb object, e.g. `user.role_changed`. */
  action: string;
  /** Table/entity name, e.g. `users`. */
  entity: string;
  entityId?: string | null;
  /** Business snapshot before the change (no PII, no secrets). */
  before?: JsonValue | null;
  /** Business snapshot after the change. */
  after?: JsonValue | null;
  /** Acting user; explicit so scripts can audit with a null actor. */
  userId?: string | null;
}

const MAX_JSON_LENGTH = 4000;

export async function recordAudit(entry: AuditEntry): Promise<void> {
  const context = await safeRequestContext();

  await getDb()
    .insert(auditLog)
    .values({
      userId: entry.userId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      before: compactJson(entry.before),
      after: compactJson(entry.after),
      ip: context.ip,
      requestId: context.requestId,
    });
}

/** `requestContext()` needs a request scope; scripts/tests still get an audit row. */
async function safeRequestContext(): Promise<{ ip: string | null; requestId: string | null }> {
  try {
    const context = await requestContext();
    return { ip: context.ip, requestId: context.requestId };
  } catch {
    return { ip: null, requestId: null };
  }
}

function compactJson(value: JsonValue | null | undefined): JsonValue | null {
  if (value === undefined || value === null) return null;
  const json = JSON.stringify(value);
  if (json.length <= MAX_JSON_LENGTH) return value;
  return { truncated: true, preview: json.slice(0, MAX_JSON_LENGTH) };
}
