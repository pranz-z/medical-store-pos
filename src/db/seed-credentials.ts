/**
 * ============================================================================
 * DEV-ONLY SEED CREDENTIALS — THE SINGLE PLACE DEMO LOGINS LIVE
 * ============================================================================
 *
 * These accounts exist only for local development and demo databases. The seed
 * script refuses to write to a non-local database unless `--force` is passed
 * (see `scripts/seed.ts`), and this file must never be used for real users.
 *
 * Seeded logins (password / step-up PIN):
 *   owner@store.test       dev.Owner#2026      PIN 135790
 *   manager@store.test     dev.Manager#2026    PIN 135790
 *   pharmacist@store.test  dev.Pharmacist#2026 PIN 135790
 *   cashier@store.test     dev.Cashier#2026    PIN 135790
 *   auditor@store.test     dev.Auditor#2026    PIN 135790
 *
 * Change this file (and re-run `npm run db:reset`) if you want different local
 * credentials. Passwords need >= 8 characters (Better Auth minimum).
 */

export const DEV_SEED_PIN = "135790";

export interface DevSeedUser {
  /** Deterministic id so dev rows are easy to reference. */
  id: string;
  name: string;
  email: string;
  role: "owner" | "manager" | "pharmacist" | "cashier" | "auditor";
  password: string;
  pin: string;
}

export const DEV_SEED_USERS: DevSeedUser[] = [
  {
    id: "seed_user_owner",
    name: "Olivia Reyes (Owner)",
    email: "owner@store.test",
    role: "owner",
    password: "dev.Owner#2026",
    pin: DEV_SEED_PIN,
  },
  {
    id: "seed_user_manager",
    name: "Miguel Santos (Manager)",
    email: "manager@store.test",
    role: "manager",
    password: "dev.Manager#2026",
    pin: DEV_SEED_PIN,
  },
  {
    id: "seed_user_pharmacist",
    name: "Patricia Cruz, RPh",
    email: "pharmacist@store.test",
    role: "pharmacist",
    password: "dev.Pharmacist#2026",
    pin: DEV_SEED_PIN,
  },
  {
    id: "seed_user_cashier",
    name: "Carlo Diaz",
    email: "cashier@store.test",
    role: "cashier",
    password: "dev.Cashier#2026",
    pin: DEV_SEED_PIN,
  },
  {
    id: "seed_user_auditor",
    name: "Alma Navarro",
    email: "auditor@store.test",
    role: "auditor",
    password: "dev.Auditor#2026",
    pin: DEV_SEED_PIN,
  },
];
