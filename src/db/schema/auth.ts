import { sql } from "drizzle-orm";
import { check, index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { branches } from "./core";
import { booleanFlag, createdAt, instant, primaryId, updatedAt } from "./helpers";

/**
 * Auth tables.
 *
 * `users` and `sessions` are as specced in §5.1; `accounts` and `verifications`
 * are required by Better Auth (§5.1 addition approved for M0).
 *
 * Column *property* names below must match Better Auth's field names so the
 * Drizzle adapter can resolve them; the database column names use snake_case.
 *
 * `users.pin_hash` lives here (spec §5.1) but is deliberately NOT declared with
 * Better Auth, so it can never leak through a session response. The login
 * password hash lives in `accounts.password` (Better Auth's credential store);
 * see the M0 summary for the documented deviation from `users.password_hash`.
 */

export const users = sqliteTable(
  "users",
  {
    id: primaryId(),
    name: text("name").notNull(),
    /** Always store lowercase (app code normalizes before writes). */
    email: text("email").notNull(),
    emailVerified: booleanFlag("email_verified", false),
    image: text("image"),
    role: text("role").notNull().default("cashier"),
    branchId: text("branch_id").references(() => branches.id),
    /** Hash of the 4-6 digit step-up PIN (separate from the login password). */
    pinHash: text("pin_hash"),
    active: booleanFlag("active", true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // COLLATE NOCASE so uniqueness holds even if a future write path forgets
    // to lowercase (mixing "A@x.com"/"a@x.com" must fail).
    uniqueIndex("users_email_unique").on(sql`${table.email} collate nocase`),
    index("users_branch_idx").on(table.branchId),
    index("users_role_idx").on(table.role),
    check(
      "users_role_check",
      sql`${table.role} in ('owner', 'manager', 'pharmacist', 'cashier', 'auditor')`,
    ),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: primaryId(),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: instant("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_expires_idx").on(table.expiresAt),
  ],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: primaryId(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: instant("access_token_expires_at"),
    refreshTokenExpiresAt: instant("refresh_token_expires_at"),
    scope: text("scope"),
    /** Password hash for the `credential` provider (never returned by the auth API). */
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("accounts_user_idx").on(table.userId),
    uniqueIndex("accounts_provider_account_uq").on(table.providerId, table.accountId),
  ],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: primaryId(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: instant("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);
