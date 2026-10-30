// Runs the real service functions against the database and prints PASS or
// FAIL for each rule Ledgerline promises. Not a test framework, just a script.
//
//   npm run check:ledgerline
//
// It creates two throwaway workspaces ("Check A/B …") with their own users,
// runs every check, then deletes them. (They are not marked as demo, so the
// daily-digest check can see them. If a run crashes before tearing down,
// delete the leftover "Check A/B" workspaces by hand.) The AI checks always use the MOCK
// provider, so no API key or network is needed.

import { randomUUID } from "node:crypto";
import { closeDb, db, isForeignKeyViolation } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { byteaParam } from "@/lib/crypto";
import { contextFor, type Ctx } from "@/lib/context";
import { addDays, todayInLagos } from "@/lib/dates";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { formatNaira, parseNaira } from "@/lib/money";
import { invoiceSchema } from "@/lib/validation/business";
import { createCustomer, getCustomer, updateCustomer } from "@/lib/services/customers";
import { adjustStock, createProduct, getProduct } from "@/lib/services/products";
import { createInvoice, getInvoice, voidInvoice } from "@/lib/services/invoices";
import { recordPayment, reversePayment } from "@/lib/services/payments";
import { createExpense, deleteExpense, getExpense } from "@/lib/services/expenses";
import { verifyInvariants } from "./invariants.mts";
import { extraChecks } from "./check-extra.mts";

// ------------------------------------------------------------------ harness
let passed = 0;
let failed = 0;
export async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function rejects(fn: () => Promise<unknown>, kind: new (...args: never[]) => Error, label = kind.name): Promise<Error> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof kind) return error;
    throw new Error(`expected ${label}, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
  }
  throw new Error(`expected ${label}, but it succeeded`);
}

// ------------------------------------------------------------------ fixtures
export interface World {
  a: { workspaceId: string; owner: Ctx; manager: Ctx; staff: Ctx; customerId: string; productId: string };
  b: { workspaceId: string; owner: Ctx; customerId: string; productId: string; invoiceId: string; paymentId: string; expenseId: string };
  userIds: string[];
}

const stamp = Date.now().toString(36);
const today = todayInLagos();

async function makeUser(label: string): Promise<string> {
  const { hash, salt } = await hashPassword(`check-${stamp}-password`);
  const rows = await db.query<{ id: string }>(
    "INSERT INTO users (email, name, password_hash, password_salt, is_demo) VALUES ($1, $2, $3, $4, true) RETURNING id",
    [`check-${label}-${stamp}@example.com`, `Check ${label}`, byteaParam(hash), byteaParam(salt)],
  );
  return rows[0]!.id;
}

async function makeWorkspace(name: string, members: [string, "owner" | "manager" | "staff"][]): Promise<string> {
  const rows = await db.query<{ id: string }>("INSERT INTO workspaces (name) VALUES ($1) RETURNING id", [name]);
  const id = rows[0]!.id;
  for (const [userId, role] of members) {
    await db.query("INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, $3)", [id, userId, role]);
  }
  return id;
}

export function invoiceInput(customerId: string, items: { productId?: string; quantity: number; unitPrice?: string; description?: string }[], extra: Record<string, unknown> = {}) {
  return invoiceSchema.parse({
    customerId,
    issueDate: today,
    dueDate: addDays(today, 7),
    items,
    discount: "",
    deliveryFee: "",
    clientRequestId: randomUUID(),
    send: true,
    ...extra,
  });
}

const product = (sku: string, price: number, opening: number) => ({
  sku,
  name: `Check ${sku}`,
  unit: "unit",
  price,
  cost: Math.floor(price / 2),
  lowStockLevel: null,
  openingStock: opening,
});

async function setUp(): Promise<World> {
  const [ownerA, managerA, staffA, ownerB] = await Promise.all([makeUser("owner-a"), makeUser("manager-a"), makeUser("staff-a"), makeUser("owner-b")]);
  const wsA = await makeWorkspace(`Check A ${stamp}`, [[ownerA, "owner"], [managerA, "manager"], [staffA, "staff"]]);
  const wsB = await makeWorkspace(`Check B ${stamp}`, [[ownerB, "owner"]]);
  const a = { owner: await contextFor(ownerA, wsA), manager: await contextFor(managerA, wsA), staff: await contextFor(staffA, wsA) };
  const bOwner = await contextFor(ownerB, wsB);

  const customerA = await createCustomer(a.owner, { name: "Mama Chidi", phone: "0803 000 0001", whatsapp: null, email: null, notes: null, tags: [] });
  const productA = await createProduct(a.owner, product("CHK-A", 100_000, 50));
  const customerB = await createCustomer(bOwner, { name: "Other Business Customer", phone: "0803 999 9999", whatsapp: null, email: null, notes: null, tags: [] });
  const productB = await createProduct(bOwner, product("CHK-B", 50_000, 20));
  const invoiceB = (await createInvoice(bOwner, invoiceInput(customerB, [{ productId: productB, quantity: 1 }]))).id;
  const paymentB = (await recordPayment(bOwner, { invoiceId: invoiceB, amount: 10_000, method: "cash", paidOn: today, note: null, clientRequestId: randomUUID() })).id;
  const expenseB = (await createExpense(bOwner, { category: "rent", amount: 500_000, spentOn: today, note: null, receiptRef: null, clientRequestId: randomUUID() })).id;

  return {
    a: { workspaceId: wsA, ...a, customerId: customerA, productId: productA },
    b: { workspaceId: wsB, owner: bOwner, customerId: customerB, productId: productB, invoiceId: invoiceB, paymentId: paymentB, expenseId: expenseB },
    userIds: [ownerA, managerA, staffA, ownerB],
  };
}

async function tearDown(world: World): Promise<void> {
  await db.query("DELETE FROM workspaces WHERE id = ANY($1::uuid[])", [[world.a.workspaceId, world.b.workspaceId]]);
  await db.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [world.userIds]);
}

// ------------------------------------------------------------------ checks
async function tenancyChecks(w: World) {
  const { a, b } = w;
  await check("a record from another workspace returns not found, for every record type", async () => {
    await rejects(() => getCustomer(a.owner, b.customerId), NotFoundError, "customer NotFound");
    await rejects(() => getProduct(a.owner, b.productId), NotFoundError, "product NotFound");
    await rejects(() => getInvoice(a.owner, b.invoiceId), NotFoundError, "invoice NotFound");
    await rejects(() => getExpense(a.owner, b.expenseId), NotFoundError, "expense NotFound");
    await rejects(() => recordPayment(a.owner, { invoiceId: b.invoiceId, amount: 100, method: "cash", paidOn: today, note: null, clientRequestId: randomUUID() }), NotFoundError, "payment on foreign invoice NotFound");
    await rejects(() => reversePayment(a.owner, { paymentId: b.paymentId, reason: "x", clientRequestId: randomUUID() }), NotFoundError, "reverse foreign payment NotFound");
    await rejects(() => voidInvoice(a.owner, b.invoiceId, "x"), NotFoundError, "void foreign invoice NotFound");
    await rejects(() => updateCustomer(a.owner, b.customerId, { name: "x", phone: null, whatsapp: null, email: null, notes: null, tags: [] }), NotFoundError, "edit foreign customer NotFound");
    // Using a foreign customer or product in an invoice is refused too.
    await rejects(() => createInvoice(a.owner, invoiceInput(b.customerId, [{ productId: a.productId, quantity: 1 }])), ValidationError, "foreign customer refused");
    await rejects(() => createInvoice(a.owner, invoiceInput(a.customerId, [{ productId: b.productId, quantity: 1 }])), ValidationError, "foreign product refused");
  });

  await check("the database refuses a cross-workspace reference even when the service is bypassed", async () => {
    try {
      await db.query(
        `INSERT INTO invoices (workspace_id, number, customer_id, issue_date, due_date, subtotal_kobo, total_kobo, client_request_id)
         VALUES ($1, 999, $2, CURRENT_DATE, CURRENT_DATE, 100, 100, gen_random_uuid())`,
        [a.workspaceId, b.customerId],
      );
    } catch (error) {
      assert(isForeignKeyViolation(error), `expected a foreign-key violation, got ${String(error)}`);
      return;
    }
    throw new Error("the insert succeeded");
  });
}

async function permissionChecks(w: World) {
  const { a } = w;
  await check("staff cannot void, reverse, adjust stock, delete expenses or edit others' records", async () => {
    const inv = (await createInvoice(a.owner, invoiceInput(a.customerId, [{ productId: a.productId, quantity: 1 }]))).id;
    await rejects(() => voidInvoice(a.staff, inv, "no"), ForbiddenError, "void Forbidden");
    const pay = (await recordPayment(a.staff, { invoiceId: inv, amount: 1_000, method: "cash", paidOn: today, note: null, clientRequestId: randomUUID() })).id;
    await rejects(() => reversePayment(a.staff, { paymentId: pay, reason: "no", clientRequestId: randomUUID() }), ForbiddenError, "reverse Forbidden");
    await rejects(() => adjustStock(a.staff, a.productId, { reason: "restock", quantityDelta: 5, note: null }), ForbiddenError, "stock Forbidden");
    const exp = (await createExpense(a.owner, { category: "other", amount: 1_000, spentOn: today, note: null, receiptRef: null, clientRequestId: randomUUID() })).id;
    await rejects(() => deleteExpense(a.staff, exp), ForbiddenError, "delete expense Forbidden");
    // The owner's customer: staff may view it but not edit it.
    await getCustomer(a.staff, a.customerId);
    await rejects(() => updateCustomer(a.staff, a.customerId, { name: "Renamed", phone: null, whatsapp: null, email: null, notes: null, tags: [] }), ForbiddenError, "edit others' customer Forbidden");
    // And staff can't even see a colleague's expense.
    await rejects(() => getExpense(a.staff, exp), NotFoundError, "colleague's expense hidden");
  });
}

async function invariantChecks(w: World) {
  const { a } = w;

  await check("concurrent invoice creations get different consecutive numbers with no gaps", async () => {
    const before = await db.query<{ n: number }>("SELECT next_invoice_number AS n FROM workspaces WHERE id = $1", [a.workspaceId]);
    const start = Number(before[0]!.n);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => createInvoice(a.owner, invoiceInput(a.customerId, [{ description: "Service", quantity: 1, unitPrice: "1000" }], { send: false }))),
    );
    const numbers = (await Promise.all(results.map((r) => getInvoice(a.owner, r.id)))).map((i) => i.number).sort((x, y) => x - y);
    const expected = Array.from({ length: 6 }, (_, i) => start + i);
    assert(JSON.stringify(numbers) === JSON.stringify(expected), `got ${numbers.join(",")}, expected ${expected.join(",")}`);
  });

  await check("a failed create (not enough stock) does not burn an invoice number", async () => {
    const lonely = await createProduct(a.owner, product(`GAP-${stamp}`.toUpperCase().slice(0, 32), 1_000, 0));
    const before = Number((await db.query<{ n: number }>("SELECT next_invoice_number AS n FROM workspaces WHERE id = $1", [a.workspaceId]))[0]!.n);
    await rejects(() => createInvoice(a.owner, invoiceInput(a.customerId, [{ productId: lonely, quantity: 1 }])), ValidationError);
    const after = Number((await db.query<{ n: number }>("SELECT next_invoice_number AS n FROM workspaces WHERE id = $1", [a.workspaceId]))[0]!.n);
    assert(before === after, `counter moved from ${before} to ${after}`);
  });

  await check("two concurrent sales of the last item leave stock at zero and one fails cleanly", async () => {
    const last = await createProduct(a.owner, product(`LAST-${stamp}`.toUpperCase().slice(0, 32), 5_000, 1));
    const attempts = await Promise.allSettled([
      createInvoice(a.staff, invoiceInput(a.customerId, [{ productId: last, quantity: 1 }])),
      createInvoice(a.manager, invoiceInput(a.customerId, [{ productId: last, quantity: 1 }])),
    ]);
    const ok = attempts.filter((r) => r.status === "fulfilled").length;
    const failedClean = attempts.filter((r) => r.status === "rejected" && r.reason instanceof ValidationError).length;
    const stock = (await getProduct(a.owner, last)).stockQuantity;
    assert(ok === 1 && failedClean === 1, `expected 1 success + 1 ValidationError, got ${ok} + ${failedClean}`);
    assert(stock === 0, `stock is ${stock}`);
  });

  const inv = (await createInvoice(a.owner, invoiceInput(a.customerId, [{ productId: a.productId, quantity: 2 }]))).id;
  const total = (await getInvoice(a.owner, inv)).totalKobo; // 2 x ₦1,000 = 200000 kobo

  await check("a payment larger than the balance is rejected", async () => {
    await rejects(() => recordPayment(a.staff, { invoiceId: inv, amount: total + 1, method: "cash", paidOn: today, note: null, clientRequestId: randomUUID() }), ValidationError);
  });

  let firstPayment = "";
  await check("paying in two parts marks the invoice paid exactly at the total", async () => {
    firstPayment = (await recordPayment(a.staff, { invoiceId: inv, amount: 120_000, method: "transfer", paidOn: today, note: null, clientRequestId: randomUUID() })).id;
    const mid = await getInvoice(a.owner, inv);
    assert(mid.status === "partly_paid", `after part 1 status is ${mid.status}`);
    await recordPayment(a.staff, { invoiceId: inv, amount: total - 120_000, method: "cash", paidOn: today, note: null, clientRequestId: randomUUID() });
    const done = await getInvoice(a.owner, inv);
    assert(done.status === "paid" && done.amountPaidKobo === total && done.balanceKobo === 0, `status ${done.status}, paid ${done.amountPaidKobo}`);
  });

  await check("reversing a payment restores the balance (and can't be done twice)", async () => {
    const reversal = { paymentId: firstPayment, reason: "bounced", clientRequestId: randomUUID() };
    await reversePayment(a.manager, reversal);
    const after = await getInvoice(a.owner, inv);
    assert(after.balanceKobo === 120_000 && after.status === "partly_paid", `balance ${after.balanceKobo}, status ${after.status}`);
    await rejects(() => reversePayment(a.manager, { ...reversal, clientRequestId: randomUUID() }), ConflictError);
  });

  await check("voiding an invoice restores stock and cannot be done twice", async () => {
    const before = (await getProduct(a.owner, a.productId)).stockQuantity;
    const v = (await createInvoice(a.owner, invoiceInput(a.customerId, [{ productId: a.productId, quantity: 3 }]))).id;
    assert((await getProduct(a.owner, a.productId)).stockQuantity === before - 3, "sending did not take stock");
    await voidInvoice(a.manager, v, "test");
    assert((await getProduct(a.owner, a.productId)).stockQuantity === before, "voiding did not restore stock");
    await rejects(() => voidInvoice(a.manager, v, "again"), ConflictError);
  });

  await check("totals are computed by the server; totals sent by the client are ignored", async () => {
    const input = invoiceInput(a.customerId, [{ productId: a.productId, quantity: 2, unitPrice: "" }], {
      send: false,
      totalKobo: 1,
      subtotalKobo: 1,
      items: [{ productId: a.productId, quantity: 2, lineTotalKobo: 1 }],
    });
    const id = (await createInvoice(a.owner, input)).id;
    const saved = await getInvoice(a.owner, id);
    assert(saved.totalKobo === 200_000 && saved.items[0]?.lineTotalKobo === 200_000, `total ${saved.totalKobo}`);
  });

  await check("the same client_request_id sent twice creates one record (invoice, payment, expense)", async () => {
    const input = invoiceInput(a.customerId, [{ description: "Twice", quantity: 1, unitPrice: "500" }]);
    const [x, y] = await Promise.all([createInvoice(a.owner, input), createInvoice(a.owner, input)]);
    assert(x.id === y.id, "two invoices were created");
    const pay = { invoiceId: x.id, amount: 10_000, method: "cash" as const, paidOn: today, note: null, clientRequestId: randomUUID() };
    const [p1, p2] = await Promise.all([recordPayment(a.owner, pay), recordPayment(a.owner, pay)]);
    assert(p1.id === p2.id, "two payments were created");
    const exp = { category: "other" as const, amount: 1_000, spentOn: today, note: null, receiptRef: null, clientRequestId: randomUUID() };
    const [e1, e2] = await Promise.all([createExpense(a.owner, exp), createExpense(a.owner, exp)]);
    assert(e1.id === e2.id, "two expenses were created");
    const counts = await db.query<{ n: string }>("SELECT count(*) AS n FROM payments WHERE workspace_id = $1 AND client_request_id = $2", [a.workspaceId, pay.clientRequestId]);
    assert(Number(counts[0]!.n) === 1, "duplicate payment row in the table");
  });

  await check("a sent invoice's items can't be edited, even with direct SQL", async () => {
    const sent = (await createInvoice(a.owner, invoiceInput(a.customerId, [{ description: "Frozen", quantity: 1, unitPrice: "100" }]))).id;
    try {
      await db.query("UPDATE invoice_items SET quantity = 5, line_total_kobo = 50000 WHERE invoice_id = $1", [sent]);
    } catch {
      return;
    }
    throw new Error("the item was edited");
  });
}

function moneyChecks() {
  const cases: [string, number | null][] = [
    ["1,250.50", 125_050],
    ["₦1,250.5", 125_050],
    ["  2000 ", 200_000],
    ["NGN 15,000", 1_500_000],
    ["0.05", 5],
    ["0", 0],
    ["1,25,0", null],
    ["12.345", null],
    ["-5", null],
    ["1e3", null],
    ["2k", null],
    ["", null],
  ];
  return check(`the money module parses and formats ${cases.length + 4} edge cases`, () => {
    for (const [input, expected] of cases) {
      const r = parseNaira(input);
      if (expected === null) assert(!r.ok, `"${input}" should be rejected`);
      else assert(r.ok && r.kobo === expected, `"${input}" -> ${r.ok ? r.kobo : r.error}, expected ${expected}`);
    }
    assert(formatNaira(125_050) === "₦1,250.50", formatNaira(125_050));
    assert(formatNaira(5) === "₦0.05", formatNaira(5));
    assert(formatNaira(-50_000) === "−₦500.00", formatNaira(-50_000));
    assert(formatNaira(100_000_000_000) === "₦1,000,000,000.00", formatNaira(100_000_000_000));
  });
}

async function main() {
  if (process.env.AI_PROVIDER !== "mock") process.env.AI_PROVIDER = "mock";
  console.log("Ledgerline checks (AI provider forced to mock)\n");
  await moneyChecks();
  const world = await setUp();
  try {
    await tenancyChecks(world);
    await permissionChecks(world);
    await invariantChecks(world);
    await extraChecks(world);
    await check("all stock, invoice and payment invariants hold in the check workspaces", async () => {
      assert(await verifyInvariants([world.a.workspaceId, world.b.workspaceId], true), "an invariant failed (see above)");
    });
  } finally {
    await tearDown(world);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

try {
  await main();
} finally {
  await closeDb();
}
