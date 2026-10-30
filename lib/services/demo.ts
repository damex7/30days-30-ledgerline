import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { byteaParam } from "@/lib/crypto";
import { createSession } from "@/lib/auth/session";
import { contextFor } from "@/lib/context";
import { addDays, todayInLagos } from "@/lib/dates";
import { enforce } from "@/lib/rate-limit";
import { createCustomer } from "@/lib/services/customers";
import { createProduct } from "@/lib/services/products";
import { createInvoice } from "@/lib/services/invoices";
import { recordPayment } from "@/lib/services/payments";
import { createExpense } from "@/lib/services/expenses";
import { updateWorkspaceDetails } from "@/lib/services/workspaces";

// "Try the demo": a private sandbox per visitor. Each click makes an isolated
// demo user (random, unusable password) and a small demo workspace, through
// the normal services. Limited per IP, and deleted by the daily job after
// 24 hours, so visitors never see or touch anyone else's data.

const CUSTOMERS = ["Mama Chidi", "Alhaji Sule Abdullahi", "Iya Bisi Foods", "Kemi Adeyemi", "Chief Emeka Okonkwo", "Blessing Eze"];
const PRODUCTS = [
  { sku: "RICE-50KG", name: "Rice, 50kg bag", unit: "bag", price: 82000, cost: 74000, stock: 14 },
  { sku: "INDOMIE-CTN", name: "Indomie noodles, carton", unit: "carton", price: 9800, cost: 8600, stock: 40 },
  { sku: "OIL-5L", name: "Kings vegetable oil, 5 litres", unit: "keg", price: 11800, cost: 10400, stock: 6 },
  { sku: "SUGAR-50KG", name: "Dangote sugar, 50kg", unit: "bag", price: 76000, cost: 69500, stock: 3 },
  { sku: "MILO-500", name: "Milo refill, 500g", unit: "pack", price: 3900, cost: 3300, stock: 30 },
  { sku: "MAGGI-PACK", name: "Maggi cubes, big pack", unit: "pack", price: 2400, cost: 1950, stock: 50 },
];

export async function startDemo(ip: string): Promise<{ token: string }> {
  await enforce({ key: `demo:ip:${ip}`, max: 3, windowSeconds: 3_600 }, "Too many demo sandboxes from this network.");
  await enforce({ key: "demo:global", max: 200, windowSeconds: 86_400 }, "The demo is very busy today.");

  const { hash, salt } = await hashPassword(randomBytes(24).toString("base64url"));
  const suffix = randomBytes(5).toString("hex");
  const user = await db.query<{ id: string }>(
    "INSERT INTO users (email, name, password_hash, password_salt, is_demo) VALUES ($1, 'Demo Owner', $2, $3, true) RETURNING id",
    [`demo-${suffix}@demo.invalid`, byteaParam(hash), byteaParam(salt)],
  );
  const userId = user[0]!.id;
  const ws = await db.query<{ id: string }>("INSERT INTO workspaces (name, is_demo) VALUES ('Demo Provisions Store', true) RETURNING id");
  const workspaceId = ws[0]!.id;
  await db.query("INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [workspaceId, userId]);
  const ctx = await contextFor(userId, workspaceId);
  await updateWorkspaceDetails(ctx, {
    name: "Demo Provisions Store",
    businessAddress: "12 Demo Street, Lagos",
    businessPhone: "0800 000 0000",
    businessEmail: null,
    bankDetails: "Demo Bank 0000000000",
    invoicePrefix: "DEMO",
    lowStockDefault: 5,
  });

  const customerIds: string[] = [];
  for (const name of CUSTOMERS) customerIds.push(await createCustomer(ctx, { name, phone: null, whatsapp: null, email: null, notes: null, tags: [] }));
  const productIds: string[] = [];
  for (const p of PRODUCTS) {
    productIds.push(
      await createProduct(ctx, { sku: p.sku, name: p.name, unit: p.unit, price: p.price * 100, cost: p.cost * 100, lowStockLevel: null, openingStock: p.stock }),
    );
  }

  const today = todayInLagos();
  const plan: [age: number, customer: number, lines: [number, number][], pay: "none" | "part" | "full"][] = [
    [40, 0, [[0, 2], [1, 3]], "full"],
    [30, 1, [[0, 3]], "part"],
    [21, 2, [[4, 5], [5, 10]], "none"],
    [12, 3, [[1, 2], [2, 1]], "full"],
    [6, 4, [[0, 1]], "part"],
    [2, 5, [[4, 3]], "none"],
    [0, 0, [[1, 1]], "none"],
  ];
  for (const [age, c, lines, pay] of plan) {
    const issue = addDays(today, -age);
    const { id } = await createInvoice(ctx, {
      customerId: customerIds[c]!,
      issueDate: issue,
      dueDate: addDays(issue, 14),
      items: lines.map(([p, quantity]) => ({ productId: productIds[p]!, quantity })),
      discount: 0,
      deliveryFee: age % 2 === 0 ? 200_000 : 0,
      notes: null,
      clientRequestId: randomUUID(),
      send: age !== 0,
    });
    if (pay === "none" || age === 0) continue;
    const total = Number((await db.query<{ t: string }>("SELECT total_kobo AS t FROM invoices WHERE id = $1", [id]))[0]!.t);
    await recordPayment(ctx, {
      invoiceId: id,
      amount: pay === "full" ? total : Math.round(total / 200) * 100,
      method: "transfer",
      paidOn: addDays(issue, 2),
      note: null,
      clientRequestId: randomUUID(),
    });
  }
  for (const [category, naira, age] of [["rent", 150000, 20], ["transport", 12000, 9], ["utilities", 18000, 3]] as const) {
    await createExpense(ctx, { category, amount: naira * 100, spentOn: addDays(today, -age), note: null, receiptRef: null, clientRequestId: randomUUID() });
  }
  return { token: await createSession(userId, workspaceId) };
}
