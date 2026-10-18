"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatMinor, parseMinor } from "@/lib/money";
import { PAYMENT_METHODS, type CheckoutPaymentInput, type PaymentMethod } from "@/lib/pos-shared";

interface TenderRow {
  method: PaymentMethod;
  amount: string;
  reference: string;
}

/**
 * Split-tender payment dialog. Cash may overpay (change shown); non-cash is
 * capped at the amount still due — the server re-validates all of this.
 * The parent generates one idempotency key per attempt and reuses it on retry.
 */
export function PaymentDialog({
  open,
  onOpenChange,
  totalMinor,
  currency,
  pending,
  onPay,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Payable total (server estimate — the server's own total wins on submit). */
  totalMinor: number;
  currency: string;
  pending: boolean;
  onPay: (payments: CheckoutPaymentInput[]) => void;
}) {
  const [rows, setRows] = useState<TenderRow[]>([{ method: "cash", amount: "", reference: "" }]);
  const money = (v: number) => formatMinor(v, currency);

  const tendered = rows.reduce((acc, row) => acc + (parseMinor(row.amount) ?? 0), 0);
  const appliedPreview = useMemo(() => {
    let remaining = totalMinor;
    let change = 0;
    for (const row of rows) {
      const amount = parseMinor(row.amount) ?? 0;
      if (row.method === "cash") {
        const applied = Math.min(amount, remaining);
        change += amount - applied;
        remaining -= applied;
      } else {
        remaining -= Math.min(amount, remaining);
      }
    }
    return { shortfall: Math.max(0, remaining), change };
  }, [rows, totalMinor]);

  const valid =
    rows.every((row) => (parseMinor(row.amount) ?? 0) > 0) &&
    tendered >= totalMinor &&
    appliedPreview.shortfall === 0;

  function update(index: number, patch: Partial<TenderRow>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function submit() {
    if (!valid || pending) return;
    onPay(
      rows.map((row) => ({
        method: row.method,
        amountMinor: parseMinor(row.amount) ?? 0,
        ...(row.reference.trim() ? { reference: row.reference.trim() } : {}),
      })),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Payment</DialogTitle>
          <DialogDescription>
            Total due {money(totalMinor)} — split across methods if needed.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-[7rem_1fr_1fr_auto] items-center gap-2">
              <select
                className="border-input bg-background h-9 rounded-md border px-2 text-sm capitalize"
                value={row.method}
                onChange={(e) => update(i, { method: e.target.value as PaymentMethod })}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method} className="capitalize">
                    {method}
                  </option>
                ))}
              </select>
              <Input
                inputMode="decimal"
                placeholder="0.00"
                value={row.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
              />
              <Input
                placeholder={row.method === "cash" ? "—" : "Reference"}
                value={row.reference}
                onChange={(e) => update(i, { reference: e.target.value })}
                disabled={row.method === "cash"}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                disabled={rows.length === 1}
                aria-label="Remove tender"
              >
                ×
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              setRows((prev) => [...prev, { method: "card", amount: "", reference: "" }])
            }
          >
            Split tender
          </Button>
        </div>

        <div className="flex justify-between border-t pt-2 text-sm">
          <span>Tendered {money(tendered)}</span>
          <span className={appliedPreview.change > 0 ? "font-semibold" : ""}>
            Change {money(appliedPreview.change)}
          </span>
        </div>
        {appliedPreview.shortfall > 0 ? (
          <p className="text-destructive text-sm">Short {money(appliedPreview.shortfall)}</p>
        ) : null}

        <DialogFooter>
          <Button onClick={submit} disabled={!valid || pending}>
            {pending ? "Processing…" : `Charge ${money(totalMinor)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
