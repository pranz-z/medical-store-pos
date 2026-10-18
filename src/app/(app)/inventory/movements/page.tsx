import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDatabase } from "@/db/client";
import { requireUser } from "@/lib/authz";
import { listMovements } from "@/lib/inventory-queries";
import { can } from "@/lib/permissions";

export const metadata: Metadata = {
  title: "Movement ledger",
};

const TYPE_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  receipt: "default",
  return: "default",
  sale: "secondary",
  transfer: "secondary",
  adjust: "outline",
  writeoff: "destructive",
};

/** Read-only append-only stock movement ledger (spec §3.3 item 7). */
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string; product?: string }>;
}) {
  const user = await requireUser();

  if (!can(user.role, "inventory.view")) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Restricted</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Your role ({user.role}) cannot view the stock ledger.
        </CardContent>
      </Card>
    );
  }
  if (!user.branchId) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>No branch assigned</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  const { batch, product } = await searchParams;
  const rows = await listMovements(getDatabase().client, {
    branchId: user.branchId,
    ...(batch ? { batchId: batch } : {}),
    ...(product ? { productId: product } : {}),
    limit: 300,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Movement ledger</h1>
          <p className="text-muted-foreground text-sm">
            Append-only stock history{batch ? " for one batch" : product ? " for one product" : ""}.
            Newest first.
          </p>
        </div>
        <Link href="/inventory" className="text-sm font-medium underline underline-offset-4">
          Back to inventory
        </Link>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 text-right font-medium">Δ qty</th>
                  <th className="py-2 pr-3 font-medium">Product</th>
                  <th className="py-2 pr-3 font-medium">Batch</th>
                  <th className="py-2 pr-3 font-medium">Reason</th>
                  <th className="py-2 pr-3 font-medium">Ref</th>
                  <th className="py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      {new Date(row.at).toLocaleString("en-PH", {
                        timeZone: "Asia/Manila",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge variant={TYPE_VARIANTS[row.type] ?? "outline"}>{row.type}</Badge>
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-medium tabular-nums ${
                        row.qtyDelta < 0 ? "text-destructive" : "text-emerald-600"
                      }`}
                    >
                      {row.qtyDelta > 0
                        ? `+${row.qtyDelta.toLocaleString("en-PH")}`
                        : row.qtyDelta.toLocaleString("en-PH")}
                    </td>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/products/${row.productId}`}
                        className="font-medium underline underline-offset-4"
                      >
                        {row.productName}
                      </Link>
                      <div className="text-muted-foreground text-xs">{row.sku}</div>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.batchNo}</td>
                    <td className="py-2 pr-3 text-xs">{row.reason ?? "—"}</td>
                    <td className="py-2 pr-3 text-xs">{row.refType ?? "—"}</td>
                    <td className="py-2 text-xs">{row.userName ?? "—"}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-muted-foreground py-8 text-center">
                      No movements recorded yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
