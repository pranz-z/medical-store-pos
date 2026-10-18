"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseMinor } from "@/lib/money";

import {
  createCategoryAction,
  createProductAction,
  updateProductAction,
  type ActionResult,
} from "../actions";

export interface CategoryOption {
  id: string;
  name: string;
}
export interface TaxClassOption {
  id: string;
  name: string;
  rateBp: number;
}

export interface ProductFormValues {
  sku: string;
  name: string;
  genericName: string;
  strength: string;
  form: string;
  manufacturer: string;
  categoryId: string;
  baseUnit: string;
  taxClassId: string;
  requiresRx: boolean;
  controlledSchedule: string;
  coldChain: boolean;
  sellableLoose: boolean;
  storageNotes: string;
  reorderLevel: number;
  price?: string;
  barcode?: string;
}

const CONTROLLED_SUGGESTIONS = ["PH Rx-Yellow", "DDB-Dangerous"];

/** Shared create/edit form (spec §3.2). Edit mode omits the create-only price/barcode shortcuts. */
export function ProductForm({
  mode,
  productId,
  initial,
  categories,
  taxClasses,
}: {
  mode: "create" | "edit";
  productId?: string;
  initial: ProductFormValues;
  categories: CategoryOption[];
  taxClasses: TaxClassOption[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<ProductFormValues>(initial);
  const [categoryOptions, setCategoryOptions] = useState(categories);
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  function buildFields() {
    return {
      sku: values.sku,
      name: values.name,
      genericName: values.genericName || null,
      strength: values.strength || null,
      form: values.form || null,
      manufacturer: values.manufacturer || null,
      categoryId: values.categoryId || null,
      baseUnit: values.baseUnit,
      taxClassId: values.taxClassId || null,
      requiresRx: values.requiresRx,
      controlledSchedule: values.controlledSchedule || null,
      coldChain: values.coldChain,
      sellableLoose: values.sellableLoose,
      storageNotes: values.storageNotes || null,
      reorderLevel: values.reorderLevel,
    };
  }

  function submit() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      let result: ActionResult;
      if (mode === "create") {
        const priceMinor =
          values.price !== undefined && values.price.trim() !== ""
            ? parseMinor(values.price)
            : undefined;
        if (values.price !== undefined && values.price.trim() !== "" && priceMinor === null) {
          setError("Price must be a valid amount like 125.50.");
          return;
        }
        result = await createProductAction({
          ...buildFields(),
          ...(priceMinor !== null && priceMinor !== undefined ? { priceMinor } : {}),
          ...(values.barcode ? { barcode: values.barcode } : {}),
        });
        if (result.status === "ok" && result.id) {
          router.push(`/products/${result.id}`);
          return;
        }
      } else {
        result = await updateProductAction({ productId: productId!, fields: buildFields() });
        if (result.status === "ok") {
          setNotice("Saved.");
          router.refresh();
        }
      }
      if (result.status === "error") setError(result.message);
    });
  }

  function addCategory() {
    startTransition(async () => {
      const result = await createCategoryAction({ name: newCategory });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      if (result.status === "ok" && result.id) {
        const name = newCategory.trim();
        const newId = result.id;
        setCategoryOptions((previous) =>
          previous.some((option) => option.id === newId)
            ? previous
            : [...previous, { id: newId, name }].sort((a, b) => a.name.localeCompare(b.name)),
        );
        set("categoryId", newId);
        setNewCategory("");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SKU" required>
          <Input value={values.sku} onChange={(e) => set("sku", e.target.value)} />
        </Field>
        <Field label="Name" required>
          <Input value={values.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Generic name">
          <Input value={values.genericName} onChange={(e) => set("genericName", e.target.value)} />
        </Field>
        <Field label="Strength">
          <Input
            value={values.strength}
            placeholder="500 mg"
            onChange={(e) => set("strength", e.target.value)}
          />
        </Field>
        <Field label="Dosage form">
          <Input
            value={values.form}
            placeholder="tablet, capsule, syrup…"
            onChange={(e) => set("form", e.target.value)}
          />
        </Field>
        <Field label="Manufacturer">
          <Input
            value={values.manufacturer}
            onChange={(e) => set("manufacturer", e.target.value)}
          />
        </Field>
        <Field label="Category">
          <div className="flex gap-2">
            <select
              className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              value={values.categoryId}
              onChange={(e) => set("categoryId", e.target.value)}
            >
              <option value="">Uncategorized</option>
              {categoryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-1 flex gap-2">
            <Input
              value={newCategory}
              placeholder="New category…"
              className="h-8 text-xs"
              onChange={(e) => setNewCategory(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || newCategory.trim().length === 0}
              onClick={addCategory}
            >
              Add
            </Button>
          </div>
        </Field>
        <Field label="Tax class">
          <select
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
            value={values.taxClassId}
            onChange={(e) => set("taxClassId", e.target.value)}
          >
            <option value="">None</option>
            {taxClasses.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name} ({(option.rateBp / 100).toFixed(2)}%)
              </option>
            ))}
          </select>
        </Field>
        <Field label="Base unit" required>
          <Input
            value={values.baseUnit}
            placeholder="tablet, ml, sachet…"
            onChange={(e) => set("baseUnit", e.target.value)}
          />
        </Field>
        <Field label="Reorder level (base units)">
          <Input
            type="number"
            min={0}
            value={values.reorderLevel}
            onChange={(e) => set("reorderLevel", Number(e.target.value) || 0)}
          />
        </Field>
        <Field label="Controlled schedule">
          <Input
            value={values.controlledSchedule}
            list="controlled-schedules"
            placeholder="leave blank if not controlled"
            onChange={(e) => set("controlledSchedule", e.target.value)}
          />
          <datalist id="controlled-schedules">
            {CONTROLLED_SUGGESTIONS.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </Field>
        <Field label="Storage notes">
          <Input
            value={values.storageNotes}
            onChange={(e) => set("storageNotes", e.target.value)}
          />
        </Field>
        {mode === "create" ? (
          <>
            <Field label="Price (₱ per base unit)">
              <Input
                value={values.price ?? ""}
                inputMode="decimal"
                placeholder="2.50"
                onChange={(e) => set("price", e.target.value)}
              />
            </Field>
            <Field label="Barcode">
              <Input
                value={values.barcode ?? ""}
                onChange={(e) => set("barcode", e.target.value)}
              />
            </Field>
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-4">
        <Check checked={values.requiresRx} onChange={(v) => set("requiresRx", v)}>
          Requires prescription (Rx)
        </Check>
        <Check checked={values.coldChain} onChange={(v) => set("coldChain", v)}>
          Cold chain
        </Check>
        <Check checked={values.sellableLoose} onChange={(v) => set("sellableLoose", v)}>
          Sellable loose
        </Check>
      </div>

      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Create product" : "Save changes"}
        </Button>
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
    </div>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="accent-primary size-4"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {children}
    </label>
  );
}
