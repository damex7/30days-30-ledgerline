import "server-only";
import { db, isCheckViolation, isUniqueViolation, transaction } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/permissions";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { encodeCursor, PAGE_SIZE } from "@/lib/cursor";
import type { Ctx } from "@/lib/context";
import type { NewProductInput, ProductInput, StockAdjustmentInput } from "@/lib/validation/business";
import * as repo from "@/lib/repos/products";

export type { Product, StockMovement, StockLevel } from "@/lib/repos/products";

const SKU_TAKEN = new ValidationError("That SKU is already used by another product.", { sku: ["That SKU is already used."] });

export async function listProducts(
  ctx: Ctx,
  options: { q?: string; level?: "low" | "out"; after?: { name: string; id: string } | null; archived?: boolean },
) {
  assertCan(ctx, "product.view");
  const rows = await repo.listProducts(db, ctx.workspaceId, { ...options, limit: PAGE_SIZE + 1 });
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return { products: page, nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor([last.name.toLowerCase(), last.id]) : null };
}

export async function getProduct(ctx: Ctx, id: string) {
  assertCan(ctx, "product.view");
  const product = await repo.findProduct(db, ctx.workspaceId, id);
  if (!product) throw new NotFoundError("Product");
  return product;
}

export async function searchProducts(ctx: Ctx, query: string, limit = 8) {
  assertCan(ctx, "product.view");
  return repo.searchProducts(db, ctx.workspaceId, query.slice(0, 80), Math.min(limit, 20));
}

export async function productOptions(ctx: Ctx) {
  assertCan(ctx, "product.view");
  return repo.listProducts(db, ctx.workspaceId, { limit: 500 });
}

export async function getStockLedger(ctx: Ctx, productId: string, after: { at: string; id: string } | null) {
  await getProduct(ctx, productId);
  const rows = await repo.listMovements(db, ctx.workspaceId, productId, { after, limit: PAGE_SIZE + 1 });
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return { movements: page, nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor([last.createdAt.toISOString(), last.id]) : null };
}

/** New products start at 0; opening stock is recorded as the first restock. */
export async function createProduct(ctx: Ctx, input: NewProductInput): Promise<string> {
  assertCan(ctx, "product.manage");
  try {
    return await transaction(async (tx) => {
      const id = await repo.insertProduct(tx, ctx.workspaceId, ctx.userId, input);
      if (input.openingStock > 0) {
        await repo.insertMovement(tx, {
          workspaceId: ctx.workspaceId,
          productId: id,
          quantityDelta: input.openingStock,
          reason: "restock",
          invoiceId: null,
          note: "Opening stock",
          userId: ctx.userId,
        });
      }
      await audit(tx, ctx, "product.create", "product", id, { openingStock: input.openingStock });
      return id;
    });
  } catch (error) {
    if (isUniqueViolation(error, "products_sku_per_workspace")) throw SKU_TAKEN;
    throw error;
  }
}

export async function updateProduct(ctx: Ctx, id: string, input: ProductInput): Promise<void> {
  assertCan(ctx, "product.manage");
  await getProduct(ctx, id);
  try {
    await transaction(async (tx) => {
      await repo.updateProductRow(tx, ctx.workspaceId, id, input);
      await audit(tx, ctx, "product.update", "product", id);
    });
  } catch (error) {
    if (isUniqueViolation(error, "products_sku_per_workspace")) throw SKU_TAKEN;
    throw error;
  }
}

export async function archiveProduct(ctx: Ctx, id: string, archived: boolean): Promise<void> {
  assertCan(ctx, "product.manage");
  await getProduct(ctx, id);
  await transaction(async (tx) => {
    await repo.setProductArchived(tx, ctx.workspaceId, id, archived);
    await audit(tx, ctx, archived ? "product.archive" : "product.restore", "product", id);
  });
}

/** Restock or correct a count. Can't take stock below zero (the CHECK says no). */
export async function adjustStock(ctx: Ctx, productId: string, input: StockAdjustmentInput): Promise<void> {
  assertCan(ctx, "stock.adjust");
  const product = await getProduct(ctx, productId);
  try {
    await transaction(async (tx) => {
      await repo.insertMovement(tx, {
        workspaceId: ctx.workspaceId,
        productId,
        quantityDelta: input.quantityDelta,
        reason: input.reason,
        invoiceId: null,
        note: input.note,
        userId: ctx.userId,
      });
      await audit(tx, ctx, "stock.adjust", "product", productId, { delta: input.quantityDelta, reason: input.reason });
    });
  } catch (error) {
    if (isCheckViolation(error, "products_stock_not_negative")) {
      throw new ValidationError(`That would take ${product.name} below zero (${product.stockQuantity} in stock).`, {
        quantityDelta: [`Only ${product.stockQuantity} in stock.`],
      });
    }
    throw error;
  }
}
