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

// Deterministic randomness: the same seed gives the same shape of data each run.
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
  const customerIds: string[] = [];
  for (const c of customers) {
    customerIds.push(
      await createCustomer(owner, {
        name: c.name,
        phone: c.phone ?? null,
        whatsapp: c.whatsapp ?? null,
        email: c.email ?? null,
        notes: c.notes ?? null,
        tags: c.tags ?? [],
      }),
    );
  }
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

/** Simulates ~90 days of trading through the real services. */
async function simulate(
  built: Built,
  sellers: Ctx[],
  managerCtx: Ctx,
  options: { perDay: number; services?: { description: string; price: number }[] },
): Promise<{ tally: Tally; paidOnce: { invoiceId: string; paymentId: string }[] }> {
  const today = todayInLagos();
  const tally: Tally = { draft: 0, sent: 0, partly: 0, paid: 0, void: 0, skipped: 0, payments: 0 };
  const paidOnce: { invoiceId: string; paymentId: string }[] = [];

  for (let age = 90; age >= 0; age--) {
    const day = addDays(today, -age);
    // Restock fortnightly whatever has run below a third of its opening stock.
    if (age % 14 === 0) {
      for (const p of built.products) {
        const current = await getProduct(managerCtx, p.id);
        if (current.stockQuantity < p.opening / 3) {
          await adjustStock(managerCtx, p.id, { reason: "restock", quantityDelta: p.opening - current.stockQuantity, note: "Supplier delivery" });
        }
      }
    }
    const count = rand() < options.perDay % 1 ? Math.ceil(options.perDay) : Math.floor(options.perDay);
    for (let n = 0; n < count; n++) {
      const seller = pick(sellers);
      const items: InvoiceInput["items"] = [];
      const lineCount = between(1, 3);
      const used = new Set<string>();
      for (let l = 0; l < lineCount; l++) {
        if (options.services && rand() < 0.55) {
          const s = pick(options.services);
          items.push({ productId: null, description: s.description, quantity: 1, unitPrice: String(s.price) });
        } else {
          const p = pick(built.products);
          if (used.has(p.id)) continue;
          used.add(p.id);
          items.push({ productId: p.id, quantity: between(1, p.opening > 50 ? 6 : 2) });
        }
      }
      if (items.length === 0) continue;

      const roll = rand();
      const draft = age < 4 && roll < 0.35;
      const willVoid = !draft && roll > 0.96;
      const input: InvoiceInput = {
        customerId: pick(built.customers),
        issueDate: day,
        dueDate: addDays(day, pick([7, 7, 14, 30])),
        items,
        discount: rand() < 0.15 ? 50_000 : 0,
        deliveryFee: rand() < 0.3 ? pick([150_000, 200_000, 250_000]) : 0,
        notes: null,
        clientRequestId: randomUUID(),
        send: !draft,
      };
      let invoiceId: string;
      try {
        invoiceId = (await createInvoice(seller, input)).id;
      } catch (error) {
        // Not enough stock for this sale: the whole transaction (and the
        // invoice number) rolled back, exactly as in the app. Skip it.
        if (error instanceof ValidationError) {
          tally.skipped++;
          continue;
        }
        throw error;
      }
      if (draft) {
        tally.draft++;
        continue;
      }
      if (willVoid) {
        await voidInvoice(managerCtx, invoiceId, pick(["Customer cancelled", "Entered twice by mistake", "Wrong customer"]));
        tally.void++;
        continue;
      }

      const total = await invoiceTotal(built.workspaceId, invoiceId);
      const fate = rand();
      const paidShare = age > 20 ? 0.72 : age > 7 ? 0.45 : 0.25;
      const partlyShare = age > 20 ? 0.14 : 0.25;
      const payOn = (offset: number) => addDays(day, Math.min(age, offset));
      if (fate < paidShare) {
        if (rand() < 0.3) {
          const first = Math.round((total * 0.4) / 100) * 100;
          await pay(seller, invoiceId, first, payOn(between(0, 3)));
          await pay(seller, invoiceId, total - first, payOn(between(4, 12)));
          tally.payments += 2;
        } else {
          const id = await pay(seller, invoiceId, total, payOn(between(0, 6)));
          paidOnce.push({ invoiceId, paymentId: id });
          tally.payments++;
        }
        tally.paid++;
      } else if (fate < paidShare + partlyShare) {
        await pay(seller, invoiceId, Math.max(100, Math.round((total * pick([0.3, 0.5, 0.6])) / 100) * 100), payOn(between(0, 5)));
        tally.partly++;
        tally.payments++;
      } else {
        tally.sent++;
      }
    }
  }
  return { tally, paidOnce };
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
  await shapeStock(lManager, lagos, ["SUGAR-50KG", "MILO-500", "RICE-50KG"], ["SARDINE-CTN"]);
  console.log(`  expenses: ${await seedExpenses([lOwner, lManager, lStaff], EXPENSES_LAGOS)}`);

  // A pending invitation (the link is printed once; only its hash is stored).
  const inviteToken = randomToken();
  await db.query(
    `INSERT INTO invitations (workspace_id, email, role, token_hash, invited_by, expires_at)
     VALUES ($1, 'chioma.new@example.com', 'staff', $2, $3, now() + interval '7 days')`,
    [lagosId, tokenHashParam(inviteToken), ownerId],
  );

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
  await shapeStock(aOwner, abuja, ["ASOOKE-SET"], ["LACE-5Y"]);
  console.log(`  expenses: ${await seedExpenses([aOwner, aStaff], EXPENSES_ABUJA)}`);

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
