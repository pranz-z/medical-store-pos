import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/authz";
import { can } from "@/lib/permissions";
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from "@/lib/product-import";

import { ImportForm } from "./import-form";

export const metadata: Metadata = {
  title: "Import products",
};

export default async function ImportProductsPage() {
  const user = await requireUser();

  if (!can(user.role, "catalog.import")) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Restricted</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Bulk import is limited to owners and managers.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Import products</h1>
        <p className="text-muted-foreground text-sm">
          Upload a CSV, preview per-row validation, then commit everything in one transaction. Max{" "}
          {IMPORT_MAX_ROWS} rows / {IMPORT_MAX_BYTES / 1024} KB.
        </p>
      </div>
      <ImportForm />
    </div>
  );
}
