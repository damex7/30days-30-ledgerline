import "server-only";
import { int, intOrNull, toDate, toDateOrNull, type Db, type Param } from "@/lib/db";
import { likeEscape } from "@/lib/repos/customers";
import type { ProductInput } from "@/lib/validation/business";

export type StockLevel = "ok" | "low" | "out";

export interface Product {
  id: string;
  sku: string;
  name: string;
  unit: string;
  priceKobo: number;
  costKobo: number;
  stockQuantity: number;
  lowStockLevel: number | null;
  /** The level actually used: the product's own, or the workspace default. */
  effectiveLowStock: number;
  level: StockLevel;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface StockMovement {
  id: string;
  quantityDelta: number;
  reason: "sale" | "restock" | "adjustment" | "return";
  invoiceId: string | null;
  invoiceNumber: number | null;
  note: string | null;
  createdByName: string | null;
  createdAt: Date;
}

type Row = Record<string, unknown>;

const COLUMNS = `p.id, p.sku, p.name, p.unit, p.price_kobo, p.cost_kobo, p.stock_quantity, p.low_stock_level,
  COALESCE(p.low_stock_level, w.low_stock_default) AS effective_low, p.archived_at, p.created_at`;
const FROM = "products p JOIN workspaces w ON w.id = p.workspace_id";

/** Same rule in SQL and here: 0 = out; at or under the level = low. */
export const LOW_STOCK_SQL = "p.stock_quantity <= COALESCE(p.low_stock_level, w.low_stock_default)";

export function stockLevel(quantity: number, lowLevel: number): StockLevel {
  if (quantity <= 0) return "out";
  return quantity <= lowLevel ? "low" : "ok";
}

export function mapProduct(r: Row): Product {
  const stockQuantity = int(r.stock_quantity);
  const effectiveLowStock = int(r.effective_low);
  return {
    id: String(r.id),
    sku: String(r.sku),
    name: String(r.name),
    unit: String(r.unit),
    priceKobo: int(r.price_kobo),
    costKobo: int(r.cost_kobo),
    stockQuantity,
    lowStockLevel: intOrNull(r.low_stock_level),
    effectiveLowStock,
    level: stockLevel(stockQuantity, effectiveLowStock),
    archivedAt: toDateOrNull(r.archived_at),
    createdAt: toDate(r.created_at),
  };
}

export async function findProduct(db: Db, workspaceId: string, id: string): Promise<Product | null> {
  const rows = await db.query<Row>(`SELECT ${COLUMNS} FROM ${FROM} WHERE p.workspace_id = $1 AND p.id = $2`, [workspaceId, id]);
  return rows[0] ? mapProduct(rows[0]) : null;
}

export async function findProducts(db: Db, workspaceId: string, ids: string[]): Promise<Product[]> {
  if (ids.length === 0) return [];
  const rows = await db.query<Row>(`SELECT ${COLUMNS} FROM ${FROM} WHERE p.workspace_id = $1 AND p.id = ANY($2::uuid[])`, [
    workspaceId,
    ids,
  ]);
  return rows.map(mapProduct);
}

export async function listProducts(
  db: Db,
  workspaceId: string,
  options: { q?: string | undefined; level?: "low" | "out" | undefined; after?: { name: string; id: string } | null; limit: number; archived?: boolean },
): Promise<Product[]> {
  const params: Param[] = [workspaceId];
  const where = ["p.workspace_id = $1", options.archived ? "p.archived_at IS NOT NULL" : "p.archived_at IS NULL"];
  if (options.q) {
    params.push(`%${likeEscape(options.q.toLowerCase())}%`, options.q.toLowerCase());
    where.push(`(lower(p.name) LIKE $${params.length - 1} OR lower(p.sku) LIKE $${params.length - 1} OR lower(p.name) % $${params.length})`);
  }
  if (options.level === "out") where.push("p.stock_quantity = 0");
  if (options.level === "low") where.push(`${LOW_STOCK_SQL}`);
  if (options.after) {
    params.push(options.after.name, options.after.id);
    where.push(`(lower(p.name), p.id) > ($${params.length - 1}, $${params.length}::uuid)`);
  }
  params.push(options.limit);
  const rows = await db.query<Row>(
    `SELECT ${COLUMNS} FROM ${FROM} WHERE ${where.join(" AND ")} ORDER BY lower(p.name), p.id LIMIT $${params.length}`,
    params,
  );
  return rows.map(mapProduct);
}

export async function searchProducts(db: Db, workspaceId: string, query: string, limit: number): Promise<(Product & { score: number })[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rows = await db.query<Row>(
    `SELECT ${COLUMNS}, GREATEST(similarity(lower(p.name), $2), word_similarity($2, lower(p.name))) AS score
       FROM ${FROM}
      WHERE p.workspace_id = $1 AND p.archived_at IS NULL
        AND (lower(p.name) % $2 OR lower(p.name) LIKE $3 OR lower(p.sku) = $2 OR word_similarity($2, lower(p.name)) > 0.45)
      ORDER BY (lower(p.sku) = $2) DESC, score DESC, lower(p.name)
      LIMIT $4`,
    [workspaceId, q, `%${likeEscape(q)}%`, limit],
  );
  return rows.map((r) => ({ ...mapProduct(r), score: Number(r.score) }));
}

export async function insertProduct(db: Db, workspaceId: string, userId: string, input: ProductInput): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `INSERT INTO products (workspace_id, sku, name, unit, price_kobo, cost_kobo, low_stock_level, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [workspaceId, input.sku, input.name, input.unit, input.price, input.cost, input.lowStockLevel, userId],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error("product insert returned nothing");
  return id;
}

export async function updateProductRow(db: Db, workspaceId: string, id: string, input: ProductInput): Promise<void> {
  await db.query(
    `UPDATE products SET sku = $3, name = $4, unit = $5, price_kobo = $6, cost_kobo = $7, low_stock_level = $8
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, input.sku, input.name, input.unit, input.price, input.cost, input.lowStockLevel],
  );
}

export async function setProductArchived(db: Db, workspaceId: string, id: string, archived: boolean): Promise<void> {
  await db.query(`UPDATE products SET archived_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE workspace_id = $1 AND id = $2`, [
    workspaceId,
    id,
    archived,
  ]);
}

/**
 * The only way stock changes. The AFTER INSERT trigger applies the delta to
 * products.stock_quantity under a row lock, and the CHECK refuses a negative
 * result, failing this statement (see 002_business.sql).
 */
export async function insertMovement(
  db: Db,
  m: {
    workspaceId: string;
    productId: string;
    quantityDelta: number;
    reason: StockMovement["reason"];
    invoiceId: string | null;
    note: string | null;
    userId: string | null;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO stock_movements (workspace_id, product_id, quantity_delta, reason, invoice_id, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [m.workspaceId, m.productId, m.quantityDelta, m.reason, m.invoiceId, m.note, m.userId],
  );
}

export async function listMovements(
  db: Db,
  workspaceId: string,
  productId: string,
  options: { after?: { at: string; id: string } | null; limit: number },
): Promise<StockMovement[]> {
  const params: Param[] = [workspaceId, productId];
  let seek = "";
  if (options.after) {
    params.push(options.after.at, options.after.id);
    seek = `AND (m.created_at, m.id) < ($3::timestamptz, $4::uuid)`;
  }
  params.push(options.limit);
  const rows = await db.query<Row>(
    `SELECT m.id, m.quantity_delta, m.reason, m.invoice_id, i.number AS invoice_number, m.note, u.name AS created_by_name, m.created_at
       FROM stock_movements m
       LEFT JOIN invoices i ON i.id = m.invoice_id AND i.workspace_id = m.workspace_id
       LEFT JOIN users u ON u.id = m.created_by
      WHERE m.workspace_id = $1 AND m.product_id = $2 ${seek}
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({
    id: String(r.id),
    quantityDelta: int(r.quantity_delta),
    reason: r.reason as StockMovement["reason"],
    invoiceId: (r.invoice_id as string | null) ?? null,
    invoiceNumber: intOrNull(r.invoice_number),
    note: (r.note as string | null) ?? null,
    createdByName: (r.created_by_name as string | null) ?? null,
    createdAt: toDate(r.created_at),
  }));
}
