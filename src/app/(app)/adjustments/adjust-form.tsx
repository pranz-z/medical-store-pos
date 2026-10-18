"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ProductCombobox } from "@/components/product-combobox";
import { StepUpDialog } from "@/components/step-up-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADJUST_REASONS, type AdjustReason } from "@/lib/inventory-shared";
import type { ProductSearchHit } from "@/lib/product-search";

import { adjustStockAction, type AdjustActionResult } from "./actions";

interface BatchOption {
  id: string;
  batchNo: string;
  expiryDate: string;
  qtyRemaining: number;
  costPerBaseUnitMinor: number;
}

const REASON_LABELS: Record<AdjustReason, string> = {
  damage: "Damage",
  expiry_writeoff: "Expiry write-off",
  count_correction: "Count correction",
  theft: "Theft / loss",
  sample: "Sample",
};

/** Reason-coded adjustment form. Large adjustments trigger the PIN step-up dialog. */
export function AdjustForm() {
  const router = useRouter();
  const [product, setProduct] = useState<ProductSearchHit | null>(null);
  const [batches, setBatches] = useState<BatchOption[]>([]);
  const [batchId, setBatchId] = useState("");
  const [reason, setReason] = useState<AdjustReason>("damage");
  const [qty, setQty] = useState("");
  const [direction, setDirection] = useState<"remove" | "add">("remove");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const selectedBatch = batches.find((batch) => batch.id === batchId);
  const isCorrection = reason === "count_correction";
  const qtyDelta =
    /^\d+$/.test(qty) && Number(qty) > 0
      ? (isCorrection && direction === "add" ? 1 : -1) * Number(qty)
      : null;

  async function pickProduct(hit: ProductSearchHit) {
    setProduct(hit);
    setBatchId("");
    setBatches([]);
    const response = await fetch(`/api/products/${hit.id}/batches`);
    if (response.ok) {
      const payload = (await response.json()) as { batches: BatchOption[] };
      setBatches(payload.batches);
      if (payload.batches[0]) setBatchId(payload.batches[0].id);
    }
  }

  function validationError(): string | null {
    if (!product) return "Pick a product.";
    if (!batchId) return "Pick a batch.";
    if (qtyDelta === null) return "Enter a positive whole-number quantity.";
    if (selectedBatch && qtyDelta < 0 && -qtyDelta > selectedBatch.qtyRemaining) {
      return `Only ${selectedBatch.qtyRemaining} ${product.baseUnit}(s) remain on this batch.`;
    }
    return null;
  }

  async function run(): Promise<AdjustActionResult> {
    return adjustStockAction({
      batchId,
      reason,
      qtyDeltaBase: qtyDelta!,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
  }

  function handleResult(result: AdjustActionResult) {
    if (result.status === "step-up-required") {
      setStepUpOpen(true);
      return;
    }
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    setNotice(`Adjustment recorded. New on-hand for the batch: ${result.newQtyRemaining}.`);
    setQty("");
    setNotes("");
    router.refresh();
    if (product) void pickProduct(product);
  }

  function submit() {
    setError(null);
    setNotice(null);
    const invalid = validationError();
    if (invalid) {
      setError(invalid);
      return;
    }
    startTransition(async () => handleResult(await run()));
  }

  return (
    <Card className="max-w-2xl">
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {notice ? (
          <Alert>
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label>Product</Label>
          {product ? (
            <div className="flex items-center gap-2">
              <span className="font-medium">{product.name}</span>
              {product.controlledSchedule ? (
                <Badge variant="destructive">{product.controlledSchedule}</Badge>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => setProduct(null)}>
                Change
              </Button>
            </div>
          ) : (
            <ProductCombobox onSelect={pickProduct} />
          )}
        </div>

        {product ? (
          <div className="flex flex-col gap-1.5">
            <Label>Batch</Label>
            <select
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              value={batchId}
              onChange={(event) => setBatchId(event.target.value)}
            >
              {batches.length === 0 ? <option value="">No batches on hand</option> : null}
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>
                  {batch.batchNo} · exp {batch.expiryDate} · {batch.qtyRemaining} on hand
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Reason</Label>
            <select
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              value={reason}
              onChange={(event) => setReason(event.target.value as AdjustReason)}
            >
              {ADJUST_REASONS.map((value) => (
                <option key={value} value={value}>
                  {REASON_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Quantity ({product?.baseUnit ?? "base units"})</Label>
            <div className="flex gap-2">
              {isCorrection ? (
                <select
                  className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                  value={direction}
                  onChange={(event) => setDirection(event.target.value as "remove" | "add")}
                >
                  <option value="remove">Remove</option>
                  <option value="add">Add</option>
                </select>
              ) : null}
              <Input
                type="number"
                min={1}
                value={qty}
                onChange={(event) => setQty(event.target.value)}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              {isCorrection
                ? "Count corrections may add or remove stock."
                : "This reason removes stock."}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Notes (optional)</Label>
          <Input
            value={notes}
            placeholder="e.g. water-damaged cartons, cycle count recount…"
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        <div>
          <Button onClick={submit} disabled={pending || validationError() !== null}>
            {pending ? "Recording…" : "Record adjustment"}
          </Button>
        </div>

        <StepUpDialog
          open={stepUpOpen}
          onOpenChange={setStepUpOpen}
          onVerified={async () => handleResult(await run())}
          description="This adjustment is above the configured threshold. Confirm with your 4–6 digit PIN to continue."
        />
      </CardContent>
    </Card>
  );
}
