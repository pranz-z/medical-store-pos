"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BatchRow } from "@/lib/inventory-queries";
import { formatMinor, parseMinor } from "@/lib/money";

import {
  addBarcodeAction,
  addProductUnitAction,
  setDefaultUnitAction,
  setProductActiveAction,
  setProductPriceAction,
  removeBarcodeAction,
  type ActionResult,
} from "../actions";
import { ProductForm, type CategoryOption, type TaxClassOption } from "../_components/product-form";

export interface DetailData {
  product: {
    id: string;
    sku: string;
    name: string;
    genericName: string | null;
    strength: string | null;
    form: string | null;
    manufacturer: string | null;
    categoryId: string | null;
    categoryName: string | null;
    baseUnit: string;
    taxClassId: string | null;
    taxClassName: string | null;
    requiresRx: boolean;
    controlledSchedule: string | null;
    coldChain: boolean;
    sellableLoose: boolean;
    storageNotes: string | null;
    reorderLevel: number;
    active: boolean;
  };
  units: { id: string; name: string; factorToBase: number; isDefaultSale: boolean }[];
  prices: {
    id: string;
    unitId: string;
    priceMinor: number;
    effectiveFrom: string;
    effectiveTo: string | null;
  }[];
  barcodes: { id: string; barcode: string; unitName: string | null }[];
  batches: BatchRow[];
  categories: CategoryOption[];
  taxClasses: TaxClassOption[];
}

export function AdminPanels({
  data,
  currency,
  canManage,
  canPrice,
  canViewInventory,
}: {
  data: DetailData;
  currency: string;
  canManage: boolean;
  canPrice: boolean;
  canViewInventory: boolean;
}) {
  const { product } = data;
  const [editing, setEditing] = useState(false);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Details</CardTitle>
          {canManage ? (
            <Button size="sm" variant="outline" onClick={() => setEditing((value) => !value)}>
              {editing ? "Hide editor" : "Edit"}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {editing && canManage ? (
            <ProductForm
              mode="edit"
              productId={product.id}
              categories={data.categories}
              taxClasses={data.taxClasses}
              initial={{
                sku: product.sku,
                name: product.name,
                genericName: product.genericName ?? "",
                strength: product.strength ?? "",
                form: product.form ?? "",
                manufacturer: product.manufacturer ?? "",
                categoryId: product.categoryId ?? "",
                baseUnit: product.baseUnit,
                taxClassId: product.taxClassId ?? "",
                requiresRx: product.requiresRx,
                controlledSchedule: product.controlledSchedule ?? "",
                coldChain: product.coldChain,
                sellableLoose: product.sellableLoose,
                storageNotes: product.storageNotes ?? "",
                reorderLevel: product.reorderLevel,
              }}
            />
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Detail label="Category" value={product.categoryName ?? "—"} />
              <Detail label="Tax class" value={product.taxClassName ?? "—"} />
              <Detail label="Base unit" value={product.baseUnit} />
              <Detail label="Reorder level" value={String(product.reorderLevel)} />
              <Detail label="Sellable loose" value={product.sellableLoose ? "Yes" : "No"} />
              <Detail label="Storage" value={product.storageNotes ?? "—"} />
            </dl>
          )}
          {canManage ? <ActiveToggle productId={product.id} active={product.active} /> : null}
        </CardContent>
      </Card>

      <UnitsCard data={data} currency={currency} canManage={canManage} canPrice={canPrice} />
      <BarcodesCard data={data} canManage={canManage} />
      <BatchesCard data={data} currency={currency} canViewInventory={canViewInventory} />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ActiveToggle({ productId, active }: { productId: string; active: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-4 border-t pt-3">
      {error ? <p className="text-destructive mb-2 text-sm">{error}</p> : null}
      <Button
        size="sm"
        variant={active ? "destructive" : "default"}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await setProductActiveAction({ productId, active: !active });
            if (result.status === "error") setError(result.message);
            else router.refresh();
          })
        }
      >
        {active ? "Deactivate product" : "Reactivate product"}
      </Button>
    </div>
  );
}

function UnitsCard({
  data,
  currency,
  canManage,
  canPrice,
}: {
  data: DetailData;
  currency: string;
  canManage: boolean;
  canPrice: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [unitName, setUnitName] = useState("");
  const [factor, setFactor] = useState("");
  const [price, setPrice] = useState("");
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});

  const currentPrice = (unitId: string) =>
    data.prices.find((price) => price.unitId === unitId && price.effectiveTo === null);

  function run(result: Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const outcome = await result;
      if (outcome.status === "error") setError(outcome.message);
      else {
        setUnitName("");
        setFactor("");
        setPrice("");
        router.refresh();
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Units &amp; prices</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th className="py-1 font-medium">Unit</th>
              <th className="py-1 font-medium">Factor</th>
              <th className="py-1 font-medium">Price</th>
              <th className="py-1 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.units.map((unit) => (
              <tr key={unit.id} className="border-b last:border-0">
                <td className="py-1.5">
                  {unit.name}
                  {unit.isDefaultSale ? (
                    <Badge variant="secondary" className="ml-2">
                      default
                    </Badge>
                  ) : null}
                </td>
                <td className="text-muted-foreground py-1.5">
                  1 = {unit.factorToBase} {data.product.baseUnit}
                </td>
                <td className="py-1.5">
                  {canPrice ? (
                    <span className="flex items-center gap-1">
                      <Input
                        className="h-7 w-24 text-xs"
                        inputMode="decimal"
                        placeholder={
                          currentPrice(unit.id)
                            ? formatMinor(currentPrice(unit.id)!.priceMinor, currency)
                            : "0.00"
                        }
                        value={priceDrafts[unit.id] ?? ""}
                        onChange={(event) =>
                          setPriceDrafts((previous) => ({
                            ...previous,
                            [unit.id]: event.target.value,
                          }))
                        }
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={
                          pending ||
                          parseMinor(priceDrafts[unit.id] ?? "") === null ||
                          (priceDrafts[unit.id] ?? "") === ""
                        }
                        onClick={() => {
                          const parsed = parseMinor(priceDrafts[unit.id] ?? "");
                          if (parsed === null) return;
                          run(
                            setProductPriceAction({
                              productId: data.product.id,
                              unitId: unit.id,
                              priceMinor: parsed,
                            }),
                          );
                        }}
                      >
                        Set
                      </Button>
                    </span>
                  ) : currentPrice(unit.id) ? (
                    formatMinor(currentPrice(unit.id)!.priceMinor, currency)
                  ) : (
                    "—"
                  )}
                </td>
                <td className="py-1.5 text-right">
                  {canManage && !unit.isDefaultSale ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        run(setDefaultUnitAction({ productId: data.product.id, unitId: unit.id }))
                      }
                    >
                      Make default
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {canManage ? (
          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">New unit</Label>
              <Input
                className="h-8 w-28"
                placeholder="box"
                value={unitName}
                onChange={(event) => setUnitName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">= base units</Label>
              <Input
                className="h-8 w-24"
                type="number"
                min={1}
                placeholder="100"
                value={factor}
                onChange={(event) => setFactor(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Price (₱)</Label>
              <Input
                className="h-8 w-24"
                inputMode="decimal"
                placeholder="optional"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={
                pending ||
                unitName.trim().length === 0 ||
                !/^\d+$/.test(factor) ||
                (price.trim() !== "" && parseMinor(price) === null)
              }
              onClick={() => {
                const parsedPrice = price.trim() === "" ? undefined : (parseMinor(price) ?? 0);
                run(
                  addProductUnitAction({
                    productId: data.product.id,
                    name: unitName.trim(),
                    factorToBase: Number(factor),
                    ...(parsedPrice !== undefined ? { priceMinor: parsedPrice } : {}),
                  }),
                );
              }}
            >
              Add unit
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BarcodesCard({ data, canManage }: { data: DetailData; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [barcode, setBarcode] = useState("");
  const [unitId, setUnitId] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Barcodes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {data.barcodes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No barcodes yet.</p>
        ) : (
          <ul className="text-sm">
            {data.barcodes.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between border-b py-1.5 last:border-0"
              >
                <span>
                  <code className="font-mono">{row.barcode}</code>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {row.unitName ?? "any unit"}
                  </span>
                </span>
                {canManage ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        setError(null);
                        const result = await removeBarcodeAction({
                          barcodeId: row.id,
                          productId: data.product.id,
                        });
                        if (result.status === "error") setError(result.message);
                        else router.refresh();
                      })
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Barcode</Label>
              <Input
                className="h-8 w-44 font-mono"
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Unit</Label>
              <select
                className="border-input bg-background h-8 rounded-md border px-2 text-sm"
                value={unitId}
                onChange={(event) => setUnitId(event.target.value)}
              >
                <option value="">Any</option>
                {data.units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || barcode.trim().length === 0}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await addBarcodeAction({
                    productId: data.product.id,
                    barcode: barcode.trim(),
                    unitId: unitId || null,
                  });
                  if (result.status === "error") setError(result.message);
                  else {
                    setBarcode("");
                    router.refresh();
                  }
                })
              }
            >
              Add barcode
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BatchesCard({
  data,
  currency,
  canViewInventory,
}: {
  data: DetailData;
  currency: string;
  canViewInventory: boolean;
}) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Batches on hand</CardTitle>
        {canViewInventory ? (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/inventory/movements?product=${data.product.id}`}>View ledger</Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-muted-foreground border-b text-left">
              <th className="px-4 py-2 font-medium">Batch</th>
              <th className="px-4 py-2 font-medium">Expiry</th>
              <th className="px-4 py-2 text-right font-medium">On hand</th>
              <th className="px-4 py-2 text-right font-medium">Cost / {data.product.baseUnit}</th>
            </tr>
          </thead>
          <tbody>
            {data.batches.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-muted-foreground px-4 py-6 text-center">
                  No stock received yet.
                </td>
              </tr>
            ) : (
              data.batches.map((batch) => (
                <tr key={batch.batchId} className="border-b last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{batch.batchNo}</td>
                  <td className="px-4 py-2">
                    {batch.expiryDate}
                    {batch.daysToExpiry < 0 ? (
                      <Badge variant="destructive" className="ml-2">
                        expired
                      </Badge>
                    ) : batch.daysToExpiry <= 90 ? (
                      <Badge variant="secondary" className="ml-2">
                        {batch.daysToExpiry}d
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {batch.qtyRemaining.toLocaleString("en-PH")} /{" "}
                    {batch.qtyReceived.toLocaleString("en-PH")}
                  </td>
                  <td className="text-muted-foreground px-4 py-2 text-right">
                    {formatMinor(batch.costPerBaseUnitMinor, currency)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
