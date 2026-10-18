import Link from "next/link";

import { Badge } from "@/components/ui/badge";
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
import { DomainError } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { formatMinor } from "@/lib/money";
import { can } from "@/lib/permissions";
import { getShiftReport, listShifts } from "@/lib/shift-queries";

/**
 * Shift list + per-shift report (spec §6.1.9): owners/managers see everyone's
 * shifts at the branch; cashiers see their own. Open/close happens at /pos.
 */
export default async function ShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ shift?: string }>;
}) {
  const user = await requireUser();
  const db = getDatabase();
  const env = serverEnv();
  const params = await searchParams;
  const selectedId = typeof params.shift === "string" ? params.shift : undefined;

  const shifts = await listShifts(db, user).catch(() => []);
  const money = (v: number) => formatMinor(v, env.APP_CURRENCY);
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat("en-PH", {
      timeZone: env.APP_TIMEZONE,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(ms));

  let report = null;
  if (selectedId) {
    try {
      report = await getShiftReport(db, user, selectedId);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Shifts</h1>
        {can(user.role, "pos.sell") ? (
          <Link href="/pos" className="text-muted-foreground text-sm underline">
            Open/close a shift at the POS →
          </Link>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cashier</TableHead>
                <TableHead>Opened</TableHead>
                <TableHead>Closed</TableHead>
                <TableHead className="text-right">Float</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right">Counted</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shifts.map((shift) => (
                <TableRow key={shift.id}>
                  <TableCell>{shift.userName}</TableCell>
                  <TableCell>{fmt(shift.openedAt)}</TableCell>
                  <TableCell>
                    {shift.closedAt === null ? (
                      <Badge variant="secondary">open</Badge>
                    ) : (
                      fmt(shift.closedAt)
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(shift.openingFloatMinor)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {shift.expectedCashMinor === null ? "—" : money(shift.expectedCashMinor)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {shift.countedCashMinor === null ? "—" : money(shift.countedCashMinor)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {shift.varianceMinor === null ? (
                      "—"
                    ) : (
                      <span
                        className={shift.varianceMinor === 0 ? "" : "text-destructive font-medium"}
                      >
                        {shift.varianceMinor > 0 ? "+" : ""}
                        {money(shift.varianceMinor)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/shifts?shift=${shift.id}`} className="text-xs underline">
                      Report
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {shifts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground py-8 text-center">
                    No shifts yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {report ? (
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4">
            <h2 className="font-semibold">
              Shift report — {report.shift.userName} ({fmt(report.shift.openedAt)})
            </h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm sm:grid-cols-4">
              <span>Sales: {report.salesCount}</span>
              <span>Total: {money(report.salesTotalMinor)}</span>
              <span>Discounts: {money(report.discountsMinor)}</span>
              <span>Tax: {money(report.taxMinor)}</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tender</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Change given</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.byMethod.map((m) => (
                  <TableRow key={m.method}>
                    <TableCell className="capitalize">{m.method}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(m.amountMinor)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(m.changeMinor)}
                    </TableCell>
                  </TableRow>
                ))}
                {report.byMethod.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground text-center">
                      No payments in this shift.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
