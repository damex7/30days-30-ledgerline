"use server";

import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { newProductSchema, productSchema, stockAdjustmentSchema } from "@/lib/validation/business";
import { uuid } from "@/lib/validation/common";
import { adjustStock, archiveProduct, createProduct, updateProduct } from "@/lib/services/products";
import { actionError } from "@/lib/action-errors";
import { formValues, zodErrorState, type FormState } from "@/lib/forms";

export async function createProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const parsed = newProductSchema.safeParse(values);
  if (!parsed.success) return zodErrorState(parsed.error, values);
  let id: string;
  try {
    id = await createProduct(ctx, parsed.data);
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/app/products/${id}?notice=saved`);
}

export async function updateProductAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const id = uuid.safeParse(values.id);
  const parsed = productSchema.safeParse(values);
  if (!parsed.success) return zodErrorState(parsed.error, values);
  if (!id.success) return { status: "error", message: "Missing product.", fieldErrors: {}, values };
  try {
    await updateProduct(ctx, id.data, parsed.data);
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/app/products/${id.data}?notice=saved`);
}

export async function adjustStockAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getContext();
  const values = formValues(formData);
  const id = uuid.safeParse(values.productId);
  const parsed = stockAdjustmentSchema.safeParse(values);
  if (!parsed.success) return zodErrorState(parsed.error, values);
  if (!id.success) return { status: "error", message: "Missing product.", fieldErrors: {}, values };
  try {
    await adjustStock(ctx, id.data, parsed.data);
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/app/products/${id.data}?notice=stock`);
}

export async function archiveProductAction(formData: FormData): Promise<void> {
  const ctx = await getContext();
  const id = uuid.parse(formData.get("id"));
  const archived = formData.get("archived") === "true";
  await archiveProduct(ctx, id, archived);
  redirect(`/app/products/${id}?notice=${archived ? "archived" : "restored"}`);
}
