// Seeds two demo businesses with three months of history.
//
//   npm run db:seed
//
// Safe to run twice: seed users are upserted by email, and the two seed
// workspaces are deleted (cascading all their data) and rebuilt. Nothing else
// in the database is touched. All business data goes through the SAME
// services the app uses, so the seed obeys every rule and invariant, and a
// consistency check at the end proves it. The seed never calls the AI provider.

import { randomUUID } from "node:crypto";
import { closeDb, db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { byteaParam, randomToken, tokenHashParam } from "@/lib/crypto";
import { contextFor, type Ctx } from "@/lib/context";
import { addDays, todayInLagos } from "@/lib/dates";
import { ValidationError } from "@/lib/errors";
import { createCustomer } from "@/lib/services/customers";
import { adjustStock, createProduct, getProduct } from "@/lib/services/products";
import { createInvoice, voidInvoice } from "@/lib/services/invoices";
import { recordPayment, reversePayment } from "@/lib/services/payments";
import { createExpense } from "@/lib/services/expenses";
import { updateWorkspaceDetails } from "@/lib/services/workspaces";
import type { ExpenseCategory, InvoiceInput } from "@/lib/validation/business";
import { ABUJA, EXPENSES_ABUJA, EXPENSES_LAGOS, LAGOS, type SeedCustomer, type SeedProduct } from "./seed-data.mts";
import { seedAi } from "./seed-ai.mts";
import { verifyInvariants } from "./invariants.mts";

const password = process.env.SEED_PASSWORD;
if (!password || password.length < 10) {
  console.error("Set SEED_PASSWORD (at least 10 characters) in .env.local first.");
  process.exit(1);
}

// Seeded randomness: every run produces the same kind of data.
let state = 30_2026;
function rand(): number {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

export const SEED_USERS = {
  owner: { email: "ngozi.owner@example.com", name: "Ngozi Okafor" },
  manager: { email: "tunde.manager@example.com", name: "Tunde Bakare" },
  staff: { email: "aisha.staff@example.com", name: "Aisha Bello" },
  abujaOwner: { email: "hauwa.owner@example.com", name: "Hauwa Musa" },
} as const;

async function upsertUser(email: string, name: string): Promise<string> {
  const { hash, salt } = await hashPassword(password!);
  const rows = await db.query<{ id: string }>(
    `INSERT INTO users (email, name, password_hash, password_salt) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, password_salt = EXCLUDED.password_salt
     RETURNING id`,
    [email, name, byteaParam(hash), byteaParam(salt)],
  );
  return rows[0]!.id;
}

async function createWorkspaceFor(ownerId: string, name: string): Promise<string> {
  const rows = await db.query<{ id: string }>("INSERT INTO workspaces (name) VALUES ($1) RETURNING id", [name]);
  const id = rows[0]!.id;
  await db.query("INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [id, ownerId]);
  return id;
}

async function addMember(workspaceId: string, userId: string, role: "manager" | "staff"): Promise<void> {
  await db.query("INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)", [workspaceId, userId, role]);
}

interface Built {
  workspaceId: string;
  customers: string[];
  products: { id: string; sku: string; priceKobo: number; opening: number }[];
}

async function buildCatalogue(owner: Ctx, customers: SeedCustomer[], products: SeedProduct[]): Promise<Omit<Built, "workspaceId">> {
  const customerIds = await Promise.all(
    customers.map((c) =>
      createCustomer(owner, { name: c.name, phone: c.phone ?? null, whatsapp: c.whatsapp ?? null, email: c.email ?? null, notes: c.notes ?? null, tags: c.tags ?? [] }),
    ),
  );
  const productRows: Built["products"] = [];
  for (const p of products) {
    const id = await createProduct(owner, {
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      price: p.price * 100,
      cost: p.cost * 100,
      lowStockLevel: p.low ?? null,
      openingStock: p.opening,
    });
    productRows.push({ id, sku: p.sku, priceKobo: p.price * 100, opening: p.opening });
  }
  return { customers: customerIds, products: productRows };
}

interface Tally {
  draft: number;
  sent: number;
  partly: number;
  paid: number;
  void: number;
  skipped: number;
  payments: number;
}

interface Plan {
  age: number;
  seller: Ctx;
  input: InvoiceInput;
  outcome: "draft" | "void" | "paid_once" | "paid_twice" | "partly" | "unpaid";
  voidReason: string;
  share: number;
  payDays: [number, number];
}

/**
 * Simulates ~90 days of trading through the real services. Every random
 * choice is made first (so the data is the same on every run), then each
 * fortnight's sales are executed six at a time, which is also a fair test of
 * the concurrency guarantees (gapless numbers, stock never below zero).
 */
async function simulate(
  built: Built,
  sellers: Ctx[],
  managerCtx: Ctx,
  options: { perDay: number; services?: { description: string; price: number }[] },
): Promise<{ tally: Tally; paidOnce: { invoiceId: string; paymentId: string }[] }> {
  const today = todayInLagos();
  const tally: Tally = { draft: 0, sent: 0, partly: 0, paid: 0, void: 0, skipped: 0, payments: 0 };
  const paidOnce: { invoiceId: string; paymentId: string }[] = [];

  const plans: Plan[] = [];
  for (let age = 90; age >= 0; age--) {
    const day = addDays(today, -age);
    const count = rand() < options.perDay % 1 ? Math.ceil(options.perDay) : Math.floor(options.perDay);
    for (let n = 0; n < count; n++) {
      const seller = pick(sellers);
      const items: InvoiceInput["items"] = [];
      const used = new Set<string>();
      for (let l = between(1, 3); l > 0; l--) {
        if (options.services && rand() < 0.55) {
          const sv = pick(options.services);
          items.push({ productId: null, description: sv.description, quantity: 1, unitPrice: String(sv.price) });
        } else {
          const p = pick(built.products);
          if (used.has(p.id)) continue;
          used.add(p.id);
          items.push({ productId: p.id, quantity: between(1, p.opening > 50 ? 6 : 2) });
        }
      }
      if (items.length === 0) continue;
      const roll = rand();
      const fate = rand();
      const paidShare = age > 20 ? 0.72 : age > 7 ? 0.45 : 0.25;
      const partlyShare = age > 20 ? 0.14 : 0.25;
      const draft = age < 4 && roll < 0.35;
      const outcome: Plan["outcome"] = draft
        ? "draft"
        : roll > 0.96
          ? "void"
          : fate < paidShare
            ? rand() < 0.3
              ? "paid_twice"
              : "paid_once"
            : fate < paidShare + partlyShare
              ? "partly"
              : "unpaid";
      plans.push({
        age,
        seller,
        outcome,
        voidReason: pick(["Customer cancelled", "Entered twice by mistake", "Wrong customer"]),
        share: pick([0.3, 0.5, 0.6]),
        payDays: [between(0, 5), between(4, 12)],
        input: {
          customerId: pick(built.customers),
          issueDate: day,
          dueDate: addDays(day, pick([7, 7, 14, 30])),
          items,
          discount: rand() < 0.15 ? 50_000 : 0,
          deliveryFee: rand() < 0.3 ? pick([150_000, 200_000, 250_000]) : 0,
          notes: null,
          clientRequestId: randomUUID(),
          send: !draft,
        },
      });
    }
  }

  const execute = async (plan: Plan) => {
    let invoiceId: string;
    try {
      invoiceId = (await createInvoice(plan.seller, plan.input)).id;
    } catch (error) {
      // Not enough stock for this sale: the whole transaction (and the
      // invoice number) rolled back, exactly as in the app. Skip it.
      if (error instanceof ValidationError) {
        tally.skipped++;
        return;
      }
      throw error;
    }
    const payOn = (offset: number) => addDays(plan.input.issueDate, Math.min(plan.age, offset));
    if (plan.outcome === "draft") tally.draft++;
    else if (plan.outcome === "void") {
      await voidInvoice(managerCtx, invoiceId, plan.voidReason);
      tally.void++;
    } else if (plan.outcome === "unpaid") tally.sent++;
    else {
      const total = await invoiceTotal(built.workspaceId, invoiceId);
      if (plan.outcome === "paid_twice") {
        const first = Math.round((total * 0.4) / 100) * 100;
        await pay(plan.seller, invoiceId, first, payOn(plan.payDays[0]));
        await pay(plan.seller, invoiceId, total - first, payOn(plan.payDays[1]));
        tally.payments += 2;
        tally.paid++;
      } else if (plan.outcome === "paid_once") {
        paidOnce.push({ invoiceId, paymentId: await pay(plan.seller, invoiceId, total, payOn(plan.payDays[0])) });
        tally.payments++;
        tally.paid++;
      } else {
        await pay(plan.seller, invoiceId, Math.max(100, Math.round((total * plan.share) / 100) * 100), payOn(plan.payDays[0]));
        tally.partly++;
        tally.payments++;
      }
    }
  };

  // Fortnight by fortnight: restock what ran low, then sell, 6 at a time.
  for (let blockStart = 90; blockStart >= 0; blockStart -= 14) {
    const low = await db.query<{ id: string; stock_quantity: string }>(
      "SELECT id, stock_quantity FROM products WHERE workspace_id = $1",
      [built.workspaceId],
    );
    for (const p of built.products) {
      const current = Number(low.find((r) => r.id === p.id)?.stock_quantity ?? 0);
      if (current < p.opening / 3) {
        await adjustStock(managerCtx, p.id, { reason: "restock", quantityDelta: p.opening - current, note: "Supplier delivery" });
      }
    }
    const block = plans.filter((pl) => pl.age <= blockStart && pl.age > blockStart - 14);
    for (let i = 0; i < block.length; i += 6) await Promise.all(block.slice(i, i + 6).map(execute));
  }
  return { tally, paidOnce };
}

/** Guarantees a draft and a void exist, whatever the dice said. */
async function ensureEveryStatus(built: Built, seller: Ctx, managerCtx: Ctx): Promise<void> {
  const today = todayInLagos();
  const line = (i: number) => [{ productId: built.products[i % built.products.length]!.id, quantity: 1 }];
  for (const [i, send] of [[0, false], [1, false]] as const) {
    await createInvoice(seller, { customerId: built.customers[i]!, issueDate: today, dueDate: addDays(today, 7), items: line(i), discount: 0, deliveryFee: 0, notes: "Waiting for the customer to confirm", clientRequestId: randomUUID(), send });
  }
  const v = await createInvoice(seller, { customerId: built.customers[2]!, issueDate: addDays(today, -5), dueDate: addDays(today, 2), items: line(2), discount: 0, deliveryFee: 0, notes: null, clientRequestId: randomUUID(), send: true });
  await voidInvoice(managerCtx, v.id, "Customer cancelled the order");
}

async function pay(ctx: Ctx, invoiceId: string, amount: number, paidOn: string): Promise<string> {
  const result = await recordPayment(ctx, {
    invoiceId,
    amount,
    method: pick(["transfer", "transfer", "cash", "pos"] as const),
    paidOn,
    note: null,
    clientRequestId: randomUUID(),
  });
  return result.id;
}

async function invoiceTotal(workspaceId: string, invoiceId: string): Promise<number> {
  const rows = await db.query<{ total_kobo: string }>("SELECT total_kobo FROM invoices WHERE workspace_id = $1 AND id = $2", [workspaceId, invoiceId]);
  return Number(rows[0]!.total_kobo);
}

async function seedExpenses(ctxs: Ctx[], list: [string, number, string][]): Promise<number> {
  const today = todayInLagos();
  let count = 0;
  for (let month = 2; month >= 0; month--) {
    for (const [category, naira, note] of list) {
      const monthly = category === "rent" || category === "salaries";
      if (!monthly && rand() < 0.35) continue;
      const day = addDays(today, -(month * 30 + between(monthly ? 0 : 0, monthly ? 2 : 27)));
      if (day > today) continue;
      await createExpense(pick(ctxs), {
        category: category as ExpenseCategory,
        amount: Math.round(naira * (monthly ? 1 : 0.8 + rand() * 0.4)) * 100,
        spentOn: day,
        note,
        receiptRef: rand() < 0.5 ? `Receipt ${between(100, 999)}` : null,
        clientRequestId: randomUUID(),
      });
      count++;
    }
  }
  return count;
}

/** Leaves a few products low and one out of stock, as a real shop would be. */
async function shapeStock(managerCtx: Ctx, built: Built, low: string[], out: string[]): Promise<void> {
  for (const sku of [...low, ...out]) {
    const p = built.products.find((x) => x.sku === sku);
    if (!p) continue;
    const current = await getProduct(managerCtx, p.id);
    const target = out.includes(sku) ? 0 : Math.max(1, Math.min(current.effectiveLowStock - 1, 2));
    const delta = target - current.stockQuantity;
    if (delta !== 0) {
      await adjustStock(managerCtx, p.id, {
        reason: delta > 0 ? "restock" : "adjustment",
        quantityDelta: delta,
        note: delta > 0 ? "Supplier delivery" : "Stock count correction",
      });
    }
  }
}

async function main() {
  const started = Date.now();
  console.log("Seeding Ledgerline…");
  const ownerId = await upsertUser(SEED_USERS.owner.email, SEED_USERS.owner.name);
  const managerId = await upsertUser(SEED_USERS.manager.email, SEED_USERS.manager.name);
  const staffId = await upsertUser(SEED_USERS.staff.email, SEED_USERS.staff.name);
  const abujaOwnerId = await upsertUser(SEED_USERS.abujaOwner.email, SEED_USERS.abujaOwner.name);

  // Rebuild only the seed workspaces (cascade deletes all their data).
  const removed = await db.query(
    `DELETE FROM workspaces WHERE name = ANY($1::text[])
       AND id IN (SELECT workspace_id FROM memberships WHERE role = 'owner' AND user_id = ANY($2::uuid[]))
     RETURNING id`,
    [[LAGOS.name, ABUJA.name], [ownerId, abujaOwnerId]],
  );
  if (removed.length) console.log(`  removed ${removed.length} previous seed workspace(s)`);
  await db.query("DELETE FROM sessions WHERE user_id = ANY($1::uuid[])", [[ownerId, managerId, staffId, abujaOwnerId]]);

  // The two businesses are built side by side (independent data).
  const buildLagos = async () => {
    // ---- Lagos provision store: owner, manager, staff.
    const lagosId = await createWorkspaceFor(ownerId, LAGOS.name);
    await addMember(lagosId, managerId, "manager");
    await addMember(lagosId, staffId, "staff");
    const lOwner = await contextFor(ownerId, lagosId);
    const lManager = await contextFor(managerId, lagosId);
    const lStaff = await contextFor(staffId, lagosId);
    await updateWorkspaceDetails(lOwner, { name: LAGOS.name, ...LAGOS.details });
    const lagos: Built = { workspaceId: lagosId, ...(await buildCatalogue(lOwner, LAGOS.customers, LAGOS.products)) };
    console.log(`  ${LAGOS.name}: ${lagos.customers.length} customers, ${lagos.products.length} products`);
    const lagosRun = await simulate(lagos, [lOwner, lManager, lStaff, lStaff], lManager, { perDay: 0.8 });
    console.log("  invoices:", lagosRun.tally);

    // One payment reversed ("the transfer bounced"): a negative row, nothing deleted.
    const toReverse = lagosRun.paidOnce[3] ?? lagosRun.paidOnce[0];
    if (toReverse) {
      await reversePayment(lManager, { paymentId: toReverse.paymentId, reason: "Transfer was reversed by the bank", clientRequestId: randomUUID() });
      console.log("  reversed one payment");
    }
    await ensureEveryStatus(lagos, lStaff, lManager);
    await shapeStock(lManager, lagos, ["SUGAR-50KG", "MILO-500", "RICE-50KG"], ["SARDINE-CTN"]);
    console.log(`  expenses: ${await seedExpenses([lOwner, lManager, lStaff], EXPENSES_LAGOS)}`);

    // A pending invitation (the link is printed once; only its hash is stored).
    const inviteToken = randomToken();
    await db.query(
      `INSERT INTO invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
       VALUES ($1, 'chioma.new@example.com', 'staff', $2, $3, now() + interval '7 days')`,
      [lagosId, tokenHashParam(inviteToken), ownerId],
    );

    return { lagosId, lOwner, lagos, inviteToken };
  };
  const buildAbuja = async () => {
    // ---- Abuja tailoring business. Tunde also works here (as staff), to show
    // one person in two workspaces with different roles.
    const abujaId = await createWorkspaceFor(abujaOwnerId, ABUJA.name);
    await addMember(abujaId, managerId, "staff");
    const aOwner = await contextFor(abujaOwnerId, abujaId);
    const aStaff = await contextFor(managerId, abujaId);
    await updateWorkspaceDetails(aOwner, { name: ABUJA.name, ...ABUJA.details });
    const abuja: Built = { workspaceId: abujaId, ...(await buildCatalogue(aOwner, ABUJA.customers, ABUJA.products)) };
    console.log(`  ${ABUJA.name}: ${abuja.customers.length} customers, ${abuja.products.length} products`);
    const abujaRun = await simulate(abuja, [aOwner, aOwner, aStaff], aOwner, { perDay: 0.4, services: ABUJA.services });
    console.log("  invoices:", abujaRun.tally);
    await ensureEveryStatus(abuja, aStaff, aOwner);
    await shapeStock(aOwner, abuja, ["ASOOKE-SET"], ["LACE-5Y"]);
    console.log(`  expenses: ${await seedExpenses([aOwner, aStaff], EXPENSES_ABUJA)}`);

    return { abujaId };
  };
  const [{ lagosId, lOwner, lagos, inviteToken }, { abujaId }] = await Promise.all([buildLagos(), buildAbuja()]);

  // ---- A little assistant history and one pending proposal (no AI calls).
  await seedAi(lOwner, lagos.customers, lagos.products);

  const ok = await verifyInvariants([lagosId, abujaId]);
  const app = process.env.APP_URL ?? "http://localhost:3030";
  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s.`);
  console.log("Sign in with any of these (password = SEED_PASSWORD):");
  console.log(`  ${SEED_USERS.owner.email}       owner, ${LAGOS.name}`);
  console.log(`  ${SEED_USERS.manager.email}     manager, ${LAGOS.name}; staff, ${ABUJA.name}`);
  console.log(`  ${SEED_USERS.staff.email}       staff, ${LAGOS.name}`);
  console.log(`  ${SEED_USERS.abujaOwner.email}       owner, ${ABUJA.name}`);
  console.log(`Pending invite for chioma.new@example.com: ${app}/accept-invite/${inviteToken}`);
  if (!ok) process.exitCode = 1;
}

try {
  await main();
} finally {
  await closeDb();
}
