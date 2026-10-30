"use client";

import { useActionState } from "react";
import { adjustStockAction, createProductAction, updateProductAction } from "./actions";
import { IDLE } from "@/lib/forms";
import { koboToInput } from "@/lib/money";
import { Field, SelectField, TextareaField } from "@/components/ui/field";
import { FormMessage, SubmitButton } from "@/components/ui/form-status";

const LABELS = {
  sku: "SKU",
  name: "Name",
  unit: "Unit",
  price: "Selling price",
  cost: "Cost price",
  lowStockLevel: "Low-stock level",
  openingStock: "Opening stock",
  quantityDelta: "Quantity",
  reason: "Reason",
  note: "Note",
};

export interface ProductDefaults {
  id: string;
  sku: string;
  name: string;
  unit: string;
  priceKobo: number;
  costKobo: number;
  lowStockLevel: number | null;
}

export function ProductForm({ defaults, workspaceLowStock }: { defaults?: ProductDefaults; workspaceLowStock: number }) {
  const [state, action] = useActionState(defaults ? updateProductAction : createProductAction, IDLE);
  const v = state.status === "error" ? state.values : null;
  const errors = state.status === "error" ? state.fieldErrors : {};
  const value = (key: string, fallback: string) => v?.[key] ?? fallback;
  return (
    <form action={action} className="max-w-2xl space-y-4" noValidate>
      <FormMessage state={state} labels={LABELS} />
      {defaults ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field name="name" label="Name" required defaultValue={value("name", defaults?.name ?? "")} errors={errors.name} />
        <Field
          name="sku"
          label="SKU"
          required
          hint="Your own short code, like RICE-50KG."
          defaultValue={value("sku", defaults?.sku ?? "")}
          errors={errors.sku}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field name="unit" label="Unit" required hint="bag, carton, yard…" defaultValue={value("unit", defaults?.unit ?? "unit")} errors={errors.unit} />
        <Field
          name="price"
          label="Selling price (₦)"
          required
          inputMode="decimal"
          defaultValue={value("price", defaults ? koboToInput(defaults.priceKobo) : "")}
          errors={errors.price}
        />
        <Field
          name="cost"
          label="Cost price (₦)"
          required
          inputMode="decimal"
          hint="What you pay; used for estimated profit."
          defaultValue={value("cost", defaults ? koboToInput(defaults.costKobo) : "")}
          errors={errors.cost}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          name="lowStockLevel"
          label="Low-stock level"
          inputMode="numeric"
          hint={`Warn at or below this many. Empty uses the business default (${workspaceLowStock}).`}
          defaultValue={value("lowStockLevel", defaults?.lowStockLevel?.toString() ?? "")}
          errors={errors.lowStockLevel}
        />
        {defaults ? null : (
          <Field
            name="openingStock"
            label="Opening stock"
            required
            inputMode="numeric"
            hint="Recorded as the first line of the stock ledger."
            defaultValue={value("openingStock", "0")}
            errors={errors.openingStock}
          />
        )}
      </div>
      <SubmitButton>{defaults ? "Save changes" : "Add product"}</SubmitButton>
    </form>
  );
}

export function StockAdjustForm({ productId, unit }: { productId: string; unit: string }) {
  const [state, action] = useActionState(adjustStockAction, IDLE);
  const v = state.status === "error" ? state.values : null;
  const errors = state.status === "error" ? state.fieldErrors : {};
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} labels={LABELS} />
      <input type="hidden" name="productId" value={productId} />
      <SelectField name="reason" label="Reason" required defaultValue={v?.reason ?? "restock"} errors={errors.reason}>
        <option value="restock">Restock (new stock arrived)</option>
        <option value="adjustment">Adjustment (count correction, damage, loss)</option>
      </SelectField>
      <Field
        name="quantityDelta"
        label={`Quantity (${unit})`}
        required
        inputMode="numeric"
        hint="Use a minus sign for an adjustment that removes stock, like -2."
        defaultValue={v?.quantityDelta ?? ""}
        errors={errors.quantityDelta}
      />
      <TextareaField name="note" label="Note" rows={2} defaultValue={v?.note ?? ""} errors={errors.note} />
      <SubmitButton pendingText="Recording…">Record stock change</SubmitButton>
    </form>
  );
}
