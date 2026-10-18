import { integer, text } from "drizzle-orm/sqlite-core";

import { newId } from "@/lib/ids";

/**
 * Shared column builders for schema v1 (spec §5 conventions):
 * - all IDs are ULIDs (text)
 * - timestamps are UTC integer epoch milliseconds
 * - money is integer minor units (e.g. centavos)
 * - quantities are integer base units (e.g. tablets)
 */

/** ULID text primary key. */
export function primaryId() {
  return text("id")
    .primaryKey()
    .$defaultFn(() => newId());
}

export function createdAt() {
  return integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());
}

export function updatedAt() {
  return integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date());
}

/** UTC instant (epoch ms) column. */
export function instant(name: string) {
  return integer(name, { mode: "timestamp_ms" });
}

/** Calendar date stored as ISO text `YYYY-MM-DD` (timezone-independent by nature). */
export function calendarDate(name: string) {
  return text(name);
}

/** Boolean flag stored as integer 0/1, matching SQLite conventions. */
export function booleanFlag(name: string, defaultValue: boolean) {
  return integer(name, { mode: "boolean" }).notNull().default(defaultValue);
}

/** Integer minor-unit money column (never floats). */
export function money(name: string) {
  return integer(name);
}

/** Integer base-unit quantity column (the smallest sellable/dispensable unit). */
export function qty(name: string) {
  return integer(name);
}
