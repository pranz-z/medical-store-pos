# Medical Store POS: Product & Technical Spec

**Stack:** Next.js on Vercel, Turso (libSQL) **Status:** Draft v0.1

## 1. Overview

A web-based point-of-sale and inventory system for a single pharmacy or medical store (extensible to a small multi-branch chain). It handles fast checkout, batch- and expiry-aware inventory, prescription tracking, purchasing, and reporting. It is deployed as a serverless app on Vercel with Turso as the database.

### 1.1 Goals

- Checkout in under 10 seconds for a typical 3-item basket, usable with a barcode scanner and keyboard only.
- Accurate stock at the batch level with FEFO (first-expiry-first-out) selling and expiry alerts.
- Compliance support: prescription capture, controlled-drug logging, configurable tax and discount rules, immutable audit trail.
- Low operating cost and near-zero server maintenance.

### 1.2 Non-goals (v1)

- Insurance claim adjudication or e-prescription integration.
- Full accounting or general ledger (export to accounting tools instead).
- Native mobile apps (responsive PWA only).
- Online storefront or delivery.

## 2. Users and Roles

| Role | Capabilities |
| --- | --- |
| Owner | Everything, including settings, reports, user management, price changes, voids and refunds without approval |
| Manager | Inventory, purchasing, price changes, refunds approval, reports, shift close |
| Pharmacist | Sell, dispense Rx items, record prescriptions, controlled-drug sales, stock adjustments (with reason) |
| Cashier | Sell non-Rx items, hold/resume carts, take payment, print receipts |
| Auditor (read-only) | Reports and audit log only |

Role checks are enforced server-side on every action. The UI only hides controls as a convenience.

## 3. Functional Requirements

### 3.1 Point of Sale

- **FR-POS-1** Add items by barcode scan, SKU, or name/generic-name search (debounced, results in under 200 ms for 50k products).
- **FR-POS-2** Cart supports quantity edit, line discount, cart discount, and per-line unit selection (box, strip, tablet) with automatic unit conversion.
- **FR-POS-3** Hold and resume multiple carts per terminal.
- **FR-POS-4** Tendering: cash, card (recorded manually, no gateway in v1), e-wallet/QR (recorded), split payments, change calculation.
- **FR-POS-5** Preset discount types (senior citizen, disability, staff, promo) configurable with eligibility rules, required ID reference, and tax treatment. Rules are configurable per jurisdiction rather than hard-coded.
- **FR-POS-6** Items flagged `requires_prescription` block checkout until a prescription record is attached or pharmacist override is recorded with a reason.
- **FR-POS-7** Batch allocation is automatic by FEFO. Expired batches are never sellable. Near-expiry batches (configurable threshold) show a warning.
- **FR-POS-8** Receipt printing via browser print (80 mm thermal CSS) and optional ESC/POS over WebUSB/WebSerial. Receipt shows store details, tax breakdown, discount lines, and a sequential receipt number.
- **FR-POS-9** Voids (pre-payment) and refunds/returns (post-payment) with reason codes, manager approval above a configurable threshold, and optional restock (only if the item is resellable, per product policy).
- **FR-POS-10** Shift management: open shift with opening float, close with counted cash, variance report.

### 3.2 Product Catalog

- Brand name, generic name, strength, dosage form, manufacturer, category, barcode(s), unit hierarchy (e.g., 1 box = 10 strips = 100 tablets), cost price, selling price, tax class, reorder level, storage notes.
- Flags: `requires_prescription`, `controlled_substance` (with schedule), `cold_chain`, `sellable_loose`.
- Bulk import/export via CSV with validation preview.
- Price history retained. A price change never alters past transactions.

### 3.3 Inventory

- Stock is tracked per **batch** (batch number, expiry date, cost, received quantity, remaining quantity, location).
- Receiving against purchase orders or ad hoc.
- Stock adjustments with mandatory reason (damage, expiry write-off, count correction, theft, sample).
- Stock counts (cycle or full) with variance review and approval.
- Inter-branch transfers (in-transit state) when multi-branch is enabled.
- Alerts: low stock, expiring in 30/60/90 days (configurable), expired-on-shelf.

### 3.4 Prescriptions and Controlled Drugs

- Capture: patient name, age/DOB, prescriber name and license number, prescription date, items prescribed, quantity dispensed, optional scanned image upload.
- Partial fills supported, tracking remaining refills where applicable.
- Controlled-drug register: every sale, receipt, adjustment, and write-off of a controlled item is logged in an append-only register exportable for inspection.
- Pharmacist authentication (re-enter PIN) required for controlled-drug sales.

### 3.5 Purchasing and Suppliers

- Supplier directory with terms, contact details, and lead time.
- Purchase orders (draft, sent, partially received, received, cancelled).
- Suggested reorder list from reorder levels and recent sales velocity.
- Supplier invoice capture and payable tracking (amount due, due date, paid status). No GL.

### 3.6 Customers

- Optional customer records (name, phone, DOB, notes, allergies). Walk-in sales need no customer.
- Purchase history and repeat-prescription lookup.
- Optional loyalty points (v1.1).

### 3.7 Reporting

- Daily sales summary (by tender, tax, discount type, cashier).
- Sales by product, category, generic name, hour.
- Gross margin by product and period.
- Inventory valuation (cost basis), expiry report, dead-stock report, stock movement ledger.
- Controlled-drug register.
- Tax report for filing, with CSV and PDF export.
- Shift reports.

### 3.8 Administration

- User management, role assignment, PIN and password reset.
- Store settings: legal name, address, tax ID, receipt header/footer, currency, tax classes and rates, rounding rules, discount rules.
- Audit log viewer (filter by user, entity, action, date).

## 4. Architecture

```
Browser (PWA, Next.js client)
   |  HTTPS
Vercel (Next.js App Router, Node.js runtime Serverless Functions)
   |  libSQL over HTTPS/WebSocket
Turso (primary database, region near the function region)
   |
Vercel Blob (prescription images, exports)
```

### 4.1 Technology Choices

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js (App Router), TypeScript | Server Components for reports, Server Actions/Route Handlers for mutations |
| DB | Turso (libSQL) | Accessed with `@libsql/client` |
| ORM / migrations | Drizzle ORM + drizzle-kit | SQL-first, type-safe, works with libSQL |
| Auth | Auth.js or Better Auth (credentials + PIN for step-up) | Session in signed, HttpOnly cookie; DB-backed sessions |
| Validation | Zod | Shared client/server schemas |
| UI | Tailwind CSS + shadcn/ui | Keyboard-first POS screen |
| Client data | TanStack Query | Caching of catalog search and cart state |
| File storage | Vercel Blob | Prescription scans; signed access only |
| Jobs | Vercel Cron | Expiry alerts, nightly snapshots, report pre-aggregation |
| Observability | Vercel Analytics, Sentry, structured logs | Request IDs on all mutations |
| Testing | Vitest, Playwright | Unit, integration against a local libSQL file, E2E on checkout |

### 4.2 Runtime and Region

- Use the **Node.js runtime** for all DB-touching routes (stable libSQL client behavior, transaction support).
- Pin the Vercel function region to the one closest to the Turso primary (set `preferredRegion` / project region). Cross-region round trips dominate POS latency, so keep them to a few milliseconds.
- Create the Turso database in the region nearest the store. Add replicas only if multi-branch reads need them. Writes always go to the primary.

### 4.3 Turso-Specific Design Rules

1. **Transactions:** Use `client.batch([...], "write")` or interactive `client.transaction("write")` for the checkout flow so sale, lines, payments, stock decrements, and audit entries commit atomically. Keep transactions short.
2. **Embedded replicas** are not used in Vercel serverless (ephemeral filesystem). All access is remote.
3. **Connection handling:** Create the client at module scope and reuse it. Avoid per-request clients.
4. **Concurrency:** SQLite has a single writer. Design hot writes to be small and fast. Stock decrements use conditional updates (`UPDATE ... SET remaining = remaining - ? WHERE id = ? AND remaining >= ?`) and check affected rows to prevent overselling.
5. **Migrations:** Drizzle migrations generated in CI and applied by a deploy step before traffic shifts (not at runtime in functions).
6. **Branching:** Use Turso database branches per Vercel preview deployment for safe testing; seed with anonymized fixtures.
7. **Backups:** Enable Turso point-in-time recovery, plus a nightly logical dump (cron) to Vercel Blob or external object storage, retained 35 days. Test restore quarterly.
8. **Secrets:** `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as Vercel environment variables, scoped per environment (Production / Preview / Development). Never exposed to the client.

## 5. Data Model

Conventions: all IDs are ULIDs (text); timestamps are UTC ISO-8601 text or integer epoch ms; **money is stored as integer minor units** (e.g., cents) with a `currency` setting; quantities are stored in the **smallest base unit** as integers. Every table has `created_at`, `updated_at`, and (where applicable) `branch_id`.

### 5.1 Core Tables

| Table | Key columns |
| --- | --- |
| `branches` | id, name, address, tax\_id |
| `users` | id, name, email, password\_hash, pin\_hash, role, branch\_id, active |
| `sessions` | id, user\_id, expires\_at |
| `products` | id, sku, name, generic\_name, strength, form, manufacturer, category\_id, base\_unit, tax\_class\_id, requires\_rx, controlled\_schedule, reorder\_level, active |
| `product_barcodes` | barcode (unique), product\_id, unit\_id |
| `product_units` | id, product\_id, name, factor\_to\_base, is\_default\_sale |
| `product_prices` | id, product\_id, unit\_id, price, effective\_from, effective\_to |
| `batches` | id, product\_id, branch\_id, batch\_no, expiry\_date, cost\_per\_base\_unit, qty\_received, qty\_remaining, supplier\_id, received\_at |
| `stock_movements` | id, batch\_id, type (receipt, sale, return, adjust, transfer, writeoff), qty\_delta, ref\_type, ref\_id, reason, user\_id, at |
| `customers` | id, name, phone, dob, allergies, notes |
| `prescriptions` | id, customer\_id, patient\_name, patient\_age, prescriber\_name, prescriber\_license, issued\_on, image\_url, notes |
| `prescription_items` | id, prescription\_id, product\_id, qty\_prescribed, qty\_dispensed |
| `sales` | id, receipt\_no, branch\_id, shift\_id, cashier\_id, customer\_id, status (completed, voided, refunded, partially\_refunded), subtotal, discount\_total, tax\_total, total, rounding, created\_at |
| `sale_lines` | id, sale\_id, product\_id, batch\_id, unit\_id, qty\_base, unit\_price, discount, tax\_rate, tax\_amount, line\_total, prescription\_id |
| `sale_discounts` | id, sale\_id, type, id\_reference, amount |
| `payments` | id, sale\_id, method, amount, reference |
| `refunds` | id, sale\_id, approved\_by, reason, total, created\_at; `refund_lines` mirrors `sale_lines` |
| `shifts` | id, user\_id, branch\_id, opened\_at, closed\_at, opening\_float, expected\_cash, counted\_cash, variance |
| `suppliers` | id, name, contact, terms\_days |
| `purchase_orders` / `po_lines` | status, expected\_date, product\_id, qty\_ordered, qty\_received, unit\_cost |
| `supplier_invoices` | id, supplier\_id, po\_id, number, amount, due\_date, paid\_at |
| `controlled_register` | id, product\_id, batch\_id, movement\_id, balance\_after, pharmacist\_id, patient/prescription ref (append-only) |
| `settings` | key, value (JSON) |
| `audit_log` | id, user\_id, action, entity, entity\_id, before (JSON), after (JSON), ip, request\_id, at |

> Note: `po_lines.unit_cost` is per **base unit** (matching `batches.cost_per_base_unit`). Costs entered in purchase units (per box, per strip) are converted to per-base-unit values by the receiving form before they reach this column.

### 5.2 Indexes (minimum)

- `product_barcodes(barcode)` unique
- `products(name)`, `products(generic_name)`, plus an FTS5 virtual table (`products_fts`) over name, generic name, and SKU for search
- `batches(product_id, branch_id, expiry_date)` for FEFO lookups, partial index where `qty_remaining > 0`
- `sales(branch_id, created_at)`, `sales(receipt_no)` unique per branch
- `stock_movements(batch_id, at)`
- `audit_log(entity, entity_id, at)`

### 5.3 Integrity Rules

- `qty_remaining >= 0` enforced by CHECK constraint.
- `stock_movements`, `controlled_register`, and `audit_log` are append-only (no UPDATE/DELETE paths in code; triggers raise an error on mutation).
- Receipt numbers are sequential per branch, allocated inside the checkout transaction from a counter row.
- Sales are never deleted. Corrections happen through voids or refunds.

## 6. Key Flows

### 6.1 Checkout (single transaction)

1. Client submits cart (product, unit, qty, discounts, payments, optional prescription ID) with an idempotency key.
2. Server validates input (Zod), permissions, and open shift.
3. Server re-prices from the database (never trusts client prices) and recalculates tax and discounts.
4. For each line, FEFO picks batches with unexpired stock. A line may span multiple batches (split into several `sale_lines`).
5. Open `write` transaction:
   - Check idempotency key. If already processed, return the stored result.
   - Insert `sales`, `sale_lines`, `sale_discounts`, `payments`.
   - Conditionally decrement each batch. If any affected row count is 0, roll back and return a `STOCK_CHANGED` error with fresh availability.
   - Insert `stock_movements`, `controlled_register` rows where applicable, and the audit entry.
   - Allocate the receipt number.
6. Return the receipt payload. Client prints and clears the cart.

### 6.2 Refund

1. Look up the sale by receipt number or scan.
2. Select lines and quantities (cannot exceed sold minus already refunded).
3. If total exceeds the approval threshold, require manager PIN.
4. Transaction: insert refund records, reverse payment (cash-out entry), restock to the original batch only if the product is resellable and the batch is unexpired, log movement and audit.

### 6.3 Receiving Stock

1. Choose PO or ad hoc supplier.
2. Enter batch number, expiry, quantity, and cost per line (barcode scan helps).
3. Reject expiry dates in the past or inside a configurable minimum shelf-life.
4. Create `batches` and `stock_movements`, update PO status, optionally create a supplier invoice record.

## 7. API Surface

Mutations use Server Actions or Route Handlers under `/api`. Reads for the POS screen use Route Handlers with short-cache headers. All endpoints are authenticated and role-checked, return typed errors, and log a request ID.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/products/search?q=` | FTS and barcode lookup, returns price and available stock |
| `POST /api/sales` | Checkout (idempotency key header required) |
| `POST /api/sales/:id/void` | Void (pre-settlement or same-shift) |
| `POST /api/sales/:id/refund` | Refund |
| `POST /api/shifts/open` / `close` | Shift lifecycle |
| `POST /api/receiving` | Receive stock |
| `POST /api/adjustments` | Stock adjustment |
| `POST /api/prescriptions` | Create prescription record |
| `GET /api/reports/:name` | Report data (paged, date-ranged) |
| `POST /api/import/products` | CSV import with dry-run mode |

## 8. Offline and Resilience

Pharmacies need to keep selling when the connection drops. Because Vercel and Turso are remote-only, v1 provides a **degraded offline mode**:

- The PWA caches the product catalog and price list in IndexedDB (refreshed every few minutes and on focus).
- When offline, the cashier can complete **non-prescription, non-controlled** cash sales. They are queued locally with idempotency keys and a provisional receipt number series (e.g., `OFF-<terminal>-<n>`).
- On reconnect, the queue replays through the normal checkout endpoint. Stock conflicts are surfaced in a reconciliation screen for the manager.
- Prescription and controlled-drug sales are **blocked offline** by design.
- A visible banner shows connection state and the number of queued sales.

Future option: a local-first sync layer if offline requirements grow.

## 9. Security and Privacy

- Passwords hashed with Argon2id (or bcrypt with a strong cost factor). PINs are hashed separately and rate limited.
- Server-side authorization on every mutation. Session cookies are HttpOnly, Secure, SameSite=Lax.
- CSRF protection on mutating routes. Rate limiting on login and PIN endpoints (Vercel Firewall or Upstash).
- Patient data (names, prescriptions, allergies) is treated as sensitive: least-privilege access, no PII in logs, field-level redaction in the audit viewer for non-pharmacist roles.
- Prescription images are stored in private Vercel Blob with short-lived signed URLs.
- TLS everywhere. Turso tokens are least-privilege (separate tokens for app and for read-only reporting).
- Data retention and deletion policy configurable to local pharmacy and privacy regulations. This spec does not assume a jurisdiction. Tax, discount, and controlled-drug rules are configuration, and local requirements should be confirmed with a qualified advisor before launch.
- Dependency scanning and lockfile pinning in CI.

## 10. Non-Functional Requirements

| Area | Target |
| --- | --- |
| Checkout API p95 | under 400 ms (same-region) |
| Product search p95 | under 200 ms |
| Availability | 99.9% monthly (platform-dependent) |
| RPO / RTO | 5 minutes / 1 hour via PITR |
| Scale | 1 to 5 branches, 20 concurrent terminals, 200k sales per year per branch, 100k SKUs |
| Browsers | Latest Chrome, Edge, Safari; tablets supported |
| Accessibility | Keyboard-complete POS flow, WCAG 2.1 AA for admin screens |
| Localization | Currency, date format, and language strings externalized (i18n-ready) |

## 11. Deployment and Environments

| Environment | Vercel | Turso |
| --- | --- | --- |
| Development | `vercel dev` / local | Local libSQL file (`file:local.db`) |
| Preview | Per-PR deployment | Branch database per PR, seeded fixtures |
| Production | `main` branch, pinned region | Primary DB with PITR, optional replicas |

**CI/CD pipeline:**

1. Lint, typecheck, unit tests, integration tests (local libSQL).
2. Generate and verify Drizzle migrations.
3. Playwright E2E against the preview deployment.
4. On merge to `main`: apply migrations to production (with automatic backup snapshot first), then promote the deployment.
5. Migrations follow expand/contract so the previous deployment keeps working during rollout.

**Environment variables:** `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `AUTH_SECRET`, `BLOB_READ_WRITE_TOKEN`, `SENTRY_DSN`, `CRON_SECRET`, `APP_TIMEZONE`.

**Cron jobs:** nightly expiry scan and alert digest, nightly backup dump, hourly low-stock check, daily report pre-aggregation (all authenticated with `CRON_SECRET`).

## 12. Hardware

- USB HID barcode scanner (keyboard wedge), no driver needed.
- 80 mm thermal receipt printer (browser print, or ESC/POS via WebUSB/WebSerial on Chromium).
- Cash drawer triggered via the receipt printer's drawer kick.
- Optional label printer for shelf and batch labels (v1.1).

## 13. Milestones

| Phase | Scope | Estimate |
| --- | --- | --- |
| M0 Foundations | Repo, CI/CD, Turso + Vercel setup, auth, roles, schema v1, audit log | 1.5 weeks |
| M1 Catalog and Inventory | Products, units, barcodes, batches, receiving, adjustments, CSV import | 2 weeks |
| M2 POS Core | Search, cart, FEFO checkout, payments, receipts, shifts | 2.5 weeks |
| M3 Compliance | Prescriptions, controlled register, discounts, voids and refunds, approvals | 2 weeks |
| M4 Purchasing and Reports | POs, supplier invoices, reports, exports, alerts and cron | 2 weeks |
| M5 Hardening | Offline queue, performance tuning, security review, backup/restore drill, UAT, pilot | 2 weeks |

## 14. Acceptance Criteria (selected)

- Selling an item reduces the earliest-expiring non-expired batch, and two simultaneous sales of the last unit result in exactly one success and one `STOCK_CHANGED` error.
- Replaying the same checkout request with the same idempotency key creates one sale only.
- Expired batches cannot be sold, even via manual override.
- A Rx-required item cannot be completed without a prescription record or a logged pharmacist override.
- Controlled-drug register balance always equals the sum of batch quantities for that product.
- Restoring the latest backup into a fresh Turso database yields a working app in under one hour.
- Every price change, adjustment, void, refund, and role change appears in the audit log with before/after values.

## 15. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Remote-only DB means internet outage stops sales | Offline queue for low-risk sales, recommend a backup connection (mobile hotspot/second ISP) |
| SQLite single-writer contention at peak | Short transactions, no long reports on the primary (use read replica or pre-aggregates), batch writes |
| Serverless cold starts add latency | Keep bundle small, pin region, warm critical routes via lightweight cron ping if needed |
| Regulatory differences across jurisdictions | Rules as configuration, compliance review before go-live |
| Data entry errors at receiving (wrong expiry) | Validation, confirmation step, and expiry sanity checks |
| Scope creep into accounting | Keep export-only integration in v1 |

## 16. Open Questions

1. Single store or multi-branch from day one?
2. Which tender types and any payment terminal integrations are required?
3. Which tax and discount rules, and which controlled-substance schedules, must be preconfigured?
4. Is an existing product database (CSV/legacy POS) available to migrate?
5. Required receipt format (official/fiscal receipt requirements, if any)?
6. Expected peak terminals and transactions per hour?
7. Is offline selling of prescription items ever required?
