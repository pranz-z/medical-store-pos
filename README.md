# Medical Store POS

Point-of-sale and inventory system for a pharmacy / medical store. Next.js
(App Router, TypeScript strict) on Vercel, Turso (libSQL) via `@libsql/client`,
Drizzle ORM, Better Auth, Tailwind 4 + shadcn/ui.

The product and technical spec lives in
[`Medical Store POS Product & Technical Spec.md`](./Medical%20Store%20POS%20Product%20%26%20Technical%20Spec.md)
— it is the source of truth for scope and conventions.

## Conventions

- IDs are ULIDs (text). Timestamps are integer epoch ms (UTC); calendar dates
  are `YYYY-MM-DD` text.
- Money is integer minor units (centavos); quantities are integers in the
  product's base unit. **Never use floats for money or quantities**, and never
  trust client-supplied prices — the server re-prices.
- `stock_movements`, `controlled_register` and `audit_log` are append-only
  (enforced by triggers, not just by convention).
- Authorization is enforced server-side on every mutation (`requireRole`);
  hiding UI controls is only a convenience.

## Local setup

Requires Node.js ≥ 20.9 and npm.

```bash
npm ci
cp .env.example .env.local
```

Fill in `AUTH_SECRET` in `.env.local` (the only variable local dev strictly
needs):

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Create, migrate and seed the local libSQL database (`file:local.db`):

```bash
npm run db:setup     # = db:migrate + db:seed
npm run dev
```

The app runs at http://localhost:3000. Sign in with a seeded dev account —
the credentials live in one documented place,
[`src/db/seed-credentials.ts`](./src/db/seed-credentials.ts) (one user per
role: owner, manager, pharmacist, cashier, auditor). These are dev-only;
the seed refuses to run against a non-local `TURSO_DATABASE_URL` unless
`--force` is passed.

Useful extras:

- `GET /api/health` — public liveness probe, returns only `{ status, db }`.
- `npm run db:reset` — drop everything, re-migrate, re-seed (the only way to
  "clean" a DB with append-only tables).

## npm scripts

| Script | Purpose |
| --- | --- |
| `dev` / `build` / `start` | Next.js dev server / production build / serve |
| `lint` / `format` / `format:check` | ESLint / Prettier write / Prettier check |
| `typecheck` | `next typegen` + `tsc --noEmit` |
| `test` / `test:watch` | Vitest unit + integration tests (local libSQL) |
| `db:generate` | Regenerate Drizzle migrations from `src/db/schema` |
| `db:check` | `drizzle-kit check` — sanity-checks generated SQL |
| `db:migrate` | Apply `drizzle/` migrations to `TURSO_DATABASE_URL` |
| `db:seed` | Seed demo data (refuses non-local DBs without `--force`) |
| `db:reset` | Drop all objects, re-migrate, re-seed (same `--force` guard) |
| `db:setup` | `db:migrate` + `db:seed` |
| `db:fts:rebuild` | Rebuild the `products_fts` index from `products` |
| `db:smoke` | Migrate + run the schema probe against a throwaway **remote** Turso DB |

## Turso setup

1. Install the CLI and create the database **in `aws-ap-northeast-1`**
   (Tokyo — see "Region coupling" below):

   ```bash
   turso db create medical-store --location aws-ap-northeast-1
   turso db show medical-store --url     # -> TURSO_DATABASE_URL
   turso db tokens create medical-store  # -> TURSO_AUTH_TOKEN
   ```

2. Put both values in `.env.local` (or Vercel env vars), then:

   ```bash
   npm run db:migrate
   npm run db:seed -- --force   # only on a disposable DB — writes demo logins
   ```

3. Enable point-in-time recovery on the production database
   (`turso db ...`), per spec §4.3.7.

### `db:smoke` — remote schema probe

`npm run db:smoke` applies the migrations and re-runs the full FK / trigger /
CHECK / FTS5 probe (`src/db/verify.ts`) over a remote connection. It requires
a **throwaway** database — the probe leaves `chk_*` fixture rows behind
(append-only tables cannot be cleaned):

```bash
turso db create mstore-smoke --location aws-ap-northeast-1
TURSO_DATABASE_URL=libsql://mstore-smoke-....turso.io \
TURSO_AUTH_TOKEN=... \
npm run db:smoke -- --yes
turso db destroy mstore-smoke
```

### Rebuilding the FTS index

`products_fts` is a standalone FTS5 table kept in sync by triggers. If it ever
drifts (e.g. a bulk import that bypassed the triggers), rebuild it:

```bash
npm run db:fts:rebuild
```

The rebuild wipes and re-selects the index in one write transaction; products
are untouched.

## Migrations

- Generated with `npm run db:generate` (Drizzle Kit) from `src/db/schema/`,
  then reviewed and committed. Hand-written SQL that the DSL can't express
  (the FTS5 virtual table and the append-only triggers) lives in a commented
  block at the bottom of the generated file — keep it when regenerating.
- **Never edit an applied migration** — add a new one. Migrations follow
  expand/contract so the previous deployment keeps working during rollout.
- Applied by `npm run db:migrate` in CI/deploy **before** traffic shifts —
  never inside a serverless function.
- **Append-only warning:** `stock_movements`, `controlled_register` and
  `audit_log` have `BEFORE UPDATE/DELETE ... RAISE(ABORT)` triggers. Any
  migration that rebuilds one of these tables (SQLite table rebuilds go
  through drop + recreate + copy) must **drop and recreate those triggers in
  the same migration**, and must also recreate them before writing any rows —
  otherwise the copy step aborts or the table silently loses its protection.
- CI verifies there is no schema drift: it re-runs `db:generate` and fails if
  `drizzle/` changes.

## Deployment

- **Vercel:** import the repo, framework preset Next.js. `vercel.json` pins
  `regions: ["hnd1"]`. Set the env vars per environment
  (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `AUTH_SECRET`, `APP_TIMEZONE`,
  `APP_CURRENCY`, `BETTER_AUTH_URL` in production; `BLOB_READ_WRITE_TOKEN`,
  `SENTRY_DSN`, `CRON_SECRET` are reserved for later milestones).
- **Region coupling:** the Vercel function region (`hnd1`, Tokyo) and the
  Turso primary region (`aws-ap-northeast-1`, Tokyo) must stay in the same
  metro — cross-region round trips dominate POS latency (spec §4.2). If you
  ever move one, move the other in the same change.
- **Preview per PR:** each PR gets a Vercel preview deployment backed by a
  **Turso database branch** (`turso db create --from-db medical-store`),
  seeded with the demo fixtures. Point the preview's env vars at the branch;
  destroy the branch when the PR closes.
- **Pipeline** (`.github/workflows/ci.yml`): Prettier, ESLint, `tsc --noEmit`,
  Vitest (unit + integration on a local libSQL file), migration apply to a
  fresh DB, migration drift check, production build, `npm audit`. On merge to
  `main`: apply migrations to production, then promote the deployment.

## Auth and safety

- Better Auth, credentials only — no public sign-up; accounts are provisioned
  by an owner or the seed. Sessions are DB-backed (`sessions` table), 12 h
  expiry; cookies are HttpOnly, Secure in production, SameSite=Lax.
- Passwords and PINs are scrypt-hashed (`accounts.password`,
  `users.pin_hash`); the PIN is a 4–6 digit step-up for privileged actions.
- Rate limiting lives in the `rate_limits` table behind a swappable interface
  (`src/lib/rate-limit.ts`): 10 failed logins per email+IP per 15 min;
  5 failed PIN attempts per user per 15 min. Swap for Upstash later without
  touching call sites.
- Privileged mutations go through server actions: `requireRole` →
  optional PIN step-up → mutate → `recordAudit` (user, action, entity,
  before/after JSON, IP, `x-request-id` from `src/proxy.ts`).
- No PII in logs. Never commit secrets — `.env*` is gitignored, `.env.example`
  is the template.

## Catalog & inventory (M1)

- **Capabilities** live in `src/lib/permissions.ts` (`can`/`requireCapability`);
  every server mutation enforces them — nav/UI hiding is convenience only.
  Owner+manager get everything; pharmacist gets catalog/inventory view plus
  receiving and adjustments (no prices, no import); cashier is read-only
  catalog search; auditor is read-only including the ledger and audit log.
- **Products** (`/products`): FTS search + browse, create/edit/deactivate,
  units (base + conversion factors, one default sale unit), barcodes (globally
  unique), categories, tax class, flags. Prices live in `product_prices` — a
  change closes the current row (`effective_to`) and opens a new one; history
  is viewable per product. `GET /api/products/search` backs the combobox
  (barcode-exact wins, then FTS5 prefix match).
- **Inventory** (`/inventory`): batch list with alert filters — low stock vs
  `reorder_level`, expiring ≤30/60/90 days, expired on shelf — plus the
  append-only movement ledger (`/inventory/movements`).
- **Receiving** (`/receiving`): ad-hoc lines (product, unit, batch no, expiry,
  qty, cost per unit). Quantities convert to integer base units; cost converts
  to cost per base unit. Expiry in the past or inside
  `inventory.min_shelf_life_days` (default 90) is rejected. An existing
  `(branch, product, batch_no, expiry)` row is topped up; everything — batch,
  movement, `controlled_register` row, audit — commits in one transaction.
- **Adjustments** (`/adjustments`): reason-coded (`damage`, `expiry_writeoff`,
  `count_correction`, `theft`, `sample`). The conditional UPDATE keeps
  `qty_remaining ≥ 0` even under races. Adjustments at/above
  `adjustments.step_up_thresholds` (`qtyBase` 500 or `valueMinor` ₱500.00 at
  cost) require the PIN step-up before writing.
- **CSV import** (`/products/import`): upload → per-row dry-run errors →
  all-or-nothing commit in one transaction; template at
  `GET /api/products/import-template`. Caps: 500 rows / 256 KB.
- **FEFO** (`src/lib/fefo.ts`): pure `allocateFefo` + `fetchFefoCandidates`;
  skips expired batches, splits across batches, returns `null` when short.
  M2 checkout will call it.
- Both settings keys are seeded; `src/lib/settings.ts` falls back to the same
  defaults when rows are absent.

## Layout

```
src/app/(auth)/login     sign-in page
src/app/(app)            authenticated shell: dashboard, /products (+/new,
                         /[id], /import), /inventory (+/movements),
                         /receiving, /adjustments, /audit, owner-only /users
src/app/api/health       public liveness probe
src/app/api/auth         Better Auth handler
src/app/api/products     search, per-product batches, import template
src/components           shadcn/ui + app shell, combobox, step-up dialog
src/db/schema            Drizzle schema (one file per domain)
src/db/seed*.ts          demo dataset + dev-only credentials
src/db/verify.ts         schema integrity probe (tests + db:smoke)
src/lib                  money/dates/units/roles, auth, authz, audit,
                         rate-limit, step-up, env, request context,
                         permissions, settings, tx, catalog/inventory
                         mutations+queries, product-search, fefo,
                         shelf-life, csv, product-import
scripts/                 migrate, seed, reset, rebuild-fts, smoke (tsx)
drizzle/                 generated migrations (+ hand-written SQL block)
tests/                   integration tests (migration, seed, inventory)
```
