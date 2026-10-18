import { Card, CardContent } from "@/components/ui/card";
import { getDatabase } from "@/db/client";
import { requireUser } from "@/lib/authz";
import { serverEnv } from "@/lib/env";
import { can } from "@/lib/permissions";
import { todayIso } from "@/lib/dates";
import { getNearExpiryWarnDays, getDiscountMaxPct } from "@/lib/settings";
import { getOpenShift } from "@/lib/shift-mutations";

import { PosScreen } from "./pos-screen";

/** POS register (spec §6.1): open-shift gate, then the scanner-first screen. */
export default async function PosPage() {
  const user = await requireUser();
  if (!can(user.role, "pos.sell")) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">
            Your role does not include point-of-sale access.
          </p>
        </CardContent>
      </Card>
    );
  }
  const db = getDatabase();
  const env = serverEnv();
  const [shift, nearExpiryWarnDays, discountMaxPct] = await Promise.all([
    getOpenShift(db, user),
    getNearExpiryWarnDays(db.db),
    getDiscountMaxPct(db.db),
  ]);

  return (
    <PosScreen
      initialShift={
        shift
          ? { id: shift.id, openingFloatMinor: shift.openingFloatMinor, openedAt: shift.openedAt }
          : null
      }
      currency={env.APP_CURRENCY}
      timeZone={env.APP_TIMEZONE}
      today={todayIso(env.APP_TIMEZONE)}
      nearExpiryWarnDays={nearExpiryWarnDays}
      discountMaxPct={discountMaxPct}
    />
  );
}
