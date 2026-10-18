import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDatabase } from "@/db/client";
import { requireUser } from "@/lib/authz";
import { serverEnv } from "@/lib/env";
import { formatMinor } from "@/lib/money";
import { can } from "@/lib/permissions";
import { listCashiers, listSales } from "@/lib/sales-queries";

/** Sales history (spec §6.1.8): filter by calendar date and/or cashier. */
export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; cashier?: string }>;
}) {
  const user = await requireUser();
  if (!can(user.role, "sales.view")) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">Your role cannot view sales history.</p>
        </CardContent>
      </Card>
    );
  }
  const params = await searchParams;
  const date =
    typeof params.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date)
      ? params.date
      : undefined;
  const cashierId = typeof params.cashier === "string" ? params.cashier : undefined;

  const db = getDatabase();
  const env = serverEnv();
  const [sales, cashiers] = await Promise.all([
    listSales(db, user, { date, cashierId }),
    listCashiers(db, user),
  ]);
  const money = (v: number) => formatMinor(v, env.APP_CURRENCY);
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat("en-PH", {
      timeZone: env.APP_TIMEZONE,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-lg font-semibold">Sales history</h1>
        <form className="flex items-end gap-2" action="/sales" method="get">
          <label className="flex flex-col gap-1 text-xs">
            Date
            <input
              type="date"
              name="date"
              defaultValue={date}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Cashier
            <select
              name="cashier"
              defaultValue={cashierId ?? ""}
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            >
              <option value="">All</option>
              {cashiers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="outline" size="sm">
            Filter
          </Button>
          <Link href="/sales" className="text-muted-foreground text-xs underline">
            Reset
          </Link>
        </form>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Cashier</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Tender</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell>
                    <Link href={`/sales/${sale.id}`} className="font-mono underline">
                      {String(sale.receiptNo).padStart(6, "0")}
                    </Link>
                  </TableCell>
                  <TableCell>{fmt(sale.at)}</TableCell>
                  <TableCell>{sale.cashierName}</TableCell>
                  <TableCell>{sale.lineCount}</TableCell>
                  <TableCell className="capitalize">{sale.methods}</TableCell>
                  <TableCell>
                    <Badge variant={sale.status === "completed" ? "secondary" : "outline"}>
                      {sale.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(sale.totalMinor)}
                  </TableCell>
                </TableRow>
              ))}
              {sales.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground py-8 text-center">
                    No sales match the filters.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
