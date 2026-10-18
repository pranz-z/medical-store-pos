import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import { createDatabase } from "../src/db/client";
import { todayIso } from "../src/lib/dates";
import { searchProducts } from "../src/lib/product-search";

/**
 * Search performance benchmark (spec §6.1 perf check).
 *
 * Generates a catalog into a throwaway temp database — `--rows N` products,
 * each with a sale unit, barcode, current price and one stocked batch — then
 * times `searchProducts` over a mix of barcode scans, name prefixes and
 * generic-name queries. Reports p50/p95/p99/max and exits non-zero when p95
 * exceeds the 200 ms target.
 *
 *   npm run bench:search                 # 50k-product dataset
 *   tsx scripts/search-bench.ts --rows 56 # seed-sized dataset
 */

const ROWS = intFlag("--rows", 50_000);
const QUERIES = intFlag("--queries", 300);
const KEEP = process.argv.includes("--keep");
const TARGET_P95_MS = 200;

const GENERICS = [
  "Paracetamol",
  "Amoxicillin",
  "Ibuprofen",
  "Cetirizine",
  "Metformin",
  "Losartan",
  "Amlodipine",
  "Omeprazole",
  "Azithromycin",
  "Salbutamol",
  "Ascorbic Acid",
  "Multivitamins",
  "Ascorbic",
  "Diphenhydramine",
  "Loperamide",
  "Hydrocortisone",
];
const FORMS = ["tablet", "capsule", "syrup", "suspension", "cream", "drops"];

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "search-bench-"));
  const url = `file:${join(dir, "bench.db")}`;
  const handle = createDatabase(url);
  const today = todayIso("Asia/Manila");
  console.log(`Benchmark DB: ${url} (${ROWS} products, ${QUERIES} timed queries)`);

  try {
    await migrate(drizzle(handle.client), { migrationsFolder: "./drizzle" });

    await handle.client.execute({
      sql: "insert into branches (id, name, created_at, updated_at) values ('b1', 'Bench Branch', 0, 0)",
      args: [],
    });

    const started = performance.now();
    const CHUNK = 250; // products per batch call (5 statements each)
    for (let base = 0; base < ROWS; base += CHUNK) {
      const statements: { sql: string; args: (string | number)[] }[] = [];
      for (let i = base; i < Math.min(base + CHUNK, ROWS); i += 1) {
        const id = `p-${i}`;
        const unitId = `u-${i}`;
        const generic = GENERICS[i % GENERICS.length];
        const name = `${generic} ${["Plus", "Forte", "Kids", "500", "Max"][i % 5]} ${Math.floor(i / GENERICS.length)}`;
        const expiry = i % 11 === 0 ? "2027-01-01" : "2027-12-31";
        statements.push(
          {
            sql: `insert into products (id, sku, name, generic_name, strength, form, base_unit,
                    requires_rx, controlled_schedule, cold_chain, sellable_loose, reorder_level,
                    active, created_at, updated_at)
                  values (?, ?, ?, ?, ?, ?, 'tablet', 0, null, 0, 1, 0, 1, 0, 0)`,
            args: [id, `SKU-${i}`, name, generic, `${100 + (i % 500)}mg`, FORMS[i % FORMS.length]],
          },
          {
            sql: `insert into product_units (id, product_id, name, factor_to_base, is_default_sale, created_at, updated_at)
                  values (?, ?, 'tablet', 1, 1, 0, 0)`,
            args: [unitId, id],
          },
          {
            sql: `insert into product_barcodes (id, barcode, product_id, unit_id, created_at, updated_at)
                  values (?, ?, ?, ?, 0, 0)`,
            args: [`bc-${i}`, `4800000${String(i).padStart(7, "0")}`, id, unitId],
          },
          {
            sql: `insert into product_prices (id, product_id, unit_id, price, effective_from, effective_to, created_at, updated_at)
                  values (?, ?, ?, ?, 0, null, 0, 0)`,
            args: [`pr-${i}`, id, unitId, 100 + (i % 1000)],
          },
          {
            sql: `insert into batches (id, product_id, branch_id, batch_no, expiry_date, cost_per_base_unit,
                    qty_received, qty_remaining, supplier_id, received_at, created_at, updated_at)
                  values (?, ?, 'b1', ?, ?, 10, 500, 500, null, 0, 0, 0)`,
            args: [`b-${i}`, id, `BN-${i % 997}`, expiry],
          },
        );
      }
      await handle.client.batch(statements, "write");
      if ((base + CHUNK) % 10_000 === 0) {
        console.log(`  generated ${base + CHUNK}/${ROWS} products…`);
      }
    }
    console.log(`Generation done in ${Math.round(performance.now() - started)} ms`);

    const queries = buildQueries();
    // Warm up the page cache / FTS reader before timing.
    for (const q of queries.slice(0, 25)) {
      await searchProducts(handle.client, q, { branchId: "b1", todayIso: today });
    }

    const timings: number[] = [];
    for (const q of queries.slice(0, QUERIES)) {
      const t0 = performance.now();
      await searchProducts(handle.client, q, { branchId: "b1", todayIso: today });
      timings.push(performance.now() - t0);
    }
    timings.sort((a, b) => a - b);
    const pct = (p: number) =>
      timings[Math.min(timings.length - 1, Math.ceil((p / 100) * timings.length) - 1)];
    const report = {
      n: timings.length,
      p50: pct(50).toFixed(1),
      p95: pct(95).toFixed(1),
      p99: pct(99).toFixed(1),
      max: timings[timings.length - 1].toFixed(1),
    };
    console.log(`searchProducts latency (ms): ${JSON.stringify(report)}`);
    if (Number(report.p95) > TARGET_P95_MS) {
      console.error(`FAIL: p95 ${report.p95} ms exceeds the ${TARGET_P95_MS} ms target.`);
      process.exitCode = 1;
    } else {
      console.log(`PASS: p95 ${report.p95} ms ≤ ${TARGET_P95_MS} ms target.`);
    }
  } finally {
    handle.client.close();
    if (!KEEP) {
      // The native handle can release the file a tick after close() resolves.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          rmSync(dir, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 4) console.warn(`Could not remove ${dir}:`, error);
          else await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    } else {
      console.log(`Kept benchmark DB at ${dir}`);
    }
  }
}

function buildQueries(): string[] {
  const queries: string[] = [];
  for (let i = 0; i < QUERIES; i += 1) {
    const pick = i % 10;
    if (pick < 3) {
      // Scanner: exact barcode.
      const id = Math.floor(Math.random() * ROWS);
      queries.push(`4800000${String(id).padStart(7, "0")}`);
    } else if (pick < 7) {
      // Name search: generic + brand word, mimicking what cashiers type.
      const generic = GENERICS[Math.floor(Math.random() * GENERICS.length)];
      queries.push(`${generic.toLowerCase()} ${["plus", "forte", "kids", "500", "max"][i % 5]}`);
    } else {
      queries.push(GENERICS[Math.floor(Math.random() * GENERICS.length)].toLowerCase());
    }
  }
  return queries;
}

function intFlag(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`${flag} must be a positive integer`);
    process.exit(1);
  }
  return value;
}

main().catch((error: unknown) => {
  console.error("Benchmark failed:", error);
  process.exitCode = 1;
});
