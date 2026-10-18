import { asc, eq } from "drizzle-orm";
import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { suppliers } from "@/db/schema/purchasing";
import { requireUser } from "@/lib/authz";
import { getMinShelfLifeDays } from "@/lib/settings";
import { can } from "@/lib/permissions";

import { ReceiveForm } from "./receive-form";

export const metadata: Metadata = {
  title: "Receiving",
};

export default async function ReceivingPage() {
  const user = await requireUser();
  const db = getDb();

  if (!can(user.role, "inventory.receive")) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Restricted</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Your role ({user.role}) cannot receive stock.
        </CardContent>
      </Card>
    );
  }

  const [supplierRows, minDays] = await Promise.all([
    db
      .select({ id: suppliers.id, name: suppliers.name })
      .from(suppliers)
      .where(eq(suppliers.active, true))
      .orderBy(asc(suppliers.name)),
    getMinShelfLifeDays(db),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Receiving</h1>
        <p className="text-muted-foreground text-sm">
          Ad-hoc stock receipt (spec §6.3). Expiry dates must be at least {minDays} days out.
          Receiving an existing batch tops it up.
        </p>
      </div>
      <ReceiveForm suppliers={supplierRows} />
    </div>
  );
}
