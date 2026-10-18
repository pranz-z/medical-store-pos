import { hashPassword } from "better-auth/crypto";
import type { BatchItem } from "drizzle-orm/batch";

import type { DatabaseHandle } from "@/db/client";
import { accounts, users } from "@/db/schema/auth";
import {
  categories,
  productBarcodes,
  productPrices,
  products,
  productUnits,
  taxClasses,
} from "@/db/schema/catalog";
import { branches } from "@/db/schema/core";
import { batches, stockMovements } from "@/db/schema/inventory";
import { controlledRegister } from "@/db/schema/compliance";
import { suppliers } from "@/db/schema/purchasing";
import { settings } from "@/db/schema/system";
import { DEV_SEED_USERS } from "@/db/seed-credentials";
import {
  SEED_CATEGORIES,
  SEED_PRODUCTS,
  SEED_SUPPLIERS,
  SEED_TAX_CLASSES,
  seedSettings,
} from "@/db/seed-data";
import { serverEnv } from "@/lib/env";

/**
 * Seeds a fresh database with demo data (spec §4.3 milestone M0).
 *
 * Refuses to run when a branch already exists — use `npm run db:reset` for a
 * clean rebuild. All ids are deterministic (`seed_*`) so dev rows are easy to
 * grep; production rows use ULIDs.
 *
 * Every insert goes into a single write batch (one transaction on libSQL),
 * and the FTS triggers fire normally for the product rows.
 */

export const SEED_BRANCH_ID = "seed_branch_main";

export interface SeedSummary {
  users: number;
  taxClasses: number;
  categories: number;
  suppliers: number;
  products: number;
  productUnits: number;
  barcodes: number;
  batches: number;
  stockMovements: number;
  controlledRegister: number;
  settings: number;
}

export async function seedDatabase(handle: DatabaseHandle): Promise<SeedSummary> {
  const { db } = handle;

  const existing = await db.select({ id: branches.id }).from(branches).limit(1);
  if (existing.length > 0) {
    throw new Error(
      "Database already contains data (a branch row exists). Run `npm run db:reset` to rebuild it from scratch.",
    );
  }

  const env = serverEnv();
  const now = Date.now();
  const statements: BatchItem<"sqlite">[] = [];

  // ---------------------------------------------------------------- branch
  statements.push(
    db.insert(branches).values({
      id: SEED_BRANCH_ID,
      name: "Main Branch",
      address: "123 Rizal Avenue, Manila",
      taxId: "000-000-000-000",
    }),
  );

  // ----------------------------------------------------------------- users
  // Passwords and step-up PINs both use Better Auth's scrypt hasher, so the
  // sign-in and PIN flows verify them with the same `verifyPassword` util.
  for (const user of DEV_SEED_USERS) {
    const passwordHash = await hashPassword(user.password);
    const pinHash = await hashPassword(user.pin);
    statements.push(
      db.insert(users).values({
        id: user.id,
        name: user.name,
        email: user.email.toLowerCase(),
        emailVerified: true,
        role: user.role,
        branchId: SEED_BRANCH_ID,
        pinHash,
        active: true,
      }),
      db.insert(accounts).values({
        id: `${user.id}_account`,
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: passwordHash,
      }),
    );
  }

  // --------------------------------------------------- lookups and suppliers
  statements.push(...SEED_TAX_CLASSES.map((taxClass) => db.insert(taxClasses).values(taxClass)));
  statements.push(
    ...SEED_CATEGORIES.map((category) =>
      db.insert(categories).values({ id: category.id, name: category.name }),
    ),
  );
  statements.push(
    ...SEED_SUPPLIERS.map((supplier) =>
      db.insert(suppliers).values({
        id: supplier.id,
        name: supplier.name,
        contact: supplier.contact,
        termsDays: supplier.termsDays,
        leadTimeDays: supplier.leadTimeDays,
        active: true,
      }),
    ),
  );

  // ------------------------------------------------- products and inventory
  const categoryByKey = new Map(SEED_CATEGORIES.map((category) => [category.key, category.id]));
  let unitCount = 0;
  let barcodeCount = 0;
  let batchCount = 0;
  let movementCount = 0;
  let controlledCount = 0;

  SEED_PRODUCTS.forEach((product, index) => {
    const skuDigits = product.sku.replace(/\D/g, "").padStart(4, "0");
    const productId = `seed_prod_${skuDigits}`;
    // Received dates spread backwards so the data looks lived-in.
    const receivedAt = new Date(now - (index + 1) * 86_400_000);

    statements.push(
      db.insert(products).values({
        id: productId,
        sku: product.sku,
        name: product.name,
        genericName: product.genericName ?? null,
        strength: product.strength ?? null,
        form: product.form ?? null,
        manufacturer: product.manufacturer ?? null,
        categoryId: categoryByKey.get(product.category) ?? null,
        baseUnit: product.baseUnit,
        taxClassId: product.taxClass === "vat" ? "seed_tax_vat12" : "seed_tax_exempt",
        requiresRx: product.requiresRx ?? false,
        controlledSchedule: product.controlledSchedule ?? null,
        coldChain: product.coldChain ?? false,
        sellableLoose: product.sellableLoose ?? true,
        storageNotes: product.storageNotes ?? null,
        reorderLevel: product.reorderLevel ?? 0,
        active: true,
      }),
    );

    product.units.forEach((unit, unitIndex) => {
      const unitId = `${productId}_u${unitIndex}`;
      unitCount += 1;
      statements.push(
        db.insert(productUnits).values({
          id: unitId,
          productId,
          name: unit.name,
          factorToBase: unit.factorToBase,
          isDefaultSale: unit.isDefaultSale ?? false,
        }),
        db
          .insert(productPrices)
          .values({ id: `${unitId}_p`, productId, unitId, price: unit.price }),
      );

      // Synthetic EAN-13-shaped barcode: "48" + 4 sku digits + unit digit + 6 zeros.
      barcodeCount += 1;
      statements.push(
        db.insert(productBarcodes).values({
          id: `${unitId}_bc`,
          barcode: `48${skuDigits}${unitIndex}000000`,
          productId,
          unitId,
        }),
      );
    });

    product.batches.forEach((batch, batchIndex) => {
      const batchId = `${productId}_b${batchIndex}`;
      const batchNo = `B${skuDigits}-${batchIndex + 1}`;
      const supplier = batch.supplier === undefined ? undefined : SEED_SUPPLIERS[batch.supplier];
      const movementId = `${batchId}_m`;
      batchCount += 1;
      movementCount += 1;

      statements.push(
        db.insert(batches).values({
          id: batchId,
          productId,
          branchId: SEED_BRANCH_ID,
          batchNo,
          expiryDate: batch.expiryDate,
          costPerBaseUnit: batch.costPerBaseUnit,
          qtyReceived: batch.qty,
          qtyRemaining: batch.qty,
          supplierId: supplier?.id ?? null,
          receivedAt,
        }),
        db.insert(stockMovements).values({
          id: movementId,
          batchId,
          type: "receipt",
          qtyDelta: batch.qty,
          refType: "receiving",
          refId: batchId,
          reason: "Initial stock (seed)",
          userId: "seed_user_owner",
          at: receivedAt,
        }),
      );

      if (product.controlledSchedule && batchIndex === 0) {
        controlledCount += 1;
        statements.push(
          db.insert(controlledRegister).values({
            id: `${batchId}_cr`,
            productId,
            batchId,
            movementId,
            balanceAfter: batch.qty,
            pharmacistId: "seed_user_pharmacist",
          }),
        );
      }
    });
  });

  // --------------------------------------------------------------- settings
  const settingRows = seedSettings(env.APP_CURRENCY, env.APP_TIMEZONE);
  statements.push(
    ...settingRows.map((setting) =>
      // `settings.value` is a drizzle json column — it stringifies for us.
      db.insert(settings).values({ key: setting.key, value: setting.value }),
    ),
  );

  // One write batch = one transaction; keep it short (spec §4.3.4).
  await db.batch(statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);

  return {
    users: DEV_SEED_USERS.length,
    taxClasses: SEED_TAX_CLASSES.length,
    categories: SEED_CATEGORIES.length,
    suppliers: SEED_SUPPLIERS.length,
    products: SEED_PRODUCTS.length,
    productUnits: unitCount,
    barcodes: barcodeCount,
    batches: batchCount,
    stockMovements: movementCount,
    controlledRegister: controlledCount,
    settings: settingRows.length,
  };
}
