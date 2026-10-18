import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDatabase } from "@/db/client";
import { requireUser } from "@/lib/authz";
import { todayIso } from "@/lib/dates";
import { serverEnv } from "@/lib/env";
import { formatMinor } from "@/lib/money";
import { can } from "@/lib/permissions";
import { browseProducts, searchProducts, type ProductSearchHit } from "@/lib/product-search";

export const metadata: Metadata = {
  title: "Products",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const env = serverEnv();
  const { client } = getDatabase();

  const products: ProductSearchHit[] = user.branchId
    ? query.length > 0
      ? await searchProducts(client, query, {
          branchId: user.branchId,
          todayIso: todayIso(env.APP_TIMEZONE),
          limit: 50,
        })
      : await browseProducts(client, {
          branchId: user.branchId,
          todayIso: todayIso(env.APP_TIMEZONE),
          limit: 50,
        })
    : [];

  const canManage = can(user.role, "catalog.manage");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Products</h1>
          <p className="text-muted-foreground text-sm">
            Search by name, generic name, SKU or barcode.
          </p>
        </div>
        {canManage ? (
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/products/import">Import CSV</Link>
            </Button>
            <Button asChild>
              <Link href="/products/new">New product</Link>
            </Button>
          </div>
        ) : null}
      </div>

      <form action="/products" method="get" className="flex gap-2">
        <Input
          name="q"
          defaultValue={query}
          placeholder="e.g. paracetamol, amoxicillin, MED-0001…"
          className="max-w-md"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Form</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground py-8 text-center">
                    {query ? `No products match “${query}”.` : "No products yet."}
                  </TableCell>
                </TableRow>
              ) : (
                products.map((product) => {
                  const defaultUnit =
                    product.units.find((unit) => unit.isDefaultSale) ?? product.units[0];
                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        <Link
                          href={`/products/${product.id}`}
                          className="font-medium hover:underline"
                        >
                          {product.name}
                        </Link>
                        {product.genericName ? (
                          <div className="text-muted-foreground text-xs">
                            {product.genericName}
                            {product.strength ? ` ${product.strength}` : ""}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{product.sku}</TableCell>
                      <TableCell className="text-muted-foreground">{product.form ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {product.requiresRx ? <Badge variant="secondary">Rx</Badge> : null}
                          {product.controlledSchedule ? (
                            <Badge variant="destructive">{product.controlledSchedule}</Badge>
                          ) : null}
                          {product.coldChain ? <Badge variant="outline">Cold chain</Badge> : null}
                          {product.stockBase === 0 ? (
                            <Badge variant="outline">Out of stock</Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {defaultUnit?.priceMinor != null
                          ? `${formatMinor(defaultUnit.priceMinor, env.APP_CURRENCY)} / ${defaultUnit.name}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {product.stockBase.toLocaleString("en-PH")} {product.baseUnit}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-xs">
        Stock = non-expired on-hand {products.length === 50 ? "· showing first 50 results" : ""}
      </p>
    </div>
  );
}
