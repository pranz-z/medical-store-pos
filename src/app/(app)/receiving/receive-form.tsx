"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ProductCombobox } from "@/components/product-combobox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { parseMinor } from "@/lib/money";
import type { ProductSearchHit } from "@/lib/product-search";

import { receiveStockAction } from "./actions";

interface ReceiveLine {
  key: number;
  product: ProductSearchHit | null;
  unitId: string;
  batchNo: string;
  expiryDate: string;
  qty: string;
  unitCost: string;
}

let nextKey = 1;
const emptyLine = (): ReceiveLine => ({
  key: nextKey++,
  product: null,
  unitId: "",
  batchNo: "",
  expiryDate: "",
  qty: "",
  unitCost: "",
});

/** Multi-line ad-hoc receiving form (spec §6.3). */
export function ReceiveForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<ReceiveLine[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const setLine = <K extends keyof ReceiveLine>(key: number, field: K, value: ReceiveLine[K]) =>
    setLines((previous) =>
      previous.map((line) => (line.key === key ? { ...line, [field]: value } : line)),
    );

  function lineError(line: ReceiveLine): string | null {
    if (!line.product) return "Pick a product.";
    if (!line.unitId) return "Pick a unit.";
    if (line.batchNo.trim().length === 0) return "Batch no. required.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(line.expiryDate)) return "Expiry required (YYYY-MM-DD).";
    if (!/^\d+$/.test(line.qty) || Number(line.qty) <= 0)
      return "Quantity must be a positive whole number.";
    if (line.unitCost.trim() !== "" && parseMinor(line.unitCost) === null)
      return "Cost must be an amount like 850.00.";
    return null;
  }

  const invalid = lines.some((line) => lineError(line) !== null);

  function submit() {
    setError(null);
    setSuccess(null);
    const firstError = lines.map(lineError).find((message) => message !== null);
    if (firstError) {
      setError(firstError);
      return;
    }
    startTransition(async () => {
      const result = await receiveStockAction({
        supplierId: supplierId || null,
        reference: reference.trim() || undefined,
        lines: lines.map((line) => ({
          productId: line.product!.id,
          unitId: line.unitId,
          batchNo: line.batchNo.trim(),
          expiryDate: line.expiryDate,
          qty: Number(line.qty),
          unitCostMinor: parseMinor(line.unitCost) ?? 0,
        })),
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setSuccess(`Received ${result.lines} line(s). Stock, movements and audit are updated.`);
      setLines([emptyLine()]);
      setReference("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {success ? (
          <Alert>
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Supplier</span>
            <select
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
            >
              <option value="">Ad-hoc / unspecified</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Reference (invoice/DR no.)</span>
            <Input
              className="w-56"
              value={reference}
              placeholder="optional"
              onChange={(event) => setReference(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {lines.map((line, index) => (
            <div
              key={line.key}
              className="grid items-end gap-2 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-[minmax(220px,2fr)_110px_110px_140px_90px_110px_auto]"
            >
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium">Product</span>
                {line.product ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{line.product.name}</span>
                    {line.product.controlledSchedule ? (
                      <Badge variant="destructive">{line.product.controlledSchedule}</Badge>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setLine(line.key, "product", null)}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <ProductCombobox
                    autoFocus={index === lines.length - 1}
                    onSelect={(product) => {
                      setLine(line.key, "product", product);
                      const defaultUnit =
                        product.units.find((unit) => unit.isDefaultSale) ?? product.units[0];
                      setLine(line.key, "unitId", defaultUnit?.id ?? "");
                    }}
                  />
                )}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium">Unit</span>
                <select
                  className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                  value={line.unitId}
                  disabled={!line.product}
                  onChange={(event) => setLine(line.key, "unitId", event.target.value)}
                >
                  {(line.product?.units ?? []).map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium">Batch no.</span>
                <Input
                  value={line.batchNo}
                  onChange={(event) => setLine(line.key, "batchNo", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium">Expiry</span>
                <Input
                  type="date"
                  value={line.expiryDate}
                  onChange={(event) => setLine(line.key, "expiryDate", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium">Qty</span>
                <Input
                  type="number"
                  min={1}
                  value={line.qty}
                  onChange={(event) => setLine(line.key, "qty", event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium">Cost / unit (₱)</span>
                <Input
                  inputMode="decimal"
                  placeholder="0.00"
                  value={line.unitCost}
                  onChange={(event) => setLine(line.key, "unitCost", event.target.value)}
                />
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={lines.length === 1 || pending}
                onClick={() => setLines((previous) => previous.filter((l) => l.key !== line.key))}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setLines((p) => [...p, emptyLine()])}>
            Add line
          </Button>
          <Button onClick={submit} disabled={pending || invalid}>
            {pending ? "Receiving…" : `Receive ${lines.length} line(s)`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
