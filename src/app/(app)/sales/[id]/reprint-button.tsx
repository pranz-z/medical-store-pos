"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { SaleReceipt } from "@/lib/pos-shared";

import { reprintSaleAction } from "../../pos/actions";
import { ReprintDialog } from "./reprint-dialog";

/**
 * Reprint loads the receipt again through `reprintSale` so every reprint is
 * audited and marked "REPRINT" (spec FR-POS-8).
 */
export function ReprintButton({
  saleId,
  currency,
  timeZone,
}: {
  saleId: string;
  currency: string;
  timeZone: string;
}) {
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reprint() {
    startTransition(async () => {
      const result = await reprintSaleAction(saleId);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setReceipt(result);
    });
  }

  return (
    <>
      {error ? <span className="text-destructive text-xs">{error}</span> : null}
      <Button size="sm" variant="outline" onClick={reprint} disabled={pending}>
        {pending ? "Loading…" : "Reprint"}
      </Button>
      {receipt ? (
        <ReprintDialog
          receipt={receipt}
          currency={currency}
          timeZone={timeZone}
          onClose={() => setReceipt(null)}
        />
      ) : null}
    </>
  );
}
