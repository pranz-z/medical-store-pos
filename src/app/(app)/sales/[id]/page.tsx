import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { getDatabase } from "@/db/client";
import { requireUser } from "@/lib/authz";
import { DomainError } from "@/lib/errors";
import { serverEnv } from "@/lib/env";
import { can } from "@/lib/permissions";
import { getReceipt } from "@/lib/sales-queries";

import { ReprintButton } from "./reprint-button";
import { ReceiptView } from "../../pos/receipt-view";

/** Receipt detail + reprint (spec §6.1.8: reprints marked "REPRINT", audited). */
export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!can(user.role, "sales.view")) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">Your role cannot view sales.</p>
        </CardContent>
      </Card>
    );
  }
  const env = serverEnv();
  let receipt;
  try {
    receipt = await getReceipt(getDatabase(), user, id);
  } catch (error) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="pt-6">
          <p className="text-muted-foreground text-sm">
            {error instanceof DomainError ? error.message : "Sale not found."}
          </p>
          <Link href="/sales" className="mt-2 block text-xs underline">
            Back to sales history
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-3">
      <div className="flex items-center justify-between">
        <Link href="/sales" className="text-muted-foreground text-sm underline">
          ← Sales history
        </Link>
        <ReprintButton
          saleId={receipt.saleId}
          currency={env.APP_CURRENCY}
          timeZone={env.APP_TIMEZONE}
        />
      </div>
      <Card>
        <CardContent className="pt-4">
          <ReceiptView receipt={receipt} currency={env.APP_CURRENCY} timeZone={env.APP_TIMEZONE} />
        </CardContent>
      </Card>
    </div>
  );
}
