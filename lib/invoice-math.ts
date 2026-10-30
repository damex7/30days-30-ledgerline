import { parseNaira } from "@/lib/money";
import { ValidationError, type FieldErrors } from "@/lib/errors";

// The one place invoice totals are computed, in integer kobo. The server
// runs it on every create, edit and AI-proposal approval; whatever totals a
// browser or a model might send are never read. (The form shows a preview
// using the same function, labelled as a preview.)

export interface PricedProduct {
  id: string;
  name: string;
  unit: string;
  priceKobo: number;
  costKobo: number;
  archived: boolean;
}

export interface LineIn {
  productId?: string | null | undefined;
  description?: string | undefined;
  quantity: number;
  /** Naira text; empty = product price. */
  unitPrice?: string | undefined;
}

export interface ComputedLine {
  position: number;
  productId: string | null;
  description: string;
  quantity: number;
  unitPriceKobo: number;
  unitCostKobo: number;
  lineTotalKobo: number;
}

export interface ComputedInvoice {
  lines: ComputedLine[];
  subtotalKobo: number;
  discountKobo: number;
  deliveryFeeKobo: number;
  totalKobo: number;
}

export function computeInvoice(
  lines: readonly LineIn[],
  products: ReadonlyMap<string, PricedProduct>,
  discountKobo: number,
  deliveryFeeKobo: number,
): ComputedInvoice {
  const errors: FieldErrors = {};
  const computed: ComputedLine[] = [];

  lines.forEach((line, index) => {
    const at = `items.${index}`;
    const product = line.productId ? products.get(line.productId) : undefined;
    if (line.productId && (!product || product.archived)) {
      errors[`${at}.productId`] = ["That product isn't available any more."];
      return;
    }
    let unitPriceKobo: number;
    if (line.unitPrice && line.unitPrice.trim()) {
      const parsed = parseNaira(line.unitPrice);
      if (!parsed.ok) {
        errors[`${at}.unitPrice`] = [parsed.error];
        return;
      }
      unitPriceKobo = parsed.kobo;
    } else if (product) {
      unitPriceKobo = product.priceKobo;
    } else {
      errors[`${at}.unitPrice`] = ["Enter a price for this item."];
      return;
    }
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
      errors[`${at}.quantity`] = ["Quantity must be a whole number of at least 1."];
      return;
    }
    const lineTotalKobo = unitPriceKobo * line.quantity;
    if (!Number.isSafeInteger(lineTotalKobo)) {
      errors[`${at}.quantity`] = ["That line is too large."];
      return;
    }
    computed.push({
      position: index + 1,
      productId: product?.id ?? null,
      description: (line.description?.trim() || (product ? `${product.name}` : "Item")).slice(0, 200),
      quantity: line.quantity,
      unitPriceKobo,
      unitCostKobo: product?.costKobo ?? 0,
      lineTotalKobo,
    });
  });

  const subtotalKobo = computed.reduce((sum, l) => sum + l.lineTotalKobo, 0);
  if (Object.keys(errors).length === 0) {
    if (discountKobo > subtotalKobo) errors.discount = ["The discount can't be more than the subtotal."];
    else if (subtotalKobo - discountKobo + deliveryFeeKobo <= 0) errors.items = ["The invoice total must be more than ₦0."];
  }
  if (Object.keys(errors).length > 0) throw new ValidationError("Please fix the highlighted items.", errors);

  return {
    lines: computed,
    subtotalKobo,
    discountKobo,
    deliveryFeeKobo,
    totalKobo: subtotalKobo - discountKobo + deliveryFeeKobo,
  };
}

/** INV-0001 */
export function invoiceLabel(prefix: string, number: number): string {
  return `${prefix}-${String(number).padStart(4, "0")}`;
}
