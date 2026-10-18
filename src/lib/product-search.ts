import type { Client } from "@libsql/client";

/**
 * Product search (spec §FR-POS-1, §7 `GET /api/products/search`).
 *
 * Lookup order: an exact barcode match wins (scanner input); otherwise the
 * standalone `products_fts` FTS5 index handles name / generic name / SKU
 * prefix search. Every hit joins back to `products` so only **active**
 * products are returned. Availability is non-expired on-hand base units —
 * expired stock is never sellable.
 */

export interface ProductSearchUnit {
  id: string;
  name: string;
  factorToBase: number;
  /** Current selling price in minor units for this unit (null = no price set). */
  priceMinor: number | null;
  isDefaultSale: boolean;
}

export interface ProductSearchHit {
  id: string;
  sku: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  form: string | null;
  baseUnit: string;
  requiresRx: boolean;
  controlledSchedule: string | null;
  coldChain: boolean;
  /** Non-expired on-hand quantity in base units across the caller's branch. */
  stockBase: number;
  /** Earliest unexpired batch expiry (the batch FEFO would draw first), or null. */
  earliestExpiry: string | null;
  matchedBarcode: string | null;
  units: ProductSearchUnit[];
}

const SEARCH_LIMIT_MAX = 50;

export async function searchProducts(
  client: Client,
  query: string,
  options: { branchId: string; todayIso: string; limit?: number },
): Promise<ProductSearchHit[]> {
  const q = query.trim();
  const limit = Math.min(Math.max(1, options.limit ?? 20), SEARCH_LIMIT_MAX);
  if (q.length === 0) return [];

  // Barcode path: scanners send the full symbol in one shot.
  const barcodeHit = await client.execute({
    sql: `select p.id, pb.barcode from product_barcodes pb
          join products p on p.id = pb.product_id
          where pb.barcode = ? and p.active = 1 limit 1`,
    args: [q],
  });
  if (barcodeHit.rows.length > 0) {
    return hydrateProducts(
      client,
      [String(barcodeHit.rows[0].id)],
      options,
      new Map([[String(barcodeHit.rows[0].id), String(barcodeHit.rows[0].barcode)]]),
    );
  }

  const match = buildFtsMatch(q);
  if (!match) return [];

  const ftsHits = await client.execute({
    sql: `select f.product_id as id
          from products_fts f
          join products p on p.id = f.product_id
          where products_fts match ? and p.active = 1
          order by rank
          limit ?`,
    args: [match, limit],
  });
  const ids = ftsHits.rows.map((row) => String(row.id));
  return hydrateProducts(client, ids, options, new Map());
}

/** Loads one product's hydrated hit (held-cart resume, cart re-validation). */
export async function getProductHit(
  client: Client,
  productId: string,
  options: { branchId: string; todayIso: string },
): Promise<ProductSearchHit | null> {
  const active = await client.execute({
    sql: "select active from products where id = ?",
    args: [productId],
  });
  if (active.rows.length === 0 || Number(active.rows[0].active) !== 1) return null;
  const hits = await hydrateProducts(client, [productId], options, new Map());
  return hits[0] ?? null;
}

/** Alphabetical browse list used when the catalog page has no search query. */
export async function browseProducts(
  client: Client,
  options: { branchId: string; todayIso: string; limit?: number },
): Promise<ProductSearchHit[]> {
  const limit = Math.min(Math.max(1, options.limit ?? 50), SEARCH_LIMIT_MAX);
  const ids = await client.execute({
    sql: "select id from products where active = 1 order by name asc limit ?",
    args: [limit],
  });
  return hydrateProducts(
    client,
    ids.rows.map((row) => String(row.id)),
    options,
    new Map(),
  );
}

/**
 * Builds an FTS5 MATCH expression from free text: each alphanumeric token
 * becomes a quoted prefix term, AND-ed together. Quoting neutralizes any FTS
 * syntax characters that survive tokenization.
 */
export function buildFtsMatch(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(" ");
}

async function hydrateProducts(
  client: Client,
  ids: string[],
  options: { branchId: string; todayIso: string },
  barcodesByProduct: Map<string, string>,
): Promise<ProductSearchHit[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");

  const productRows = await client.execute({
    sql: `select p.id, p.sku, p.name, p.generic_name, p.strength, p.form, p.base_unit,
                 p.requires_rx, p.controlled_schedule, p.cold_chain,
                 coalesce((
                   select sum(b.qty_remaining) from batches b
                   where b.product_id = p.id and b.branch_id = ?
                     and b.qty_remaining > 0 and b.expiry_date >= ?
                 ), 0) as stock_base,
                 (select min(b.expiry_date) from batches b
                   where b.product_id = p.id and b.branch_id = ?
                     and b.qty_remaining > 0 and b.expiry_date >= ?
                 ) as earliest_expiry
          from products p
          where p.id in (${placeholders})`,
    args: [options.branchId, options.todayIso, options.branchId, options.todayIso, ...ids],
  });

  const unitRows = await client.execute({
    sql: `select u.id, u.product_id, u.name, u.factor_to_base, u.is_default_sale,
                 (select pr.price from product_prices pr
                   where pr.product_id = u.product_id and pr.unit_id = u.id
                     and pr.effective_to is null
                   order by pr.effective_from desc limit 1) as price
          from product_units u
          where u.product_id in (${placeholders})
          order by u.factor_to_base asc`,
    args: ids,
  });

  const unitsByProduct = new Map<string, ProductSearchUnit[]>();
  for (const row of unitRows.rows) {
    const list = unitsByProduct.get(String(row.product_id)) ?? [];
    list.push({
      id: String(row.id),
      name: String(row.name),
      factorToBase: Number(row.factor_to_base),
      priceMinor: row.price === null || row.price === undefined ? null : Number(row.price),
      isDefaultSale: Number(row.is_default_sale) === 1,
    });
    unitsByProduct.set(String(row.product_id), list);
  }

  const byId = new Map(productRows.rows.map((row) => [String(row.id), row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row) => row !== undefined)
    .map((row) => ({
      id: String(row.id),
      sku: String(row.sku),
      name: String(row.name),
      genericName: row.generic_name === null ? null : String(row.generic_name),
      strength: row.strength === null ? null : String(row.strength),
      form: row.form === null ? null : String(row.form),
      baseUnit: String(row.base_unit),
      requiresRx: Number(row.requires_rx) === 1,
      controlledSchedule: row.controlled_schedule === null ? null : String(row.controlled_schedule),
      coldChain: Number(row.cold_chain) === 1,
      stockBase: Number(row.stock_base),
      earliestExpiry: row.earliest_expiry === null ? null : String(row.earliest_expiry),
      matchedBarcode: barcodesByProduct.get(String(row.id)) ?? null,
      units: unitsByProduct.get(String(row.id)) ?? [],
    }));
}
