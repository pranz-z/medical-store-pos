"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";

import { getDatabase } from "@/db/client";
import {
  addBarcode,
  addProductUnit,
  createCategory,
  createProduct,
  removeBarcode,
  setDefaultSaleUnit,
  setProductActive,
  setProductPrice,
  updateProduct,
  type AddBarcodeInput,
  type AddUnitInput,
  type CreateProductInput,
  type SetPriceInput,
  type UpdateProductInput,
} from "@/lib/catalog-mutations";
import { requireUser } from "@/lib/authz";
import { DomainError } from "@/lib/errors";

/**
 * Catalog server actions — thin wrappers over `src/lib/catalog-mutations.ts`.
 * The mutation functions re-validate with Zod and enforce capabilities
 * against the session actor, so these wrappers only map expected failures
 * (`DomainError`, validation) onto the shared result shape.
 */

export type ActionResult =
  | { status: "ok"; id?: string }
  | { status: "step-up-required" }
  | { status: "error"; message: string };

function toResult(error: unknown): ActionResult {
  if (error instanceof DomainError) return { status: "error", message: error.message };
  if (error instanceof ZodError) {
    return { status: "error", message: error.issues[0]?.message ?? "Invalid input." };
  }
  throw error;
}

function refresh(productId?: string) {
  revalidatePath("/products");
  if (productId) revalidatePath(`/products/${productId}`);
}

export async function createProductAction(input: CreateProductInput): Promise<ActionResult> {
  const actor = await requireUser();
  try {
    const { productId } = await createProduct(getDatabase(), actor, input);
    refresh();
    return { status: "ok", id: productId };
  } catch (error) {
    return toResult(error);
  }
}

export async function updateProductAction(input: UpdateProductInput): Promise<ActionResult> {
  const actor = await requireUser();
  try {
    await updateProduct(getDatabase(), actor, input);
    refresh(input.productId);
    return { status: "ok", id: input.productId };
  } catch (error) {
    return toResult(error);
  }
}

export async function setProductActiveAction(input: {
  productId: string;
  active: boolean;
}): Promise<ActionResult> {
  const actor = await requireUser();
  try {
    await setProductActive(getDatabase(), actor, input);
    refresh(input.productId);
    return { status: "ok", id: input.productId };
  } catch (error) {
    return toResult(error);
  }
}

export async function setProductPriceAction(input: SetPriceInput): Promise<ActionResult> {
  const actor = await requireUser();
  try {
    await setProductPrice(getDatabase(), actor, input);
    refresh(input.productId);
    return { status: "ok", id: input.productId };
  } catch (error) {
    return toResult(error);
  }
}

export async function addProductUnitAction(input: AddUnitInput): Promise<ActionResult> {
  const actor = await requireUser();
  try {
    await addProductUnit(getDatabase(), actor, input);
    refresh(input.productId);
    return { status: "ok", id: input.productId };
  } catch (error) {
    return toResult(error);
  }
}

export async function setDefaultUnitAction(input: {
  productId: string;
  unitId: string;
}): Promise<ActionResult> {
  const actor = await requireUser();
  try {
    await setDefaultSaleUnit(getDatabase(), actor, input);
    refresh(input.productId);
    return { status: "ok" };
  } catch (error) {
    return toResult(error);
  }
}

export async function addBarcodeAction(input: AddBarcodeInput): Promise<ActionResult> {
  const actor = await requireUser();
  try {
    await addBarcode(getDatabase(), actor, input);
    refresh(input.productId);
    return { status: "ok" };
  } catch (error) {
    return toResult(error);
  }
}

export async function removeBarcodeAction(input: {
  barcodeId: string;
  productId: string;
}): Promise<ActionResult> {
  const actor = await requireUser();
  try {
    await removeBarcode(getDatabase(), actor, { barcodeId: input.barcodeId });
    refresh(input.productId);
    return { status: "ok" };
  } catch (error) {
    return toResult(error);
  }
}

export async function createCategoryAction(input: { name: string }): Promise<ActionResult> {
  const actor = await requireUser();
  try {
    const { categoryId } = await createCategory(getDatabase(), actor, input);
    refresh();
    return { status: "ok", id: categoryId };
  } catch (error) {
    return toResult(error);
  }
}
