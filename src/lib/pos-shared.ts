/**
 * Client-safe POS definitions shared by the checkout mutation, the API route
 * and the POS screen. No server imports allowed in this file.
 */

export const PAYMENT_METHODS = ["cash", "card", "ewallet", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** One cart line as the client submits it. Prices/totals are never sent — the server re-prices. */
export interface CheckoutLineInput {
  productId: string;
  /** The unit whose price applies (box, tablet, ...). */
  unitId: string;
  /** Quantity in base units (the authoritative quantity). */
  qtyBase: number;
  /** Manual line discount in minor units. */
  discountMinor?: number;
}

export interface CheckoutPaymentInput {
  method: PaymentMethod;
  /** Amount tendered for this payment (what was handed over / charged). */
  amountMinor: number;
  /** Card approval code, e-wallet reference, etc. */
  reference?: string;
}

export interface CheckoutInput {
  lines: CheckoutLineInput[];
  /** Manual cart-level discount in minor units. */
  cartDiscountMinor?: number;
  payments: CheckoutPaymentInput[];
  /** Second-user approval token — required when discounts exceed the configured cap. */
  approvalToken?: string;
}

/** Domain payload a `sale.discount_over_limit` approval token is bound to. */
export function discountApprovalPayload(input: {
  lines: { productId: string; unitId: string; qtyBase: number; discountMinor: number }[];
  cartDiscountMinor: number;
}): unknown {
  return {
    lines: input.lines.map((line) => ({
      productId: line.productId,
      unitId: line.unitId,
      qtyBase: line.qtyBase,
      discountMinor: line.discountMinor,
    })),
    cartDiscountMinor: input.cartDiscountMinor,
  };
}

// ---- Receipt payload (server → client, also used by history/reprint) -------

export interface ReceiptLine {
  productName: string;
  sku: string;
  unitName: string;
  factorToBase: number;
  qtyBase: number;
  /** Price per sold unit (per `unitName`), integer minor. */
  unitPriceMinor: number;
  /** Line discount + this line's share of the cart discount. */
  discountMinor: number;
  taxRateBp: number;
  taxMinor: number;
  /** Amount the customer pays for this line (post-discount; tax-inclusive classes include the tax). */
  lineTotalMinor: number;
  batchNo: string;
  expiryDate: string;
}

export interface ReceiptPayment {
  method: PaymentMethod;
  /** Amount applied to the bill. */
  amountMinor: number;
  /** Amount tendered (cash may exceed `amountMinor`). */
  tenderedMinor: number;
  changeMinor: number;
  reference: string | null;
}

export interface SaleReceipt {
  saleId: string;
  receiptNo: number;
  branchId: string;
  at: number;
  status: string;
  cashierName: string;
  /** Store identity from the branch record, shown on the printed receipt. */
  storeName: string;
  storeAddress: string | null;
  storeTaxId: string | null;
  lines: ReceiptLine[];
  subtotalMinor: number;
  lineDiscountsMinor: number;
  cartDiscountMinor: number;
  discountTotalMinor: number;
  taxTotalMinor: number;
  roundingMinor: number;
  totalMinor: number;
  payments: ReceiptPayment[];
  /** Sum of change across payments. */
  changeMinor: number;
  /** True when the same idempotency key was replayed (no new sale was written). */
  replayed?: boolean;
}

/** Fresh per-product availability returned with a STOCK_CHANGED rejection. */
export interface StockAvailability {
  productId: string;
  availableBase: number;
}
