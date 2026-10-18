import { and, count, eq, gt, gte, lt, lte, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { products } from "@/db/schema/catalog";
import { batches } from "@/db/schema/inventory";
import { hasRole, requireUser } from "@/lib/authz";
import { addDaysIso, todayIso } from "@/lib/dates";
import { serverEnv } from "@/lib/env";
import { formatMinor } from "@/lib/money";
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

  const stats = [
    { label: "Active products", value: productStats.activeProducts.toLocaleString("en-PH") },
    { label: "Units on hand", value: stockStats.units.toLocaleString("en-PH") },
    { label: "Stock value (at cost)", value: formatMinor(stockStats.valueMinor, APP_CURRENCY) },
    {
      label: `Expiring in ${EXPIRY_HORIZON_DAYS} days`,
      value: expiringStats.expiring.toLocaleString("en-PH"),
    },
    { label: "Expired, still on hand", value: expiredStats.expired.toLocaleString("en-PH") },
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
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-2xl">{stat.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Milestone M0 — foundations in place</CardTitle>
          <CardDescription>
            Stock figures above come straight from the seeded batches and reflect the same
            server-side calculations the POS will use.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground flex flex-col gap-2 text-sm">
          <p>Coming in later milestones: sales/POS, purchasing &amp; receiving, reports.</p>
          {hasRole(user, "owner") ? (
            <p>
              Owners can{" "}
              <Link
                href="/users"
                className="text-foreground font-medium underline underline-offset-4"
              >
                manage staff accounts
              </Link>
              .
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
