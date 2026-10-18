"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SaleReceipt } from "@/lib/pos-shared";

import { ReceiptView } from "../../pos/receipt-view";

export function ReprintDialog({
  receipt,
  currency,
  timeZone,
  onClose,
}: {
  receipt: SaleReceipt;
  currency: string;
  timeZone: string;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reprint receipt #{receipt.receiptNo}</DialogTitle>
          <DialogDescription>
            This copy is marked REPRINT and the reprint is audited.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto">
          <ReceiptView receipt={receipt} currency={currency} timeZone={timeZone} mark="REPRINT" />
        </div>
        <Button onClick={() => window.print()}>Print</Button>
      </DialogContent>
      <div className="print-area" aria-hidden>
        <ReceiptView receipt={receipt} currency={currency} timeZone={timeZone} mark="REPRINT" />
      </div>
    </Dialog>
  );
}
