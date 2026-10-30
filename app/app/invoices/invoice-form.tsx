"use client";

import { useActionState, useMemo, useState } from "react";
import { saveInvoiceAction } from "./actions";
import { IDLE, type FormState } from "@/lib/forms";
import { formatNaira, koboToInput, parseNaira } from "@/lib/money";
import { fieldId, Field, SelectField, TextareaField } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form-status";

export interface ProductOption {
  id: string;
  name: string;
  unit: string;
  priceKobo: number;
  stockQuantity: number;
}

export interface LineDraft {
  key: string;
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

export interface InvoiceFormDefaults {
  invoiceId?: string;
  customerId?: string;
  issueDate: string;
  dueDate: string;
  discount?: string;
  deliveryFee?: string;
  notes?: string;
  lines?: LineDraft[];
}

// Keys only need to be unique within this form. The first line's key is
// fixed so server and browser render the same HTML; added lines (client
// only) use a counter.
let counter = 0;
const newLine = (key = `l${++counter}`): LineDraft => ({ key, productId: "", description: "", quantity: "1", unitPrice: "" });

const LABELS: Record<string, string> = {
  customerId: "Customer",
  issueDate: "Issue date",
  dueDate: "Due date",
  discount: "Discount",
  deliveryFee: "Delivery fee",
  notes: "Notes",
  items: "Items",
};

export function InvoiceForm({
  customers,
  products,
  defaults,
  requestId,
  action: submit = saveInvoiceAction,
  proposalId,
}: {
  customers: { id: string; name: string }[];
  products: ProductOption[];
  defaults: InvoiceFormDefaults;
  requestId: string;
  /** Proposal approval reuses this form with its own action. */
  action?: (prev: FormState, formData: FormData) => Promise<FormState>;
  proposalId?: string;
}) {
  const [state, action] = useActionState(submit, IDLE);
  const [lines, setLines] = useState<LineDraft[]>(() => (defaults.lines?.length ? defaults.lines : [newLine("first")]));
  const [discount, setDiscount] = useState(defaults.discount ?? "");
  const [delivery, setDelivery] = useState(defaults.deliveryFee ?? "");
  const errors = state.status === "error" ? state.fieldErrors : {};
  const v = state.status === "error" ? state.values : null;
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // A PREVIEW for the person typing. The server recomputes everything from
  // the product prices and quantities; this number is never sent.
  const preview = useMemo(() => {
    let subtotal = 0;
    for (const l of lines) {
      const qty = Number(l.quantity);
      const price = l.unitPrice.trim() ? parseNaira(l.unitPrice) : null;
      const unit = price && price.ok ? price.kobo : (byId.get(l.productId)?.priceKobo ?? 0);
      if (Number.isSafeInteger(qty) && qty > 0) subtotal += unit * qty;
    }
    const d = discount.trim() ? parseNaira(discount) : { ok: true as const, kobo: 0 };
    const f = delivery.trim() ? parseNaira(delivery) : { ok: true as const, kobo: 0 };
    const total = subtotal - (d.ok ? d.kobo : 0) + (f.ok ? f.kobo : 0);
    return { subtotal, total };
  }, [lines, discount, delivery, byId]);

  const update = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const items = JSON.stringify(
    lines.map((l) => ({
      productId: l.productId || null,
      description: l.description || undefined,
      quantity: Number(l.quantity),
      unitPrice: l.unitPrice || undefined,
    })),
  );

  return (
    <form action={action} className="space-y-6" noValidate>
      <FormMessage state={state} labels={LABELS} />
      <input type="hidden" name="clientRequestId" value={requestId} />
      <input type="hidden" name="items" value={items} />
      {defaults.invoiceId ? <input type="hidden" name="invoiceId" value={defaults.invoiceId} /> : null}
      {proposalId ? <input type="hidden" name="proposalId" value={proposalId} /> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SelectField
          name="customerId"
          label="Customer"
          required
          defaultValue={v?.customerId ?? defaults.customerId ?? ""}
          errors={errors.customerId}
          className="sm:col-span-3"
        >
          <option value="">Choose a customer…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>
        <Field name="issueDate" label="Issue date" type="date" required defaultValue={v?.issueDate ?? defaults.issueDate} errors={errors.issueDate} />
        <Field name="dueDate" label="Due date" type="date" required defaultValue={v?.dueDate ?? defaults.dueDate} errors={errors.dueDate} />
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1 font-display text-xl font-semibold">Items</legend>
        {errors.items ? (
          <p id={fieldId("items")} className="font-semibold">
            ▲ {errors.items.join(" ")}
          </p>
        ) : null}
        <ol className="space-y-3">
          {lines.map((line, index) => {
            const product = byId.get(line.productId);
            const err = (f: string) => errors[`items.${index}.${f}`];
            return (
              <li key={line.key} className="card grid gap-3 p-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <label htmlFor={`line-${line.key}-product`} className="font-semibold">
                    Item {index + 1}
                  </label>
                  <select
                    id={`line-${line.key}-product`}
                    className="field"
                    value={line.productId}
                    onChange={(e) => update(line.key, { productId: e.target.value })}
                    aria-invalid={err("productId") ? true : undefined}
                  >
                    <option value="">Free-text item (no stock)</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {formatNaira(p.priceKobo)} · {p.stockQuantity} {p.unit} left
                      </option>
                    ))}
                  </select>
                  <label htmlFor={`line-${line.key}-desc`} className="sr-only">
                    Description for item {index + 1}
                  </label>
                  <input
                    id={`line-${line.key}-desc`}
                    className="field"
                    placeholder={product ? `Description (default: ${product.name})` : "Describe the item, like Alteration"}
                    value={line.description}
                    onChange={(e) => update(line.key, { description: e.target.value })}
                    aria-invalid={err("description") ? true : undefined}
                    aria-describedby={err("description") ? `line-${line.key}-err` : undefined}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`line-${line.key}-qty`} className="font-semibold">
                    Quantity{product ? ` (${product.unit})` : ""}
                  </label>
                  <input
                    id={`line-${line.key}-qty`}
                    className="field"
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(e) => update(line.key, { quantity: e.target.value })}
                    aria-invalid={err("quantity") ? true : undefined}
                    aria-describedby={err("quantity") ? `line-${line.key}-err` : undefined}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`line-${line.key}-price`} className="font-semibold">
                    Unit price (₦)
                  </label>
                  <input
                    id={`line-${line.key}-price`}
                    className="field"
                    inputMode="decimal"
                    placeholder={product ? koboToInput(product.priceKobo) : "Required"}
                    value={line.unitPrice}
                    onChange={(e) => update(line.key, { unitPrice: e.target.value })}
                    aria-invalid={err("unitPrice") ? true : undefined}
                    aria-describedby={err("unitPrice") ? `line-${line.key}-err` : undefined}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== line.key) : ls))}
                  disabled={lines.length === 1}
                >
                  Remove <span className="sr-only">item {index + 1}</span>
                </button>
                {err("productId") || err("description") || err("quantity") || err("unitPrice") ? (
                  <p id={`line-${line.key}-err`} className="font-semibold sm:col-span-4">
                    ▲ {[err("productId"), err("description"), err("quantity"), err("unitPrice")].flat().filter(Boolean).join(" ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn btn-secondary" onClick={() => setLines((ls) => (ls.length < 50 ? [...ls, newLine()] : ls))}>
          Add another item
        </button>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          name="discount"
          label="Discount (₦)"
          inputMode="decimal"
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          errors={errors.discount}
        />
        <Field
          name="deliveryFee"
          label="Delivery fee (₦)"
          inputMode="decimal"
          value={delivery}
          onChange={(e) => setDelivery(e.target.value)}
          errors={errors.deliveryFee}
        />
      </div>
      <TextareaField name="notes" label="Notes on the invoice" defaultValue={v?.notes ?? defaults.notes ?? ""} errors={errors.notes} />

      <div className="card p-4" aria-live="polite">
        <p className="text-sm text-ink-2">Preview. The final totals are calculated by Ledgerline when you save.</p>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-1">
          <dt>Subtotal</dt>
          <dd className="num">{formatNaira(preview.subtotal)}</dd>
          <dt className="font-bold">Total</dt>
          <dd className="num font-bold">{formatNaira(Math.max(0, preview.total))}</dd>
        </dl>
      </div>

      <div className="flex flex-wrap gap-3">
        <SubmitButton name="intent" value="send" pendingText="Saving…">
          {proposalId ? "Approve: create and send" : "Save and send"}
        </SubmitButton>
        <SubmitButton name="intent" value="draft" className="btn btn-secondary" pendingText="Saving…">
          {proposalId ? "Approve: create as draft" : "Save as draft"}
        </SubmitButton>
      </div>
      <p className="text-sm text-ink-2">Sending takes the items out of stock. A sent invoice can&apos;t be edited, only voided.</p>
    </form>
  );
}
