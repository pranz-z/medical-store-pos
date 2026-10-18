import { and, count, eq, gt, gte, lt, lte, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { products } from "@/db/schema/catalog";
import { batches } from "@/db/schema/inventory";
import { requireUser } from "@/lib/authz";
import { addDaysIso, todayIso } from "@/lib/dates";
import { serverEnv } from "@/lib/env";
import { formatMinor } from "@/lib/money";
import { can } from "@/lib/permissions";
import { ROLE_LABELS } from "@/lib/roles";

export const metadata: Metadata = {
  title: "Dashboard",
};

const EXPIRY_HORIZON_DAYS = 90;

export default async function DashboardPage() {
  const user = await requireUser();
  const { APP_CURRENCY, APP_TIMEZONE } = serverEnv();

  const today = todayIso(APP_TIMEZONE);
  const horizon = addDaysIso(today, EXPIRY_HORIZON_DAYS);
  const db = getDb();

  const [[productStats], [stockStats], [expiredStats], [expiringStats]] = await Promise.all([
    db.select({ activeProducts: count() }).from(products).where(eq(products.active, true)),
    db
      .select({
        units: sql<number>`coalesce(sum(${batches.qtyRemaining}), 0)`,
        valueMinor: sql<number>`coalesce(sum(${batches.qtyRemaining} * ${batches.costPerBaseUnit}), 0)`,
      })
      .from(batches)
      .where(gt(batches.qtyRemaining, 0)),
    db
      .select({ expired: count() })
      .from(batches)
      .where(and(gt(batches.qtyRemaining, 0), lt(batches.expiryDate, today))),
    db
      .select({ expiring: count() })
      .from(batches)
      .where(
        and(
          gt(batches.qtyRemaining, 0),
          gte(batches.expiryDate, today),
          lte(batches.expiryDate, horizon),
        ),
      ),
  ]);

  const inventoryReader = can(user.role, "inventory.view");
  const stats: { label: string; value: string; href: Route }[] = [
    {
      label: "Active products",
      value: productStats.activeProducts.toLocaleString("en-PH"),
      href: "/products",
    },
    { label: "Units on hand", value: stockStats.units.toLocaleString("en-PH"), href: "/inventory" },
    {
      label: "Stock value (at cost)",
      value: formatMinor(stockStats.valueMinor, APP_CURRENCY),
      href: "/inventory",
    },
    {
      label: `Expiring in ${EXPIRY_HORIZON_DAYS} days`,
      value: expiringStats.expiring.toLocaleString("en-PH"),
      href: "/inventory?filter=exp90",
    },
    {
      label: "Expired, still on hand",
      value: expiredStats.expired.toLocaleString("en-PH"),
      href: "/inventory?filter=expired",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Signed in as {user.name} · {ROLE_LABELS[user.role]}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((stat) => {
          const card = (
            <Card key={stat.label}>
              <CardHeader>
                <CardDescription>{stat.label}</CardDescription>
                <CardTitle className="text-2xl">{stat.value}</CardTitle>
              </CardHeader>
            </Card>
          );
          return inventoryReader ? (
            <Link key={stat.label} href={stat.href}>
              {card}
            </Link>
          ) : (
            <div key={stat.label}>{card}</div>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Milestone M2 — POS core</CardTitle>
          <CardDescription>
            The register is live: scan or search, hold carts, split tender, FEFO checkout and
            printed receipts. Sales decrement the same batch stock these cards report.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground flex flex-col gap-2 text-sm">
          {can(user.role, "pos.sell") ? (
            <p>
              <Link href="/pos" className="underline">
                Open the register →
              </Link>
            </p>
          ) : null}
          <p>
            Coming in later milestones: prescriptions &amp; controlled-drug sales (M3), purchasing
            (M4), ESC/POS printers &amp; cash drawer (M5), reports.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
