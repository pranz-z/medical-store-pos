import { sqliteTable, text } from "drizzle-orm/sqlite-core";

import { createdAt, primaryId, updatedAt } from "./helpers";

/** Branches (spec §5.1). A single-store install still has exactly one branch row. */
export const branches = sqliteTable("branches", {
  id: primaryId(),
  name: text("name").notNull(),
  address: text("address"),
  taxId: text("tax_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
