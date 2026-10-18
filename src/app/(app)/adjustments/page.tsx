import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/authz";
import { getAdjustmentStepUpThresholds } from "@/lib/settings";
import { formatMinor } from "@/lib/money";
import { can } from "@/lib/permissions";
import { serverEnv } from "@/lib/env";

import { AdjustForm } from "./adjust-form";

export const metadata: Metadata = {
  title: "Stock adjustments",
};

export default async function AdjustmentsPage() {
  const user = await requireUser();
  const db = getDb();

  if (!can(user.role, "inventory.adjust")) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Restricted</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Your role ({user.role}) cannot record stock adjustments.
        </CardContent>
      </Card>
    );
  }

  const thresholds = await getAdjustmentStepUpThresholds(db);
  const currency = serverEnv().APP_CURRENCY;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Stock adjustment</h1>
        <p className="text-muted-foreground text-sm">
          Reason-coded write-offs and corrections (spec §3.3). Adjustments of{" "}
          {thresholds.qtyBase.toLocaleString("en-PH")}+ base units or{" "}
          {formatMinor(thresholds.valueMinor, currency)}+ at cost require your PIN.
        </p>
      </div>
      <AdjustForm />
    </div>
  );
}
