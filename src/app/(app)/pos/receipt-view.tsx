import { formatMinor } from "@/lib/money";
import type { SaleReceipt } from "@/lib/pos-shared";

/**
 * 80 mm thermal-style receipt. Rendered inside a `.print-area` container —
 * globals.css hides everything but that container when printing.
 * `mark` is "REPRINT" for reprints (spec FR-POS-8).
 */
export function ReceiptView({
  receipt,
  currency,
  timeZone,
  mark,
}: {
  receipt: SaleReceipt;
  currency: string;
  timeZone: string;
  mark?: string;
}) {
  const money = (v: number) => formatMinor(v, currency);
  const when = new Intl.DateTimeFormat("en-PH", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(receipt.at));

  return (
    <div className="receipt font-mono text-[11px] leading-tight">
      <div className="text-center">
        <div className="text-sm font-bold">{receipt.storeName}</div>
        {receipt.storeAddress ? <div>{receipt.storeAddress}</div> : null}
        {receipt.storeTaxId ? <div>TIN {receipt.storeTaxId}</div> : null}
        <div className="my-1 border-t border-dashed" />
        <div>
          Receipt No. {String(receipt.receiptNo).padStart(6, "0")}
          {mark ? ` — ${mark}` : ""}
        </div>
        <div>
          {when} · {receipt.cashierName}
        </div>
        <div className="my-1 border-t border-dashed" />
      </div>

      <table className="w-full">
        <tbody>
          {receipt.lines.map((line, i) => (
            <tr key={i}>
              <td colSpan={2} className="pt-1">
                {line.productName}
                <div className="text-[10px] opacity-70">
                  {line.qtyBase / line.factorToBase} {line.unitName} × {money(line.unitPriceMinor)}
                  {" · "}
                  batch {line.batchNo} exp {line.expiryDate}
                </div>
              </td>
            </tr>
          ))}
          {receipt.lines.map((line, i) => (
            <tr key={`amt-${i}`}>
              <td>
                {line.discountMinor > 0 ? (
                  <span className="text-[10px] opacity-70">
                    (disc −{money(line.discountMinor)})
                  </span>
                ) : null}
              </td>
              <td className="text-right align-top">{money(line.lineTotalMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="my-1 border-t border-dashed" />

      <table className="w-full">
        <tbody>
          <tr>
            <td>Subtotal</td>
            <td className="text-right">{money(receipt.subtotalMinor)}</td>
          </tr>
          {receipt.discountTotalMinor > 0 ? (
            <tr>
              <td>
                Discounts
                {receipt.cartDiscountMinor > 0 ? (
                  <span className="text-[10px] opacity-70"> (incl. cart)</span>
                ) : null}
              </td>
              <td className="text-right">−{money(receipt.discountTotalMinor)}</td>
            </tr>
          ) : null}
          {receipt.taxTotalMinor > 0 ? (
            <tr>
              <td>VAT (incl.)</td>
              <td className="text-right">{money(receipt.taxTotalMinor)}</td>
            </tr>
          ) : null}
          {receipt.roundingMinor !== 0 ? (
            <tr>
              <td>Rounding</td>
              <td className="text-right">
                {receipt.roundingMinor > 0 ? "+" : "−"}
                {money(Math.abs(receipt.roundingMinor))}
              </td>
            </tr>
          ) : null}
          <tr className="text-sm font-bold">
            <td>TOTAL</td>
            <td className="text-right">{money(receipt.totalMinor)}</td>
          </tr>
        </tbody>
      </table>
      <div className="my-1 border-t border-dashed" />

      <table className="w-full">
        <tbody>
          {receipt.payments.map((p, i) => (
            <tr key={i}>
              <td className="capitalize">
                {p.method}
                {p.reference ? <span className="opacity-70"> ({p.reference})</span> : null}
              </td>
              <td className="text-right">{money(p.tenderedMinor)}</td>
            </tr>
          ))}
          {receipt.changeMinor > 0 ? (
            <tr className="font-bold">
              <td>Change</td>
              <td className="text-right">{money(receipt.changeMinor)}</td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="my-1 border-t border-dashed" />
      <div className="text-center">Thank you!</div>
    </div>
  );
}
