import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDatabase } from "@/db/client";
import { requireUser } from "@/lib/authz";
import { todayIso } from "@/lib/dates";
import { serverEnv } from "@/lib/env";
import {
  BATCH_FILTERS,
  inventoryAlertCounts,
  listBatches,
  type BatchFilter,
} from "@/lib/inventory-queries";
import { formatMinor } from "@/lib/money";
import { can } from "@/lib/permissions";

export const metadata: Metadata = {
  title: "Inventory",
};

const FILTER_HREFS: Record<BatchFilter, string> = {
  all: "/inventory",
  low: "/inventory?filter=low",
  exp30: "/inventory?filter=exp30",
  exp60: "/inventory?filter=exp60",
  exp90: "/inventory?filter=exp90",
  expired: "/inventory?filter=expired",
};

function parseFilter(raw: string | string[] | undefined): BatchFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return BATCH_FILTERS.some((filter) => filter.id === value) ? (value as BatchFilter) : "all";
}

/** Batch-level stock view with alert counts and expiry/low-stock filters (spec §3.3). */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const user = await requireUser();
  const { client } = getDatabase();
  const { APP_TIMEZONE, APP_CURRENCY } = serverEnv();
  const today = todayIso(APP_TIMEZONE);

  if (!can(user.role, "inventory.view")) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Restricted</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Your role ({user.role}) cannot view inventory.
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
        <CardContent className="text-muted-foreground text-sm">
          Your account is not assigned to a branch.
        </CardContent>
      </Card>
    );
  }

  const { filter: rawFilter } = await searchParams;
  const filter = parseFilter(rawFilter);
  const [alerts, rows] = await Promise.all([
    inventoryAlertCounts(client, { branchId: user.branchId, today }),
    listBatches(client, { branchId: user.branchId, today, filter }),
  ]);

  const alertCards = [
    {
      label: "Low-stock products",
      value: alerts.lowStockProducts,
      href: "/inventory?filter=low" as const,
    },
    {
      label: "Expiring ≤ 30 days",
      value: alerts.expiring30,
      href: "/inventory?filter=exp30" as const,
    },
    {
      label: "Expiring ≤ 60 days",
      value: alerts.expiring60,
      href: "/inventory?filter=exp60" as const,
    },
    {
      label: "Expiring ≤ 90 days",
      value: alerts.expiring90,
      href: "/inventory?filter=exp90" as const,
    },
    {
      label: "Expired on shelf",
      value: alerts.expiredBatches,
      href: "/inventory?filter=expired" as const,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Inventory</h1>
          <p className="text-muted-foreground text-sm">
            Batch-level on-hand, expiry and low-stock alerts (spec §3.3).
          </p>
        </div>
        <Link
          href="/inventory/movements"
          className="text-sm font-medium underline underline-offset-4"
        >
          Movement ledger
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {alertCards.map((card) => (
          <Link key={card.label} href={card.href}>
            <Card
              className={
                card.value > 0 && card.label !== "Low-stock products" ? "border-destructive/50" : ""
              }
            >
              <CardHeader className="pb-2">
                <CardDescription>{card.label}</CardDescription>
                <CardTitle className="text-2xl">{card.value.toLocaleString("en-PH")}</CardTitle>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap gap-2">
            {BATCH_FILTERS.map((item) => (
              <Link key={item.id} href={FILTER_HREFS[item.id]}>
                <Badge variant={item.id === filter ? "default" : "outline"}>{item.label}</Badge>
              </Link>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  <th className="py-2 pr-3 font-medium">Product</th>
                  <th className="py-2 pr-3 font-medium">Batch</th>
                  <th className="py-2 pr-3 font-medium">Expiry</th>
                  <th className="py-2 pr-3 text-right font-medium">On hand</th>
                  <th className="py-2 pr-3 text-right font-medium">Product total</th>
                  <th className="py-2 pr-3 text-right font-medium">Reorder at</th>
                  <th className="py-2 pr-3 text-right font-medium">Cost/base</th>
                  <th className="py-2 font-medium">Supplier</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const expired = row.daysToExpiry < 0;
                  const expiringSoon = !expired && row.daysToExpiry <= 30;
                  const low = row.reorderLevel > 0 && row.productOnHand <= row.reorderLevel;
                  return (
                    <tr key={row.batchId} className="border-b last:border-0">
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
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1.5">
                          {row.expiryDate}
                          {expired ? <Badge variant="destructive">expired</Badge> : null}
                          {expiringSoon ? (
                            <Badge variant="secondary">{row.daysToExpiry}d</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {row.qtyRemaining.toLocaleString("en-PH")}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {row.productOnHand.toLocaleString("en-PH")}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {row.reorderLevel > 0 ? (
                          <span className={low ? "text-destructive font-medium" : ""}>
                            {row.reorderLevel.toLocaleString("en-PH")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatMinor(row.costPerBaseUnitMinor, APP_CURRENCY)}
                      </td>
                      <td className="py-2 text-xs">{row.supplierName ?? "—"}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-muted-foreground py-8 text-center">
                      No batches match this filter.
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
