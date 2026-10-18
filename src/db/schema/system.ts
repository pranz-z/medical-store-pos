import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { users } from "./auth";
import { createdAt, instant, primaryId, updatedAt } from "./helpers";

/**
 * System tables: settings, audit log, rate limits (spec §5.1).
 *
 * `audit_log` is append-only: UPDATE/DELETE are blocked by triggers created in
 * the migration. Rows are written through `recordAudit()` (src/lib/audit.ts),
 * which never stores secrets and keeps PII out of logs.
 */

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<JsonValue>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: primaryId(),
    userId: text("user_id").references(() => users.id),
    /** Verb object, e.g. `user.role_changed`. */
    action: text("action").notNull(),
    /** Table/entity name, e.g. `users`. */
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: text("before", { mode: "json" }).$type<JsonValue | null>(),
    after: text("after", { mode: "json" }).$type<JsonValue | null>(),
    ip: text("ip"),
    requestId: text("request_id"),
    /** Event time (UTC epoch ms). */
    at: integer("at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_log_entity_idx").on(table.entity, table.entityId, table.at),
    index("audit_log_user_idx").on(table.userId, table.at),
  ],
);

export const approvalTokens = sqliteTable(
  "approval_tokens",
  {
    id: primaryId(),
    /** Manager/owner who approved (verified by PIN, never the requester). */
    approverId: text("approver_id")
      .notNull()
      .references(() => users.id),
    /** User whose action is being approved. */
    requesterId: text("requester_id")
      .notNull()
      .references(() => users.id),
    /** Action class, e.g. `adjustment.threshold`, `sale.discount_over_limit`. */
    action: text("action").notNull(),
    /** SHA-256 of the canonical request payload — token is bound to it. */
    payloadHash: text("payload_hash").notNull(),
    reason: text("reason"),
    /** UTC epoch ms; tokens are short-lived (~5 min). */
    expiresAt: instant("expires_at").notNull(),
    /** Set on consumption; a conditional UPDATE enforces single use. */
    usedAt: instant("used_at"),
    createdAt: createdAt(),
  },
  (table) => [
    index("approval_tokens_lookup_idx").on(table.action, table.requesterId, table.expiresAt),
    index("approval_tokens_approver_idx").on(table.approverId, table.createdAt),
  ],
);

export const rateLimits = sqliteTable(
  "rate_limits",
  {
    /** Limiter key, e.g. `login:user@example.com` or `pin:<userId>`. */
    key: text("key").primaryKey(),
    /** Attempts counted in the current window. */
    count: integer("count").notNull().default(0),
    /** Window start as raw epoch ms (integer math only; not a Date column by design). */
    windowStartMs: integer("window_start_ms").notNull(),
    /** Set when the limit was exceeded; requests are denied until this instant. */
    blockedUntilMs: integer("blocked_until_ms"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [check("rate_limits_count_check", sql`${table.count} >= 0`)],
);
