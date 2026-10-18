import type { InValue } from "@libsql/client";

import { getDb, type Database } from "@/db/client";
import { auditLog, type JsonValue } from "@/db/schema/system";
import { newId } from "@/lib/ids";
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
 *
 * Two write paths:
 * - `recordAudit(entry)` — standalone insert via Drizzle (optional `db` lets
 *   tests pass their own handle).
 * - `buildAuditStatement(entry)` — returns a bound INSERT statement for use
 *   inside `client.transaction("write")`, so the audit row commits atomically
 *   with the mutation it documents.
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

export async function recordAudit(entry: AuditEntry, db: Database = getDb()): Promise<void> {
  const context = await safeRequestContext();
  const row = buildRow(entry, context);

  await db.insert(auditLog).values({
    id: row.id,
    userId: row.userId,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    before: row.before,
    after: row.after,
    ip: row.ip,
    requestId: row.requestId,
    at: row.at,
  });
}

/**
 * Prepared INSERT for the in-transaction path. Await this BEFORE entering the
 * transaction (it reads request context), then `tx.execute` the result inside.
 */
export async function buildAuditStatement(
  entry: AuditEntry,
): Promise<{ sql: string; args: InValue[] }> {
  const context = await safeRequestContext();
  const row = buildRow(entry, context);
  return {
    sql: `insert into audit_log
          (id, user_id, action, entity, entity_id, before, after, ip, request_id, at, created_at)
          values (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      row.id,
      row.userId,
      row.action,
      row.entity,
      row.entityId,
      row.before === null ? null : JSON.stringify(row.before),
      row.after === null ? null : JSON.stringify(row.after),
      row.ip,
      row.requestId,
      row.at.getTime(),
      row.at.getTime(),
    ],
  };
}

interface AuditRow {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: JsonValue | null;
  after: JsonValue | null;
  ip: string | null;
  requestId: string | null;
  at: Date;
}

function buildRow(
  entry: AuditEntry,
  context: { ip: string | null; requestId: string | null },
): AuditRow {
  return {
    id: newId(),
    userId: entry.userId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: compactJson(entry.before),
    after: compactJson(entry.after),
    ip: context.ip,
    requestId: context.requestId,
    at: new Date(),
  };
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
