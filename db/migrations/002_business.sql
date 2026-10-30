-- 002: the business — customers, products and their stock ledger, invoices,
-- payments and expenses.
--
-- Tenancy in the database itself: every table carries workspace_id, every
-- parent has UNIQUE (id, workspace_id), and every child points at
-- (parent_id, workspace_id). The child's workspace_id therefore MUST equal the
-- parent's. Example: an invoice in "Mama Ngozi Provisions" that names a
-- customer id belonging to "Stitch & Thread Abuja" looks for the pair
-- (that customer id, Mama Ngozi's workspace id) in customers, finds nothing,
-- and Postgres rejects the insert with a foreign-key error, even if a buggy
-- service forgot to check.
--
-- ON DELETE, decided per foreign key:
--   * workspace -> anything: CASCADE. Deleting a business deletes all of it.
--   * business record -> business record: NO ACTION (the default). Customers,
--     products and invoices with history are archived or voided, never
--     deleted, so the database refuses those deletes. NO ACTION behaves like
--     RESTRICT but is checked at the end of the statement, which lets a
--     workspace delete cascade through all of them at once.
--   * invoice -> its items: CASCADE (items are part of the invoice; in
--     practice this only fires as part of a workspace delete).
--   * created_by -> users: SET NULL, so history survives a member leaving.

-- ---------------------------------------------------------------- customers
CREATE TABLE customers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  phone        text CHECK (phone ~ '^\+?[0-9][0-9 ]{6,19}$'),
  -- Often the same as phone, but not always; used for wa.me links.
  whatsapp     text CHECK (whatsapp ~ '^\+?[0-9][0-9 ]{6,19}$'),
  email        text CHECK (email = lower(email) AND length(email) <= 254),
  -- Typed by people, so treated as untrusted data when shown to the AI.
  notes        text CHECK (length(notes) <= 2000),
  tags         text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 10),
  -- Customers with invoices can't be deleted (FK), so they are archived.
  archived_at  timestamptz,
  created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- The target of composite foreign keys (see the header).
  UNIQUE (id, workspace_id)
);
-- Typo-tolerant search ("mama chid" -> "Mama Chidi"): a trigram GIN index on
-- the lower-cased name serves both ILIKE '%...%' and similarity (%).
CREATE INDEX customers_name_trgm_idx ON customers USING gin (lower(name) gin_trgm_ops);
-- The customers list: alphabetical within a workspace, keyset-paged by id.
CREATE INDEX customers_ws_name_idx ON customers (workspace_id, lower(name), id);
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------- products
CREATE TABLE products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  sku             text NOT NULL CHECK (sku ~ '^[A-Z0-9-]{1,32}$'),
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  -- What one "quantity" means: bag, carton, yard, piece...
  unit            text NOT NULL DEFAULT 'unit' CHECK (length(unit) BETWEEN 1 AND 20),
  -- Money is integer kobo (1 naira = 100 kobo). Integers add up exactly;
  -- floats don't (0.1 + 0.2 = 0.30000000000000004).
  price_kobo      bigint NOT NULL CHECK (price_kobo >= 0),
  cost_kobo       bigint NOT NULL CHECK (cost_kobo >= 0),
  -- Whole units only: these businesses sell bags, cartons and yards. Selling
  -- by weight would need numeric(12,3) here and in the ledger.
  -- Never below zero, and only ever changed by the stock ledger trigger below.
  stock_quantity  integer NOT NULL DEFAULT 0 CONSTRAINT products_stock_not_negative CHECK (stock_quantity >= 0),
  -- NULL means "use the workspace default".
  low_stock_level integer CHECK (low_stock_level BETWEEN 0 AND 100000),
  archived_at     timestamptz,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- A SKU names one product within a business (two businesses may reuse it).
  CONSTRAINT products_sku_per_workspace UNIQUE (workspace_id, sku),
  UNIQUE (id, workspace_id)
);
CREATE INDEX products_name_trgm_idx ON products USING gin (lower(name) gin_trgm_ops);
CREATE INDEX products_ws_name_idx ON products (workspace_id, lower(name), id);
CREATE TRIGGER products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every change to stock is a row here (sale, restock, adjustment, return), so
-- "why is rice at 12?" always has an answer: stock_quantity = SUM(deltas).
CREATE TABLE stock_movements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  product_id     uuid NOT NULL,
  quantity_delta integer NOT NULL CHECK (quantity_delta <> 0),
  reason         text NOT NULL CHECK (reason IN ('sale', 'restock', 'adjustment', 'return')),
  -- Set for sales (sending an invoice) and returns (voiding one).
  invoice_id     uuid,
  note           text CHECK (length(note) <= 300),
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (product_id, workspace_id) REFERENCES products (id, workspace_id),
  -- Each reason moves stock one way only; sales always name their invoice.
  CHECK (reason <> 'sale' OR (quantity_delta < 0 AND invoice_id IS NOT NULL)),
  CHECK (reason NOT IN ('restock', 'return') OR quantity_delta > 0)
);
-- The product page's ledger, newest first.
CREATE INDEX stock_movements_product_idx ON stock_movements (workspace_id, product_id, created_at DESC, id DESC);

-- Applying a movement to products.stock_quantity happens HERE, in the same
-- statement as the ledger insert, so the two can never disagree. The UPDATE
-- takes a row lock on the product: when two staff sell the last bag at the
-- same moment, the second transaction waits for the first to commit, then
-- re-checks the row it sees, now 0 - 1 = -1, which fails
-- products_stock_not_negative and rolls back cleanly. Stock never goes below
-- zero and nothing is double-sold.
CREATE FUNCTION stock_movements_apply() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('ledgerline.stock_via_ledger', 'on', true);
  UPDATE products SET stock_quantity = stock_quantity + NEW.quantity_delta
   WHERE id = NEW.product_id AND workspace_id = NEW.workspace_id;
  PERFORM set_config('ledgerline.stock_via_ledger', 'off', true);
  RETURN NULL;
END $$;
CREATE TRIGGER stock_movements_apply AFTER INSERT ON stock_movements FOR EACH ROW EXECUTE FUNCTION stock_movements_apply();

-- ...and nothing else may change it: new products start at 0 (opening stock
-- is a "restock" movement) and a direct UPDATE of stock_quantity is refused.
CREATE FUNCTION products_stock_only_via_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.stock_quantity <> 0 THEN
    RAISE EXCEPTION 'new products start at 0 stock; record opening stock as a restock' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.stock_quantity <> OLD.stock_quantity
     AND current_setting('ledgerline.stock_via_ledger', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'stock_quantity changes only through stock_movements' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER products_stock_only_via_ledger BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION products_stock_only_via_ledger();

-- ----------------------------------------------------------------- invoices
CREATE TABLE invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- From workspaces.next_invoice_number; printed as INV-0001.
  number            integer NOT NULL CHECK (number >= 1),
  customer_id       uuid NOT NULL,
  -- Overdue is NOT a status: it is derived (sent or partly paid, and past the
  -- due date). A stored flag would be wrong from midnight until the next cron
  -- run; a derived one is always right and the partial index keeps it cheap.
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'partly_paid', 'paid', 'void')),
  issue_date        date NOT NULL,
  due_date          date NOT NULL,
  subtotal_kobo     bigint NOT NULL CHECK (subtotal_kobo >= 0),
  discount_kobo     bigint NOT NULL DEFAULT 0 CHECK (discount_kobo >= 0),
  delivery_fee_kobo bigint NOT NULL DEFAULT 0 CHECK (delivery_fee_kobo >= 0),
  total_kobo        bigint NOT NULL CHECK (total_kobo > 0),
  -- Kept equal to SUM(payments.amount_kobo) by the service and checked at
  -- commit by a deferred trigger below.
  amount_paid_kobo  bigint NOT NULL DEFAULT 0,
  notes             text CHECK (length(notes) <= 1000),
  -- Idempotency: the form sends a random id; a double tap or a retry sends
  -- the same id again and hits this unique constraint instead of creating a
  -- second invoice.
  client_request_id uuid NOT NULL,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  sent_at           timestamptz,
  voided_at         timestamptz,
  voided_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  void_reason       text CHECK (length(void_reason) <= 300),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (customer_id, workspace_id) REFERENCES customers (id, workspace_id),
  CONSTRAINT invoices_number_per_workspace UNIQUE (workspace_id, number),
  CONSTRAINT invoices_request_per_workspace UNIQUE (workspace_id, client_request_id),
  UNIQUE (id, workspace_id),
  CHECK (due_date >= issue_date),
  CHECK (discount_kobo <= subtotal_kobo),
  -- The total is always exactly the sum of its parts.
  CONSTRAINT invoices_total_adds_up CHECK (total_kobo = subtotal_kobo - discount_kobo + delivery_fee_kobo),
  -- Never more paid than owed.
  CONSTRAINT invoices_paid_within_total CHECK (amount_paid_kobo BETWEEN 0 AND total_kobo),
  -- Status always matches the money (void only with nothing paid: reverse
  -- payments first).
  CONSTRAINT invoices_status_matches_payments CHECK (
       (status IN ('draft', 'sent') AND amount_paid_kobo = 0)
    OR (status = 'partly_paid' AND amount_paid_kobo > 0 AND amount_paid_kobo < total_kobo)
    OR (status = 'paid' AND amount_paid_kobo = total_kobo)
    OR (status = 'void' AND amount_paid_kobo = 0)
  ),
  CHECK ((status = 'void') = (voided_at IS NOT NULL)),
  CHECK (status = 'draft' OR status = 'void' OR sent_at IS NOT NULL)
);
-- The invoices list and date-range reports: newest first, id as tie-breaker
-- for keyset pagination.
CREATE INDEX invoices_ws_issue_idx ON invoices (workspace_id, issue_date DESC, id DESC);
-- A customer's invoices and balance.
CREATE INDEX invoices_ws_customer_idx ON invoices (workspace_id, customer_id, issue_date DESC);
-- Overdue and money-owed queries only ever look at open invoices.
CREATE INDEX invoices_open_due_idx ON invoices (workspace_id, due_date) WHERE status IN ('sent', 'partly_paid');
CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Once sent, an invoice's money and customer are frozen (void it and issue a
-- new one instead), and a void invoice never changes again.
CREATE FUNCTION invoices_freeze_after_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'a void invoice cannot change' USING ERRCODE = '23514', CONSTRAINT = 'invoices_freeze_after_draft';
  END IF;
  IF OLD.status <> 'draft' AND (NEW.customer_id, NEW.number, NEW.issue_date, NEW.subtotal_kobo, NEW.discount_kobo, NEW.delivery_fee_kobo)
       IS DISTINCT FROM (OLD.customer_id, OLD.number, OLD.issue_date, OLD.subtotal_kobo, OLD.discount_kobo, OLD.delivery_fee_kobo) THEN
    RAISE EXCEPTION 'a sent invoice cannot be edited, only voided' USING ERRCODE = '23514', CONSTRAINT = 'invoices_freeze_after_draft';
  END IF;
  IF NEW.status = 'draft' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'an invoice cannot go back to draft' USING ERRCODE = '23514', CONSTRAINT = 'invoices_freeze_after_draft';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_freeze_after_draft BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_freeze_after_draft();

CREATE TABLE invoice_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  invoice_id      uuid NOT NULL,
  position        smallint NOT NULL CHECK (position BETWEEN 1 AND 50),
  -- NULL for a free-text line ("Delivery to Lekki", "Alteration").
  product_id      uuid,
  description     text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 200),
  -- Price, cost and quantity are COPIED at the time of sale: changing a
  -- product's price tomorrow must not rewrite yesterday's invoice or profit.
  unit_price_kobo bigint NOT NULL CHECK (unit_price_kobo >= 0),
  unit_cost_kobo  bigint NOT NULL DEFAULT 0 CHECK (unit_cost_kobo >= 0),
  quantity        integer NOT NULL CHECK (quantity BETWEEN 1 AND 100000),
  line_total_kobo bigint NOT NULL,
  FOREIGN KEY (invoice_id, workspace_id) REFERENCES invoices (id, workspace_id) ON DELETE CASCADE,
  -- MATCH SIMPLE (the default): a NULL product_id skips the check, a real one
  -- must be a product of the same workspace.
  FOREIGN KEY (product_id, workspace_id) REFERENCES products (id, workspace_id),
  UNIQUE (invoice_id, position),
  CONSTRAINT invoice_items_line_adds_up CHECK (line_total_kobo = unit_price_kobo * quantity)
);
-- Top products and the stock-to-sales consistency check.
CREATE INDEX invoice_items_ws_product_idx ON invoice_items (workspace_id, product_id) WHERE product_id IS NOT NULL;

-- Items can be added, changed or removed only while the invoice is a draft.
CREATE FUNCTION invoice_items_only_while_draft() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  current_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN target := OLD.invoice_id; ELSE target := NEW.invoice_id; END IF;
  SELECT status INTO current_status FROM invoices WHERE id = target;
  -- Not found: the invoice itself is being deleted with its workspace.
  IF FOUND AND current_status <> 'draft' THEN
    RAISE EXCEPTION 'items of a sent invoice cannot be edited' USING ERRCODE = '23514', CONSTRAINT = 'invoice_items_only_while_draft';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_items_only_while_draft BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION invoice_items_only_while_draft();

-- subtotal_kobo = SUM(line_total_kobo), checked at COMMIT (deferred) so the
-- service can insert the invoice and then its items in one transaction.
CREATE FUNCTION invoice_subtotal_matches_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  stored bigint;
  summed bigint;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN target := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN target := OLD.invoice_id;
  ELSE target := NEW.invoice_id;
  END IF;
  SELECT subtotal_kobo INTO stored FROM invoices WHERE id = target;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(line_total_kobo), 0) INTO summed FROM invoice_items WHERE invoice_id = target;
  IF stored <> summed THEN
    RAISE EXCEPTION 'invoice subtotal % does not match its items %', stored, summed
      USING ERRCODE = '23514', CONSTRAINT = 'invoice_subtotal_matches_items';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER invoices_subtotal_matches_items AFTER INSERT OR UPDATE ON invoices
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION invoice_subtotal_matches_items();
CREATE CONSTRAINT TRIGGER invoice_items_subtotal_matches AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION invoice_subtotal_matches_items();

-- ----------------------------------------------------------------- payments
-- Append-only: a mistake is undone by a reversal (a new negative row that
-- points at the original), never by editing or deleting history.
CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  invoice_id         uuid NOT NULL,
  amount_kobo        bigint NOT NULL CHECK (amount_kobo <> 0),
  method             text NOT NULL CHECK (method IN ('cash', 'transfer', 'pos')),
  paid_at            timestamptz NOT NULL DEFAULT now(),
  note               text CHECK (length(note) <= 300),
  -- Set only on a reversal; UNIQUE so a payment can be reversed once.
  reverses_payment_id uuid UNIQUE,
  client_request_id  uuid NOT NULL,
  created_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (invoice_id, workspace_id) REFERENCES invoices (id, workspace_id),
  FOREIGN KEY (reverses_payment_id, workspace_id) REFERENCES payments (id, workspace_id),
  UNIQUE (id, workspace_id),
  CONSTRAINT payments_request_per_workspace UNIQUE (workspace_id, client_request_id),
  -- Positive = money in; negative = a reversal, and only a reversal.
  CHECK ((reverses_payment_id IS NULL) = (amount_kobo > 0))
);
-- An invoice's payment history and the amount-paid check.
CREATE INDEX payments_invoice_idx ON payments (invoice_id);
-- "Payments received" in reports and the payments list.
CREATE INDEX payments_ws_paid_idx ON payments (workspace_id, paid_at DESC, id DESC);

-- A reversal must exactly cancel one positive payment of the same invoice.
CREATE FUNCTION payments_check_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original payments%ROWTYPE;
BEGIN
  IF NEW.reverses_payment_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO original FROM payments WHERE id = NEW.reverses_payment_id;
  IF NOT FOUND OR original.amount_kobo <= 0 OR original.invoice_id <> NEW.invoice_id OR NEW.amount_kobo <> -original.amount_kobo THEN
    RAISE EXCEPTION 'a reversal must cancel exactly one payment of the same invoice' USING ERRCODE = '23514', CONSTRAINT = 'payments_check_reversal';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_check_reversal BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION payments_check_reversal();

-- amount_paid_kobo = SUM(payments), checked at COMMIT.
CREATE FUNCTION invoice_paid_matches_payments() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  stored bigint;
  summed bigint;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN target := NEW.id; ELSE target := NEW.invoice_id; END IF;
  SELECT amount_paid_kobo INTO stored FROM invoices WHERE id = target;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(amount_kobo), 0) INTO summed FROM payments WHERE invoice_id = target;
  IF stored <> summed THEN
    RAISE EXCEPTION 'amount paid % does not match payments %', stored, summed
      USING ERRCODE = '23514', CONSTRAINT = 'invoice_paid_matches_payments';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER invoices_paid_matches_payments AFTER INSERT OR UPDATE ON invoices
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION invoice_paid_matches_payments();
CREATE CONSTRAINT TRIGGER payments_paid_matches AFTER INSERT ON payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION invoice_paid_matches_payments();

-- Ledgers are append-only. Rows may only disappear together with their
-- workspace (by then the workspace row is already gone).
CREATE FUNCTION ledger_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id) THEN
    RAISE EXCEPTION '% is append-only: record a reversal or adjustment instead', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- ----------------------------------------------------------------- expenses
CREATE TABLE expenses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  -- A fixed list keeps the expense breakdown meaningful.
  category          text NOT NULL CHECK (category IN ('stock', 'rent', 'salaries', 'transport', 'utilities', 'marketing', 'equipment', 'other')),
  amount_kobo       bigint NOT NULL CHECK (amount_kobo > 0),
  spent_on          date NOT NULL,
  note              text CHECK (length(note) <= 300),
  -- A reference only ("blue file, receipt 41"); file uploads are out of scope.
  receipt_ref       text CHECK (length(receipt_ref) <= 120),
  client_request_id uuid NOT NULL,
  created_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, workspace_id),
  CONSTRAINT expenses_request_per_workspace UNIQUE (workspace_id, client_request_id)
);
-- Date-range reports and the expenses list.
CREATE INDEX expenses_ws_spent_idx ON expenses (workspace_id, spent_on DESC, id DESC);
CREATE TRIGGER expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
