import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { categories, taxClasses } from "@/db/schema/catalog";
import { requireRole } from "@/lib/authz";

import { ProductForm } from "../_components/product-form";

export const metadata: Metadata = {
  title: "New product",
};

export default async function NewProductPage() {
  await requireRole("owner", "manager");

  const db = getDb();
  const [categoryRows, taxRows] = await Promise.all([
    db.select({ id: categories.id, name: categories.name }).from(categories),
    db
      .select({ id: taxClasses.id, name: taxClasses.name, rateBp: taxClasses.rateBp })
      .from(taxClasses),
  ]);

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>New product</CardTitle>
      </CardHeader>
      <CardContent>
        <ProductForm
          mode="create"
          categories={categoryRows}
          taxClasses={taxRows}
          initial={{
            sku: "",
            name: "",
            genericName: "",
            strength: "",
            form: "",
            manufacturer: "",
            categoryId: "",
            baseUnit: "",
            taxClassId: "",
            requiresRx: false,
            controlledSchedule: "",
            coldChain: false,
            sellableLoose: true,
            storageNotes: "",
            reorderLevel: 0,
            price: "",
            barcode: "",
          }}
        />
      </CardContent>
    </Card>
  );
}
