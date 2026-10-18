"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { ApprovalDialog } from "@/components/approval-dialog";
import { ProductCombobox } from "@/components/product-combobox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addDaysIso } from "@/lib/dates";
import { deleteHeldCart, holdCart, listHeldCarts, type HeldCart } from "@/lib/held-carts";
import { formatMinor, parseMinor } from "@/lib/money";
import {
  discountApprovalPayload,
  type CheckoutInput,
  type CheckoutPaymentInput,
  type SaleReceipt,
  type StockAvailability,
} from "@/lib/pos-shared";
import type { ProductSearchHit } from "@/lib/product-search";

import { closeShiftAction, openShiftAction } from "./actions";
import { PaymentDialog } from "./payment-dialog";
import { ReceiptView } from "./receipt-view";

interface CartLine {
  key: string;
  product: ProductSearchHit;
  unitId: string;
  /** Quantity in the chosen unit (fractional only for sellable_loose products). */
  qtyUnits: string;
  discount: string;
}

let lineSeq = 0;
const nextKey = () => `line-${++lineSeq}`;

/**
 * Keyboard-first POS (spec §6.1): the scan input stays focused, Enter adds the
 * item, and every value on screen is an estimate — checkout re-prices and
 * re-validates on the server via POST /api/sales.
 */
export function PosScreen({
  initialShift,
  currency,
  timeZone,
  today,
  nearExpiryWarnDays,
  discountMaxPct,
}: {
  initialShift: { id: string; openingFloatMinor: number; openedAt: number } | null;
  currency: string;
  timeZone: string;
  /** Today in APP_TIMEZONE (server-computed — keeps render pure). */
  today: string;
  nearExpiryWarnDays: number;
  discountMaxPct: number;
}) {
  const warnCutoff = addDaysIso(today, nearExpiryWarnDays);
  const [shift, setShift] = useState(initialShift);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cartDiscount, setCartDiscount] = useState("");
  const [scan, setScan] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [heldCarts, setHeldCarts] = useState<HeldCart[]>([]);
  const [heldCartId, setHeldCartId] = useState<string | null>(null);
  const [closeOpen, setCloseOpen] = useState(false);
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [floatInput, setFloatInput] = useState("");
  const [countedInput, setCountedInput] = useState("");

  const scanRef = useRef<HTMLInputElement>(null);
  const idemKeyRef = useRef<string | null>(null);
  const pendingPaymentsRef = useRef<CheckoutPaymentInput[]>([]);
  const money = (v: number) => formatMinor(v, currency);

  // Scanner-first UX: whenever nothing else is focused, typing falls back to
  // the scan input so a scan works even after clicking around.
  useEffect(() => {
    scanRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      const el = document.activeElement;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement;
      if (!typing && (event.key.length === 1 || event.key === "Enter")) {
        scanRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function addProduct(hit: ProductSearchHit) {
    if (hit.requiresRx || hit.controlledSchedule) {
      setError(`${hit.name}: prescription handling arrives in the next release.`);
      return;
    }
    const unit = hit.units.find((u) => u.isDefaultSale) ?? hit.units[0];
    if (!unit) {
      setError(`${hit.name} has no sale units configured.`);
      return;
    }
    setError(null);
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === hit.id && l.unitId === unit.id);
      if (existing && Number(existing.qtyUnits) > 0) {
        return prev.map((l) =>
          l === existing ? { ...l, qtyUnits: String(Number(l.qtyUnits) + 1) } : l,
        );
      }
      return [
        ...prev,
        { key: nextKey(), product: hit, unitId: unit.id, qtyUnits: "1", discount: "" },
      ];
    });
  }

  async function onScanEnter() {
    const q = scan.trim();
    if (!q) return;
    setScan("");
    const response = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&limit=5`);
    if (!response.ok) {
      setError("Search failed — try again.");
      return;
    }
    const { products } = (await response.json()) as { products: ProductSearchHit[] };
    if (products.length === 0) {
      setError(`No product matches "${q}" — check the barcode or search by name.`);
      return;
    }
    if (products.length === 1 || products[0].matchedBarcode) {
      addProduct(products[0]);
      return;
    }
    setError(`Several products match "${q}" — pick one from the search box.`);
  }

  const cartLines = lines
    .map((line) => {
      const unit = line.product.units.find((u) => u.id === line.unitId);
      const qty = Number(line.qtyUnits);
      const qtyBase = unit ? Math.round(qty * unit.factorToBase) : 0;
      return { line, unit, qty, qtyBase };
    })
    .filter((entry) => entry.qtyBase > 0 && entry.unit !== undefined);

  // Display-only estimate; the server recomputes the real totals at checkout.
  const estimate = Math.max(
    0,
    cartLines.reduce(
      (acc, { unit, qty, line }) =>
        acc + Math.round((unit!.priceMinor ?? 0) * qty) - (parseMinor(line.discount) ?? 0),
      0,
    ) - (parseMinor(cartDiscount) ?? 0),
  );
  const cartDiscountMinor = parseMinor(cartDiscount) ?? 0;
  const cartInvalid =
    cartLines.length === 0 || cartLines.some(({ unit }) => unit!.priceMinor === null);

  function buildInput(approvalToken?: string): CheckoutInput {
    return {
      lines: cartLines.map(({ line, qtyBase }) => ({
        productId: line.product.id,
        unitId: line.unitId,
        qtyBase,
        ...(parseMinor(line.discount) ? { discountMinor: parseMinor(line.discount)! } : {}),
      })),
      ...(cartDiscountMinor > 0 ? { cartDiscountMinor } : {}),
      payments: pendingPaymentsRef.current,
      ...(approvalToken ? { approvalToken } : {}),
    };
  }

  async function submitCheckout(payments: CheckoutPaymentInput[], approvalToken?: string) {
    pendingPaymentsRef.current = payments;
    // One idempotency key per attempt; retries (incl. after approval) reuse it.
    idemKeyRef.current ??= crypto.randomUUID();
    const input = { ...buildInput(approvalToken), payments };
    const response = await fetch("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idemKeyRef.current },
      body: JSON.stringify(input),
    });
    const body = (await response.json()) as {
      receipt?: SaleReceipt;
      error?: string;
      message?: string;
      details?: StockAvailability[];
    };
    if (response.ok && body.receipt) {
      setReceipt(body.receipt);
      setLines([]);
      setCartDiscount("");
      setPayOpen(false);
      setError(null);
      idemKeyRef.current = null;
      pendingPaymentsRef.current = [];
      if (heldCartId) {
        await deleteHeldCart(heldCartId);
        setHeldCartId(null);
      }
      return;
    }
    if (body.error === "approval_required") {
      setPayOpen(false);
      setApprovalOpen(true);
      return;
    }
    if (body.error === "stock_changed" && body.details) {
      const detail = body.details
        .map((d) => {
          const name = lines.find((l) => l.product.id === d.productId)?.product.name ?? d.productId;
          return `${name}: ${d.availableBase} base unit(s) left`;
        })
        .join("; ");
      setError(`Stock changed — ${detail}. Adjust the cart and try again.`);
      setPayOpen(false);
      return;
    }
    setError(body.message ?? "Checkout failed — try again.");
  }

  async function onHold() {
    if (lines.length === 0) return;
    const cart: HeldCart = {
      id: heldCartId ?? crypto.randomUUID(),
      label: new Date().toLocaleTimeString("en-PH", { timeZone }),
      lines: lines.map((line) => ({
        productId: line.product.id,
        unitId: line.unitId,
        qtyUnits: Number(line.qtyUnits) || 0,
        discountMinor: parseMinor(line.discount) ?? 0,
      })),
      cartDiscountMinor,
      heldAt: Date.now(),
    };
    await holdCart(cart);
    setLines([]);
    setCartDiscount("");
    setHeldCartId(null);
    setNotice(`Cart held (${cart.label}). Items are re-priced and re-validated at checkout.`);
  }

  async function openHeldList() {
    setHeldCarts(await listHeldCarts());
    setHeldOpen(true);
  }

  /** Resume: re-fetch every product so stock/price displays are live, never trusted. */
  async function resumeHeld(id: string) {
    const cart = heldCarts.find((c) => c.id === id);
    if (!cart) return;
    const rebuilt: CartLine[] = [];
    const dropped: string[] = [];
    for (const held of cart.lines) {
      const response = await fetch(`/api/products/${held.productId}`);
      const body = (await response.json()) as { product?: ProductSearchHit };
      if (!body.product) {
        dropped.push(held.productId);
        continue;
      }
      rebuilt.push({
        key: nextKey(),
        product: body.product,
        unitId: held.unitId,
        qtyUnits: String(held.qtyUnits),
        discount: held.discountMinor > 0 ? (held.discountMinor / 100).toFixed(2) : "",
      });
    }
    setLines(rebuilt);
    setCartDiscount(cart.cartDiscountMinor > 0 ? (cart.cartDiscountMinor / 100).toFixed(2) : "");
    setHeldCartId(cart.id);
    setHeldOpen(false);
    setError(dropped.length > 0 ? `${dropped.length} held item(s) no longer sellable.` : null);
  }

  function handleOpenShift() {
    const openingFloatMinor = parseMinor(floatInput) ?? 0;
    startTransition(async () => {
      const result = await openShiftAction(openingFloatMinor);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setShift(result.shift);
      setError(null);
      setFloatInput("");
    });
  }

  function handleCloseShift() {
    if (!shift) return;
    const counted = parseMinor(countedInput);
    if (counted === null) {
      setError("Enter the counted cash as an amount.");
      return;
    }
    startTransition(async () => {
      const result = await closeShiftAction(shift.id, counted);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      const message =
        result.status === "ok" && "varianceMinor" in result
          ? `Shift closed — expected ${money(result.expectedMinor)}, variance ${money(result.varianceMinor)}.`
          : "Shift closed.";
      setNotice(message);
      setShift(null);
      setCloseOpen(false);
    });
  }

  if (!shift) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col gap-3 pt-6">
          <h2 className="text-lg font-semibold">Open your shift</h2>
          <p className="text-muted-foreground text-sm">
            Enter the opening float in the cash drawer. A sale cannot run without an open shift.
          </p>
          {notice ? (
            <Alert>
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex items-center gap-2">
            <Input
              inputMode="decimal"
              placeholder="Opening float (₱)"
              value={floatInput}
              onChange={(e) => setFloatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleOpenShift()}
            />
            <Button onClick={handleOpenShift} disabled={pending || parseMinor(floatInput) === null}>
              Open shift
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input
            ref={scanRef}
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void onScanEnter()}
            placeholder="Scan barcode or type SKU, then Enter"
            className="font-mono"
            aria-label="Scan barcode"
          />
          <ProductCombobox onSelect={addProduct} placeholder="Search name / generic…" />
        </div>

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

        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs opacity-70">
                  <th className="p-2">Item</th>
                  <th className="w-24 p-2">Qty</th>
                  <th className="w-28 p-2">Unit</th>
                  <th className="w-28 p-2">Discount</th>
                  <th className="w-24 p-2 text-right">Amount</th>
                  <th className="w-8 p-2" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const unit = line.product.units.find((u) => u.id === line.unitId);
                  const qty = Number(line.qtyUnits) || 0;
                  const nearExpiry =
                    line.product.earliestExpiry !== null &&
                    line.product.earliestExpiry <= warnCutoff;
                  return (
                    <tr key={line.key} className="border-b last:border-0">
                      <td className="p-2">
                        <div className="font-medium">{line.product.name}</div>
                        <div className="flex items-center gap-1 text-xs opacity-70">
                          {line.product.sku}
                          <Badge variant={line.product.stockBase > 0 ? "outline" : "destructive"}>
                            {line.product.stockBase} {line.product.baseUnit}(s) on hand
                          </Badge>
                          {nearExpiry ? (
                            <Badge variant="secondary">expires {line.product.earliestExpiry}</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="p-2">
                        <Input
                          inputMode="decimal"
                          className="h-8 w-20"
                          value={line.qtyUnits}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((l) =>
                                l === line ? { ...l, qtyUnits: e.target.value } : l,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="p-2">
                        <select
                          className="border-input bg-background h-8 w-24 rounded-md border px-1 text-xs"
                          value={line.unitId}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((l) => (l === line ? { ...l, unitId: e.target.value } : l)),
                            )
                          }
                        >
                          {line.product.units.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.name} ×{u.factorToBase}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <Input
                          inputMode="decimal"
                          className="h-8 w-24"
                          placeholder="0.00"
                          value={line.discount}
                          onChange={(e) =>
                            setLines((prev) =>
                              prev.map((l) =>
                                l === line ? { ...l, discount: e.target.value } : l,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="p-2 text-right tabular-nums">
                        {unit ? money(Math.round((unit.priceMinor ?? 0) * qty)) : "—"}
                      </td>
                      <td className="p-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label="Remove line"
                          onClick={() => setLines((prev) => prev.filter((l) => l !== line))}
                        >
                          ×
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-muted-foreground p-6 text-center">
                      Cart is empty — scan a barcode or search to add items.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="text-muted-foreground text-xs">
            Shift opened {new Date(shift.openedAt).toLocaleTimeString("en-PH", { timeZone })} ·
            float {money(shift.openingFloatMinor)}
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>Cart discount</span>
            <Input
              inputMode="decimal"
              className="h-8 w-28 text-right"
              placeholder="0.00"
              value={cartDiscount}
              onChange={(e) => setCartDiscount(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between border-t pt-2 text-lg font-semibold">
            <span>Estimated total</span>
            <span>{money(estimate)}</span>
          </div>
          <p className="text-muted-foreground text-xs">
            Estimate only — the server re-prices at checkout. Discounts above {discountMaxPct}% need
            manager approval.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => void onHold()} disabled={lines.length === 0}>
              Hold
            </Button>
            <Button variant="outline" onClick={() => void openHeldList()}>
              Resume
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setLines([]);
                setCartDiscount("");
                setHeldCartId(null);
              }}
              disabled={lines.length === 0}
            >
              Clear
            </Button>
            <Button variant="outline" onClick={() => setCloseOpen(true)}>
              Close shift
            </Button>
          </div>
          <Button
            size="lg"
            onClick={() => {
              idemKeyRef.current = crypto.randomUUID();
              setPayOpen(true);
            }}
            disabled={cartInvalid || pending}
          >
            Charge {money(estimate)}
          </Button>
        </CardContent>
      </Card>

      <PaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        totalMinor={estimate}
        currency={currency}
        pending={pending}
        onPay={(payments) => startTransition(() => submitCheckout(payments))}
      />

      <ApprovalDialog
        open={approvalOpen}
        onOpenChange={setApprovalOpen}
        action="sale.discount_over_limit"
        payload={discountApprovalPayload({
          lines: cartLines.map(({ line, qtyBase }) => ({
            productId: line.product.id,
            unitId: line.unitId,
            qtyBase,
            discountMinor: parseMinor(line.discount) ?? 0,
          })),
          cartDiscountMinor,
        })}
        description={`This discount is above ${discountMaxPct}% — an owner or manager must approve it.`}
        onApproved={async (token) =>
          startTransition(() => submitCheckout(pendingPaymentsRef.current, token))
        }
      />

      <Dialog open={heldOpen} onOpenChange={setHeldOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Held carts</DialogTitle>
            <DialogDescription>Held on this terminal only.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {heldCarts.length === 0 ? (
              <p className="text-muted-foreground text-sm">No held carts.</p>
            ) : (
              heldCarts.map((cart) => (
                <div key={cart.id} className="flex items-center justify-between rounded border p-2">
                  <span className="text-sm">
                    {cart.label} — {cart.lines.length} item(s)
                  </span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => void resumeHeld(cart.id)}>
                      Resume
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await deleteHeldCart(cart.id);
                        setHeldCarts(await listHeldCarts());
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close shift</DialogTitle>
            <DialogDescription>Count the cash drawer and enter the total.</DialogDescription>
          </DialogHeader>
          <Input
            inputMode="decimal"
            placeholder="Counted cash (₱)"
            value={countedInput}
            onChange={(e) => setCountedInput(e.target.value)}
          />
          <Button
            onClick={handleCloseShift}
            disabled={pending || parseMinor(countedInput) === null}
          >
            Close shift
          </Button>
        </DialogContent>
      </Dialog>

      {receipt ? (
        <Dialog open onOpenChange={(open) => !open && setReceipt(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Sale completed</DialogTitle>
              <DialogDescription>Receipt #{receipt.receiptNo}</DialogDescription>
            </DialogHeader>
            <div className="max-h-96 overflow-y-auto">
              <ReceiptView receipt={receipt} currency={currency} timeZone={timeZone} />
            </div>
            <Button onClick={() => window.print()}>Print receipt</Button>
            <Button variant="outline" onClick={() => setReceipt(null)}>
              New sale
            </Button>
          </DialogContent>
        </Dialog>
      ) : null}

      <div className="print-area" aria-hidden>
        {receipt ? <ReceiptView receipt={receipt} currency={currency} timeZone={timeZone} /> : null}
      </div>
    </div>
  );
}
