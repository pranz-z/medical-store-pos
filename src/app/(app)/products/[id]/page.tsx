import { asc, desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDatabase, getDb } from "@/db/client";
import {
  categories,
  productBarcodes,
  productPrices,
  products,
  productUnits,
  taxClasses,
} from "@/db/schema/catalog";
import { requireUser } from "@/lib/authz";
import { todayIso } from "@/lib/dates";
import { serverEnv } from "@/lib/env";
import { listBatches } from "@/lib/inventory-queries";
import { formatMinor } from "@/lib/money";
import { can } from "@/lib/permissions";

import { AdminPanels, type DetailData } from "./admin-panels";

export const metadata: Metadata = {
  title: "Product",
};

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const env = serverEnv();
  const db = getDb();
  const { client } = getDatabase();

  const rows = await db
    .select({
      product: products,
      categoryName: categories.name,
      taxClassName: taxClasses.name,
      taxRateBp: taxClasses.rateBp,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(taxClasses, eq(products.taxClassId, taxClasses.id))
    .where(eq(products.id, id))
    .limit(1);
  const row = rows[0];
  if (!row || !can(user.role, "catalog.view")) notFound();

  const [unitRows, priceRows, barcodeRows, categoryRows, taxRows, batchRows] = await Promise.all([
    db
      .select()
      .from(productUnits)
      .where(eq(productUnits.productId, id))
      .orderBy(asc(productUnits.factorToBase)),
    db
      .select()
      .from(productPrices)
      .where(eq(productPrices.productId, id))
      .orderBy(desc(productPrices.effectiveFrom)),
    db
      .select({
        id: productBarcodes.id,
        barcode: productBarcodes.barcode,
        unitId: productBarcodes.unitId,
        unitName: productUnits.name,
      })
      .from(productBarcodes)
      .leftJoin(productUnits, eq(productBarcodes.unitId, productUnits.id))
      .where(eq(productBarcodes.productId, id)),
    db.select({ id: categories.id, name: categories.name }).from(categories),
    db
      .select({ id: taxClasses.id, name: taxClasses.name, rateBp: taxClasses.rateBp })
      .from(taxClasses),
    user.branchId
      ? listBatches(client, {
          branchId: user.branchId,
          today: todayIso(env.APP_TIMEZONE),
          filter: "all",
          productId: id,
        })
      : Promise.resolve([]),
  ]);

  const product = row.product;
  const data: DetailData = {
    product: {
      id: product.id,
      sku: product.sku,
      name: product.name,
      genericName: product.genericName,
      strength: product.strength,
      form: product.form,
      manufacturer: product.manufacturer,
      categoryId: product.categoryId,
      categoryName: row.categoryName,
      baseUnit: product.baseUnit,
      taxClassId: product.taxClassId,
      taxClassName: row.taxClassName,
      requiresRx: product.requiresRx,
      controlledSchedule: product.controlledSchedule,
      coldChain: product.coldChain,
      sellableLoose: product.sellableLoose,
      storageNotes: product.storageNotes,
      reorderLevel: product.reorderLevel,
      active: product.active,
    },
    units: unitRows.map((unit) => ({
      id: unit.id,
      name: unit.name,
      factorToBase: unit.factorToBase,
      isDefaultSale: unit.isDefaultSale,
    })),
    prices: priceRows.map((price) => ({
      id: price.id,
      unitId: price.unitId,
      priceMinor: price.price,
      effectiveFrom: price.effectiveFrom.toISOString(),
      effectiveTo: price.effectiveTo ? price.effectiveTo.toISOString() : null,
    })),
    barcodes: barcodeRows.map((barcode) => ({
      id: barcode.id,
      barcode: barcode.barcode,
      unitName: barcode.unitName,
    })),
    batches: batchRows,
    categories: categoryRows,
    taxClasses: taxRows,
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/products" className="hover:underline">
            Products
          </Link>{" "}
          / {product.sku}
        </p>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          {product.name}
          {!product.active ? <Badge variant="destructive">Inactive</Badge> : null}
          {product.requiresRx ? <Badge variant="secondary">Rx</Badge> : null}
          {product.controlledSchedule ? (
            <Badge variant="destructive">{product.controlledSchedule}</Badge>
          ) : null}
          {product.coldChain ? <Badge variant="outline">Cold chain</Badge> : null}
        </h1>
        <p className="text-muted-foreground text-sm">
          {[product.genericName, product.strength, product.form, product.manufacturer]
            .filter(Boolean)
            .join(" · ") || "No additional details"}
        </p>
      </div>

      <AdminPanels
        data={data}
        currency={env.APP_CURRENCY}
        canManage={can(user.role, "catalog.manage")}
        canPrice={can(user.role, "price.manage")}
        canViewInventory={can(user.role, "inventory.view")}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Price history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="px-4 py-2 font-medium">Unit</th>
                <th className="px-4 py-2 font-medium">Price</th>
                <th className="px-4 py-2 font-medium">Effective from</th>
                <th className="px-4 py-2 font-medium">Effective to</th>
              </tr>
            </thead>
            <tbody>
              {data.prices.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-muted-foreground px-4 py-6 text-center">
                    No prices set.
                  </td>
                </tr>
              ) : (
                data.prices.map((price) => (
                  <tr key={price.id} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      {data.units.find((unit) => unit.id === price.unitId)?.name ?? price.unitId}
                    </td>
                    <td className="px-4 py-2">{formatMinor(price.priceMinor, env.APP_CURRENCY)}</td>
                    <td className="text-muted-foreground px-4 py-2">
                      {price.effectiveFrom.slice(0, 10)}
                    </td>
                    <td className="px-4 py-2">
                      {price.effectiveTo ? (
                        <span className="text-muted-foreground">
                          {price.effectiveTo.slice(0, 10)}
                        </span>
                      ) : (
                        <Badge variant="secondary">current</Badge>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
