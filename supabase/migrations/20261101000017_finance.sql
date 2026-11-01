-- =============================================================================
-- 0017 Finance
--   bank accounts · customer invoices & credit notes (from delivered goods) ·
--   customer receipts with allocation · supplier bills with three-way match ·
--   supplier payments · expenses with approval · e-invoicing transmission queue ·
--   receivables / payables views · credit exposure from invoices.
-- Amounts are stored in document currency with the rate to AED; *_base = AED.
-- =============================================================================

create type public.invoice_kind as enum ('invoice', 'credit_note');
create type public.invoice_status as enum ('draft', 'posted', 'partially_paid', 'paid', 'void');
create type public.einvoice_status as enum ('not_enabled', 'queued', 'submitted', 'accepted', 'rejected', 'failed');
create type public.bill_status as enum ('draft', 'pending_approval', 'approved', 'partially_paid', 'paid', 'void');
create type public.payment_method as enum ('bank_transfer', 'cheque', 'cash', 'card', 'pdc', 'other');
create type public.expense_status as enum ('draft', 'submitted', 'approved', 'rejected', 'paid', 'cancelled');

-- ---------------------------------------------------------------------------
-- Company e-invoicing settings (UAE: PINT AE via an FTA-accredited ASP)
-- ---------------------------------------------------------------------------
alter table public.company_settings
  add column einvoicing_enabled   boolean not null default false,
  add column einvoice_provider    text,          -- display name of the Accredited Service Provider
  add column einvoice_participant_id text,       -- our Peppol participant identifier (e.g. 0235:1XXXXXXXXXXXXXX)
  add column invoice_terms        text not null default '',
  add column invoice_footer       text;

-- ---------------------------------------------------------------------------
-- Bank & cash accounts
-- ---------------------------------------------------------------------------
create table public.bank_accounts (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique check (length(trim(name)) > 0),
  kind           text not null default 'bank' check (kind in ('bank', 'cash', 'card')),
  bank_name      text,
  account_no     text,
  iban           text check (iban is null or iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  swift          text,
  currency_code  char(3) not null default 'AED' references public.currencies(code),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id)
);
select public.attach_standard_triggers('public.bank_accounts');

-- ---------------------------------------------------------------------------
-- Customer invoices and credit notes
-- ---------------------------------------------------------------------------
create table public.customer_invoices (
  id                    uuid primary key default gen_random_uuid(),
  kind                  public.invoice_kind not null default 'invoice',
  doc_no                text unique,                  -- assigned when posted (gap-free)
  credit_for_invoice_id uuid references public.customer_invoices(id),
  customer_id           uuid not null references public.customers(id),
  sales_order_id        uuid references public.sales_orders(id),
  invoice_date          date not null default current_date,
  supply_date           date,
  due_date              date,
  payment_term_id       uuid references public.payment_terms(id),
  currency_code         char(3) not null references public.currencies(code),
  exchange_rate         numeric(18,6) not null default 1 check (exchange_rate > 0),
  customer_name         text not null,               -- snapshots printed on the tax invoice
  customer_trn          text,
  billing_address       text,
  customer_reference    text,
  reason                text,                        -- credit notes: why
  net_total             numeric(18,2) not null default 0,
  tax_total             numeric(18,2) not null default 0,
  total                 numeric(18,2) not null default 0,
  total_base            numeric(18,2) not null default 0,
  amount_paid           numeric(18,2) not null default 0 check (amount_paid >= 0),
  amount_credited       numeric(18,2) not null default 0 check (amount_credited >= 0),
  balance               numeric(18,2) generated always as (total - amount_paid - amount_credited) stored,
  status                public.invoice_status not null default 'draft',
  posted_at             timestamptz,
  posted_by             uuid references public.profiles(id),
  void_reason           text,
  voided_at             timestamptz,
  voided_by             uuid references public.profiles(id),
  einvoice_status       public.einvoice_status not null default 'not_enabled',
  einvoice_uuid         uuid not null default gen_random_uuid(),
  einvoice_ref          text,
  einvoice_message      text,
  einvoice_updated_at   timestamptz,
  notes                 text,
  terms                 text,
  created_at            timestamptz not null default now(),
  created_by            uuid references public.profiles(id),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles(id),
  constraint ci_balance_nonneg check (balance >= 0 or status = 'void'),
  constraint ci_credit_link check ((kind = 'credit_note') = (credit_for_invoice_id is not null)),
  constraint ci_credit_no_payments check (kind = 'invoice' or (amount_paid = 0 and amount_credited = 0)),
  constraint ci_posted_number check (status = 'draft' or doc_no is not null),
  constraint ci_void_reason check (status <> 'void' or coalesce(trim(void_reason), '') <> ''),
  constraint ci_due check (due_date is null or due_date >= invoice_date)
);
create index customer_invoices_customer_idx on public.customer_invoices(customer_id, invoice_date desc);
create index customer_invoices_status_idx on public.customer_invoices(status, due_date);
create index customer_invoices_so_idx on public.customer_invoices(sales_order_id);
create index customer_invoices_einv_idx on public.customer_invoices(einvoice_status) where einvoice_status in ('queued', 'failed');
select public.attach_standard_triggers('public.customer_invoices');

create table public.customer_invoice_lines (
  id                     uuid primary key default gen_random_uuid(),
  invoice_id             uuid not null references public.customer_invoices(id) on delete cascade,
  line_no                integer not null check (line_no > 0),
  sales_order_line_id    uuid references public.sales_order_lines(id),
  delivery_note_line_id  uuid references public.delivery_note_lines(id),
  credited_line_id       uuid references public.customer_invoice_lines(id),
  product_id             uuid references public.products(id),
  description            text not null check (length(trim(description)) > 0),
  uom_code               text,
  qty                    numeric(18,3) not null check (qty > 0),
  unit_price             numeric(18,4) not null check (unit_price >= 0),
  discount_pct           numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_code_id            uuid not null references public.tax_codes(id),
  tax_category           text not null,               -- SR / ZR / EX / OS for the e-invoice
  tax_rate               numeric(5,2) not null check (tax_rate >= 0),
  gross_amount           numeric(18,2) generated always as (round(qty * unit_price, 2)) stored,
  discount_amount        numeric(18,2) generated always as (round(round(qty * unit_price, 2) * discount_pct / 100, 2)) stored,
  net_amount             numeric(18,2) generated always as (round(qty * unit_price, 2) - round(round(qty * unit_price, 2) * discount_pct / 100, 2)) stored,
  tax_amount             numeric(18,2) generated always as
                           (round((round(qty * unit_price, 2) - round(round(qty * unit_price, 2) * discount_pct / 100, 2)) * tax_rate / 100, 2)) stored,
  line_total             numeric(18,2) generated always as
                           ((round(qty * unit_price, 2) - round(round(qty * unit_price, 2) * discount_pct / 100, 2))
                            + round((round(qty * unit_price, 2) - round(round(qty * unit_price, 2) * discount_pct / 100, 2)) * tax_rate / 100, 2)) stored,
  unique (invoice_id, line_no)
);
create index on public.customer_invoice_lines(delivery_note_line_id);
create index on public.customer_invoice_lines(sales_order_line_id);
select public.attach_standard_triggers('public.customer_invoice_lines', false);

create or replace function public.customer_invoices_recalc(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.customer_invoices i set net_total = coalesce(s.net, 0), tax_total = coalesce(s.tax, 0), total = coalesce(s.tot, 0),
    total_base = round(coalesce(s.tot, 0) * i.exchange_rate, 2)
  from (select sum(net_amount) net, sum(tax_amount) tax, sum(line_total) tot from public.customer_invoice_lines where invoice_id = p_id) s
  where i.id = p_id;
end $$;
create or replace function public.customer_invoice_lines_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.customer_invoices_recalc(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;
create trigger customer_invoice_lines_totals after insert or update or delete on public.customer_invoice_lines
  for each row execute function public.customer_invoice_lines_after();

-- Posted invoices are legal documents: only payments/credits/status/e-invoice fields may change.
create or replace function public.customer_invoices_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception using errcode = 'P0001', hint = 'locked', message = 'Posted invoices cannot be deleted. Void the invoice or issue a credit note.'; end if;
    return old;
  end if;
  if old.status <> 'draft' and coalesce(current_setting('smp.allow_locked_edit', true), '') <> 'on'
     and (new.customer_id, new.invoice_date, new.currency_code, new.exchange_rate, new.total, new.doc_no, new.kind)
         is distinct from (old.customer_id, old.invoice_date, old.currency_code, old.exchange_rate, old.total, old.doc_no, old.kind) then
    raise exception using errcode = 'P0001', hint = 'locked', message = 'A posted invoice cannot be changed.';
  end if;
  return new;
end $$;
create trigger customer_invoices_guard before update or delete on public.customer_invoices
  for each row execute function public.customer_invoices_guard();

create or replace function public.customer_invoice_lines_guard()
returns trigger language plpgsql as $$
begin
  if (select status from public.customer_invoices where id = coalesce(new.invoice_id, old.invoice_id)) <> 'draft'
     and coalesce(current_setting('smp.allow_locked_edit', true), '') <> 'on' then
    raise exception using errcode = 'P0001', hint = 'locked', message = 'A posted invoice cannot be changed.';
  end if;
  return coalesce(new, old);
end $$;
create trigger customer_invoice_lines_guard before insert or update or delete on public.customer_invoice_lines
  for each row execute function public.customer_invoice_lines_guard();

-- ---------------------------------------------------------------------------
-- E-invoicing transmission log (one row per attempt to send to the ASP)
-- ---------------------------------------------------------------------------
create table public.einvoice_transmissions (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.customer_invoices(id),
  status          text not null default 'queued' check (status in ('queued', 'sending', 'submitted', 'accepted', 'rejected', 'failed')),
  attempt         integer not null default 0,
  provider        text,
  provider_ref    text,
  request_payload jsonb,
  response        jsonb,
  error           text,
  next_attempt_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index einvoice_transmissions_queue_idx on public.einvoice_transmissions(status, next_attempt_at);
create index on public.einvoice_transmissions(invoice_id);

-- ---------------------------------------------------------------------------
-- Customer receipts
-- ---------------------------------------------------------------------------
create table public.customer_payments (
  id               uuid primary key default gen_random_uuid(),
  doc_no           text not null unique,
  customer_id      uuid not null references public.customers(id),
  payment_date     date not null default current_date,
  method           public.payment_method not null,
  bank_account_id  uuid references public.bank_accounts(id),
  reference        text,                    -- transfer ref / cheque no.
  cheque_date      date,
  currency_code    char(3) not null references public.currencies(code),
  exchange_rate    numeric(18,6) not null default 1 check (exchange_rate > 0),
  amount           numeric(18,2) not null check (amount > 0),
  amount_base      numeric(18,2) generated always as (round(amount * exchange_rate, 2)) stored,
  amount_allocated numeric(18,2) not null default 0 check (amount_allocated >= 0),
  unallocated      numeric(18,2) generated always as (amount - amount_allocated) stored,
  status           text not null default 'posted' check (status in ('posted', 'void')),
  void_reason      text,
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id),
  constraint cp_alloc_le_amount check (amount_allocated <= amount),
  constraint cp_bank_needed check (method in ('cash', 'other') or bank_account_id is not null)
);
create index customer_payments_customer_idx on public.customer_payments(customer_id, payment_date desc);
select public.attach_standard_triggers('public.customer_payments');

create table public.customer_payment_allocations (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references public.customer_payments(id),
  invoice_id  uuid not null references public.customer_invoices(id),
  amount      numeric(18,2) not null check (amount > 0),
  is_reversed boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create index on public.customer_payment_allocations(payment_id);
create index on public.customer_payment_allocations(invoice_id);
select public.attach_standard_triggers('public.customer_payment_allocations', false);

-- ---------------------------------------------------------------------------
-- Supplier bills (three-way match: PO ↔ goods received ↔ bill)
-- ---------------------------------------------------------------------------
create table public.supplier_bills (
  id                  uuid primary key default gen_random_uuid(),
  doc_no              text not null unique,
  supplier_id         uuid not null references public.suppliers(id),
  purchase_order_id   uuid references public.purchase_orders(id),
  supplier_invoice_no text not null check (length(trim(supplier_invoice_no)) > 0),
  supplier_trn        text,
  bill_date           date not null,
  due_date            date,
  currency_code       char(3) not null references public.currencies(code),
  exchange_rate       numeric(18,6) not null default 1 check (exchange_rate > 0),
  net_total           numeric(18,2) not null default 0,
  tax_total           numeric(18,2) not null default 0,
  total               numeric(18,2) not null default 0,
  total_base          numeric(18,2) not null default 0,
  amount_paid         numeric(18,2) not null default 0 check (amount_paid >= 0),
  balance             numeric(18,2) generated always as (total - amount_paid) stored,
  status              public.bill_status not null default 'draft',
  max_variance_pct    numeric(8,2),
  approved_at         timestamptz,
  approved_by         uuid references public.profiles(id),
  void_reason         text,
  attachment_path     text,
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id),
  constraint sb_balance check (balance >= 0 or status = 'void'),
  constraint sb_due check (due_date is null or due_date >= bill_date),
  constraint sb_void_reason check (status <> 'void' or coalesce(trim(void_reason), '') <> '')
);
-- The same supplier invoice cannot be entered twice.
create unique index supplier_bills_no_dup on public.supplier_bills(supplier_id, lower(supplier_invoice_no)) where status <> 'void';
create index supplier_bills_status_idx on public.supplier_bills(status, due_date);
select public.attach_standard_triggers('public.supplier_bills');

create table public.supplier_bill_lines (
  id                     uuid primary key default gen_random_uuid(),
  bill_id                uuid not null references public.supplier_bills(id) on delete cascade,
  line_no                integer not null check (line_no > 0),
  purchase_order_line_id uuid references public.purchase_order_lines(id),
  product_id             uuid references public.products(id),
  description            text not null check (length(trim(description)) > 0),
  qty                    numeric(18,3) not null check (qty > 0),
  unit_cost              numeric(18,4) not null check (unit_cost >= 0),
  po_unit_cost           numeric(18,4),
  variance_pct           numeric(8,2) generated always as
                           (case when po_unit_cost > 0 then round((unit_cost - po_unit_cost) / po_unit_cost * 100, 2) end) stored,
  tax_code_id            uuid not null references public.tax_codes(id),
  tax_rate               numeric(5,2) not null check (tax_rate >= 0),
  net_amount             numeric(18,2) generated always as (round(qty * unit_cost, 2)) stored,
  tax_amount             numeric(18,2) generated always as (round(round(qty * unit_cost, 2) * tax_rate / 100, 2)) stored,
  line_total             numeric(18,2) generated always as (round(qty * unit_cost, 2) + round(round(qty * unit_cost, 2) * tax_rate / 100, 2)) stored,
  unique (bill_id, line_no)
);
create index on public.supplier_bill_lines(purchase_order_line_id);
select public.attach_standard_triggers('public.supplier_bill_lines', false);

create or replace function public.supplier_bills_recalc(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.supplier_bills b set net_total = coalesce(s.net, 0), tax_total = coalesce(s.tax, 0), total = coalesce(s.tot, 0),
    total_base = round(coalesce(s.tot, 0) * b.exchange_rate, 2), max_variance_pct = s.var
  from (select sum(net_amount) net, sum(tax_amount) tax, sum(line_total) tot, max(abs(variance_pct)) var
          from public.supplier_bill_lines where bill_id = p_id) s
  where b.id = p_id;
end $$;
create or replace function public.supplier_bill_lines_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.supplier_bills_recalc(coalesce(new.bill_id, old.bill_id));
  return null;
end $$;
create trigger supplier_bill_lines_totals after insert or update or delete on public.supplier_bill_lines
  for each row execute function public.supplier_bill_lines_after();
create or replace function public.supplier_bill_lines_guard()
returns trigger language plpgsql as $$
begin
  if (select status from public.supplier_bills where id = coalesce(new.bill_id, old.bill_id)) <> 'draft'
     and coalesce(current_setting('smp.allow_locked_edit', true), '') <> 'on' then
    raise exception using errcode = 'P0001', hint = 'locked', message = 'Only draft bills can be changed.';
  end if;
  return coalesce(new, old);
end $$;
create trigger supplier_bill_lines_guard before insert or update or delete on public.supplier_bill_lines
  for each row execute function public.supplier_bill_lines_guard();

-- ---------------------------------------------------------------------------
-- Supplier payments
-- ---------------------------------------------------------------------------
create table public.supplier_payments (
  id               uuid primary key default gen_random_uuid(),
  doc_no           text not null unique,
  supplier_id      uuid not null references public.suppliers(id),
  payment_date     date not null default current_date,
  method           public.payment_method not null,
  bank_account_id  uuid references public.bank_accounts(id),
  reference        text,
  cheque_date      date,
  currency_code    char(3) not null references public.currencies(code),
  exchange_rate    numeric(18,6) not null default 1 check (exchange_rate > 0),
  amount           numeric(18,2) not null check (amount > 0),
  amount_base      numeric(18,2) generated always as (round(amount * exchange_rate, 2)) stored,
  amount_allocated numeric(18,2) not null default 0 check (amount_allocated >= 0),
  unallocated      numeric(18,2) generated always as (amount - amount_allocated) stored,
  status           text not null default 'posted' check (status in ('posted', 'void')),
  void_reason      text,
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id),
  constraint sp_alloc_le_amount check (amount_allocated <= amount),
  constraint sp_bank_needed check (method in ('cash', 'other') or bank_account_id is not null)
);
create index supplier_payments_supplier_idx on public.supplier_payments(supplier_id, payment_date desc);
select public.attach_standard_triggers('public.supplier_payments');

create table public.supplier_payment_allocations (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references public.supplier_payments(id),
  bill_id     uuid not null references public.supplier_bills(id),
  amount      numeric(18,2) not null check (amount > 0),
  is_reversed boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);
create index on public.supplier_payment_allocations(payment_id);
create index on public.supplier_payment_allocations(bill_id);
select public.attach_standard_triggers('public.supplier_payment_allocations', false);

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
create table public.expense_categories (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,
  is_active boolean not null default true
);
insert into public.expense_categories(name) values
  ('Fuel'), ('Vehicle maintenance'), ('Salik & parking'), ('Travel'), ('Meals & entertainment'), ('Office supplies'),
  ('Telephone & internet'), ('Courier & postage'), ('Visa & government fees'), ('Rent & utilities'), ('Bank charges'),
  ('Marketing'), ('Repairs & maintenance'), ('Other');

create table public.expenses (
  id              uuid primary key default gen_random_uuid(),
  doc_no          text not null unique,
  expense_date    date not null,
  category_id     uuid not null references public.expense_categories(id),
  description     text not null check (length(trim(description)) > 0),
  vendor_name     text,
  vendor_trn      text check (vendor_trn is null or vendor_trn ~ '^[0-9]{15}$'),
  receipt_no      text,
  amount          numeric(18,2) not null check (amount > 0),          -- before VAT, AED
  vat_amount      numeric(18,2) not null default 0 check (vat_amount >= 0),
  total           numeric(18,2) generated always as (amount + vat_amount) stored,
  paid_by         text not null default 'employee' check (paid_by in ('employee', 'company')),
  sales_order_id  uuid references public.sales_orders(id),          -- optional: cost of a customer job
  status          public.expense_status not null default 'draft',
  rejection_reason text,
  approved_at     timestamptz,
  approved_by     uuid references public.profiles(id),
  paid_at         date,
  paid_from_account_id uuid references public.bank_accounts(id),
  payment_reference text,
  receipt_path    text,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id),
  constraint exp_vat_limit check (vat_amount <= round(amount * 0.05, 2) + 0.01)
);
create index expenses_owner_idx on public.expenses(created_by, expense_date desc);
create index expenses_status_idx on public.expenses(status);
select public.attach_standard_triggers('public.expenses');

insert into public.approval_rules (doc_type, name, metric, comparison, threshold, approver_permission) values
  ('supplier_bill', 'Bill price above PO price by more than 2%', 'price_variance_pct', 'gt', 2, 'payable.approve'),
  ('expense', 'Every expense claim', 'total_base', 'gt', 0, 'expense.approve');

-- =============================================================================
-- HELPERS
-- =============================================================================
-- Delivered quantity of a delivery note line not yet on an invoice (posted or another draft).
create or replace function public.dn_line_uninvoiced_qty(p_line uuid, p_excluding_invoice uuid default null)
returns numeric language sql stable security definer set search_path = public as $$
  select greatest(dl.qty - dl.qty_invoiced - coalesce((select sum(il.qty) from public.customer_invoice_lines il
           join public.customer_invoices i on i.id = il.invoice_id
          where il.delivery_note_line_id = dl.id and i.status = 'draft' and i.kind = 'invoice' and i.id is distinct from p_excluding_invoice), 0), 0)
  from public.delivery_note_lines dl join public.delivery_notes d on d.id = dl.delivery_note_id
  where dl.id = p_line and d.status in ('dispatched', 'delivered');
$$;

create or replace function public.customer_invoices_refresh_status(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.customer_invoices set status = case
      when balance <= 0 then 'paid' when amount_paid > 0 or amount_credited > 0 then 'partially_paid' else 'posted' end::public.invoice_status
  where id = p_id and kind = 'invoice' and status in ('posted', 'partially_paid', 'paid');
end $$;

create or replace function public.supplier_bills_refresh_status(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.supplier_bills set status = case
      when balance <= 0 then 'paid' when amount_paid > 0 then 'partially_paid' else 'approved' end::public.bill_status
  where id = p_id and status in ('approved', 'partially_paid', 'paid');
end $$;

-- Order is "invoiced" once fulfilled and every line is fully invoiced.
create or replace function public.sales_orders_refresh_invoicing(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_id is null then return; end if;
  update public.sales_orders so set status = 'invoiced'
   where so.id = p_id and so.status = 'fulfilled'
     and not exists (select 1 from public.sales_order_lines l where l.sales_order_id = so.id and not l.is_cancelled and l.qty_invoiced < l.qty);
  update public.sales_orders so set status = 'fulfilled'
   where so.id = p_id and so.status = 'invoiced'
     and exists (select 1 from public.sales_order_lines l where l.sales_order_id = so.id and not l.is_cancelled and l.qty_invoiced < l.qty);
end $$;

-- Credit exposure = uninvoiced value of open orders + unpaid invoice balances (AED).
create or replace function public.customer_credit_position(p_customer_id uuid,
  out credit_limit numeric, out open_orders_base numeric, out available numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_orders numeric; v_invoices numeric;
begin
  select c.credit_limit into credit_limit from public.customers c where c.id = p_customer_id;
  select coalesce(sum(round(l.line_total * (l.qty - l.qty_invoiced) / l.qty * so.exchange_rate, 2)), 0) into v_orders
    from public.sales_orders so join public.sales_order_lines l on l.sales_order_id = so.id and not l.is_cancelled
   where so.customer_id = p_customer_id and so.status in ('confirmed', 'partially_fulfilled', 'fulfilled', 'on_hold') and l.qty_invoiced < l.qty;
  select coalesce(sum(round(balance * exchange_rate, 2)), 0) into v_invoices
    from public.customer_invoices where customer_id = p_customer_id and kind = 'invoice' and status in ('posted', 'partially_paid');
  open_orders_base := v_orders + v_invoices;
  available := case when credit_limit > 0 then credit_limit - open_orders_base end;
end $$;
revoke execute on function public.customer_credit_position(uuid) from public, anon, authenticated;

-- =============================================================================
-- CUSTOMER INVOICES
-- =============================================================================
-- Draft invoice for everything delivered but not yet invoiced on an order
-- (optionally only some delivery notes). Prices come from the sales order.
create or replace function public.create_invoice_from_deliveries(p_sales_order_id uuid, p_delivery_note_ids uuid[] default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  so public.sales_orders; c public.customers; v_id uuid; v_n integer := 0; r record; v_addr text;
begin
  perform public.require_permission('invoice.create');
  select * into so from public.sales_orders where id = p_sales_order_id;
  if not found then perform public.raise_business_error('not_found', 'Sales order not found.'); end if;
  if so.status in ('draft', 'pending_approval', 'cancelled') then
    perform public.raise_business_error('invalid_state', 'Only confirmed orders can be invoiced.');
  end if;
  select * into c from public.customers where id = so.customer_id;
  select concat_ws(', ', a.line1, a.line2, a.city, a.emirate, case when a.po_box is not null then 'P.O. Box ' || a.po_box end, a.country)
    into v_addr from public.customer_addresses a
   where a.id = so.billing_address_id or (so.billing_address_id is null and a.customer_id = c.id and a.kind = 'billing')
   order by (a.id = so.billing_address_id) desc nulls last, a.is_default desc limit 1;

  insert into public.customer_invoices(customer_id, sales_order_id, invoice_date, supply_date, payment_term_id, currency_code, exchange_rate,
    customer_name, customer_trn, billing_address, customer_reference, terms)
  values (c.id, so.id, current_date, null, coalesce(so.payment_term_id, c.payment_term_id), so.currency_code, so.exchange_rate,
    c.name, c.trn, v_addr, so.customer_po_ref, (select invoice_terms from public.company_settings))
  returning id into v_id;

  for r in
    select dl.id as dnl_id, dl.sales_order_line_id, d.delivery_date, d.doc_no as dn_no, l.product_id, l.description, l.unit_price, l.discount_pct,
           l.tax_code_id, l.tax_rate, t.code as tax_category, u.code as uom_code, public.dn_line_uninvoiced_qty(dl.id, v_id) as q
      from public.delivery_note_lines dl
      join public.delivery_notes d on d.id = dl.delivery_note_id
      join public.sales_order_lines l on l.id = dl.sales_order_line_id
      join public.tax_codes t on t.id = l.tax_code_id
      join public.products p on p.id = l.product_id
      join public.units_of_measure u on u.id = p.uom_id
     where d.sales_order_id = so.id and d.status in ('dispatched', 'delivered')
       and (p_delivery_note_ids is null or d.id = any (p_delivery_note_ids))
     order by d.delivery_date, d.doc_no, l.line_no
  loop
    continue when r.q <= 0;
    v_n := v_n + 1;
    insert into public.customer_invoice_lines(invoice_id, line_no, sales_order_line_id, delivery_note_line_id, product_id, description, uom_code,
      qty, unit_price, discount_pct, tax_code_id, tax_category, tax_rate)
    values (v_id, v_n, r.sales_order_line_id, r.dnl_id, r.product_id, r.description || ' (DN ' || r.dn_no || ')', r.uom_code,
      r.q, r.unit_price, r.discount_pct, r.tax_code_id, r.tax_category, r.tax_rate);
  end loop;
  if v_n = 0 then
    perform public.raise_business_error('nothing_to_do', 'Nothing has been delivered that is not already invoiced (or on a draft invoice).');
  end if;
  update public.customer_invoices set supply_date = (select max(d.delivery_date) from public.delivery_notes d
     join public.delivery_note_lines dl on dl.delivery_note_id = d.id join public.customer_invoice_lines il on il.delivery_note_line_id = dl.id
    where il.invoice_id = v_id) where id = v_id;
  return v_id;
end $$;

-- Edit a draft: header fields, quantities of delivered lines (prices stay as ordered),
-- and extra charge lines (freight, installation…) entered by hand.
create or replace function public.save_invoice_draft(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid; inv public.customer_invoices; c public.customers;
  v_line jsonb; v_n integer := 0; v_old public.customer_invoice_lines; v_tax public.tax_codes; v_avail numeric; v_rate numeric;
  v_ccy char(3); v_keep jsonb := '[]'::jsonb; v_new jsonb;
begin
  perform public.require_permission('invoice.create');
  if v_id is not null then
    select * into inv from public.customer_invoices where id = v_id for update;
    if not found then perform public.raise_business_error('not_found', 'Invoice not found.'); end if;
    if inv.status <> 'draft' then perform public.raise_business_error('locked', 'Only draft invoices can be edited.'); end if;
    if inv.kind <> 'invoice' then perform public.raise_business_error('validation', 'Edit credit notes from their own screen.'); end if;
  else
    -- Direct invoice (no sales order), e.g. services.
    select * into c from public.customers where id = nullif(p->>'customer_id', '')::uuid;
    if not found then perform public.raise_business_error('validation', 'Select the customer.'); end if;
    v_ccy := coalesce(nullif(p->>'currency_code', ''), c.currency_code);
    v_rate := case when v_ccy = public.base_currency() then 1 else coalesce(nullif(p->>'exchange_rate', '')::numeric, public.rate_to_base(v_ccy)) end;
    if v_rate is null then perform public.raise_business_error('validation', format('Enter the exchange rate for %s.', v_ccy)); end if;
    insert into public.customer_invoices(customer_id, currency_code, exchange_rate, payment_term_id, customer_name, customer_trn, billing_address, terms)
    values (c.id, v_ccy, v_rate, c.payment_term_id, c.name, c.trn,
      (select concat_ws(', ', line1, line2, city, emirate, country) from public.customer_addresses where customer_id = c.id and kind = 'billing' order by is_default desc limit 1),
      (select invoice_terms from public.company_settings))
    returning * into inv;
    v_id := inv.id;
  end if;

  update public.customer_invoices set
    invoice_date = coalesce(nullif(p->>'invoice_date', '')::date, invoice_date),
    supply_date = coalesce(nullif(p->>'supply_date', '')::date, supply_date),
    due_date = nullif(p->>'due_date', '')::date,
    payment_term_id = coalesce(nullif(p->>'payment_term_id', '')::uuid, payment_term_id),
    customer_reference = coalesce(nullif(trim(p->>'customer_reference'), ''), customer_reference),
    billing_address = coalesce(nullif(trim(p->>'billing_address'), ''), billing_address),
    notes = nullif(trim(p->>'notes'), ''),
    terms = coalesce(p->>'terms', terms)
  where id = v_id;
  if (select invoice_date from public.customer_invoices where id = v_id) > current_date then
    perform public.raise_business_error('validation', 'The invoice date cannot be in the future.');
  end if;

  if p ? 'lines' then
    -- Keep delivered lines (new quantities), replace hand-entered lines.
    for v_line in select * from jsonb_array_elements(p->'lines') loop
      if nullif(v_line->>'id', '') is not null then
        select * into v_old from public.customer_invoice_lines where id = (v_line->>'id')::uuid and invoice_id = v_id;
        if not found then perform public.raise_business_error('validation', 'An invoice line does not belong to this invoice.'); end if;
        if coalesce((v_line->>'qty')::numeric, 0) <= 0 then continue; end if;
        if v_old.delivery_note_line_id is not null then
          v_avail := public.dn_line_uninvoiced_qty(v_old.delivery_note_line_id, v_id);
          if (v_line->>'qty')::numeric > v_avail then
            perform public.raise_business_error('validation', format('%s: only %s delivered and not yet invoiced.', v_old.description, v_avail));
          end if;
        end if;
        v_keep := v_keep || to_jsonb(v_old.id);
        update public.customer_invoice_lines set qty = (v_line->>'qty')::numeric where id = v_old.id;
        if v_old.delivery_note_line_id is null then
          select * into v_tax from public.tax_codes where id = coalesce(nullif(v_line->>'tax_code_id', '')::uuid, v_old.tax_code_id);
          update public.customer_invoice_lines set description = coalesce(nullif(trim(v_line->>'description'), ''), description),
            unit_price = coalesce(nullif(v_line->>'unit_price', '')::numeric, unit_price), tax_code_id = v_tax.id, tax_rate = v_tax.rate, tax_category = v_tax.code
          where id = v_old.id;
        end if;
      else
        if coalesce(trim(v_line->>'description'), '') = '' or coalesce((v_line->>'qty')::numeric, 0) <= 0 or coalesce((v_line->>'unit_price')::numeric, -1) < 0 then
          perform public.raise_business_error('validation', 'Each extra line needs a description, quantity and price.');
        end if;
        select * into v_tax from public.tax_codes where id = coalesce(nullif(v_line->>'tax_code_id', '')::uuid, (select id from public.tax_codes where is_default));
        insert into public.customer_invoice_lines(invoice_id, line_no, product_id, description, uom_code, qty, unit_price, tax_code_id, tax_category, tax_rate)
        values (v_id, 1000 + jsonb_array_length(v_keep), nullif(v_line->>'product_id', '')::uuid, trim(v_line->>'description'), nullif(v_line->>'uom_code', ''),
          (v_line->>'qty')::numeric, (v_line->>'unit_price')::numeric, v_tax.id, v_tax.code, v_tax.rate)
        returning to_jsonb(id) into v_new;
        v_keep := v_keep || v_new;
      end if;
    end loop;
    delete from public.customer_invoice_lines where invoice_id = v_id and not (to_jsonb(id) <@ v_keep);
    -- Renumber 1..n.
    update public.customer_invoice_lines l set line_no = l.line_no + 100000 where invoice_id = v_id;
    update public.customer_invoice_lines l set line_no = s.rn
      from (select id, row_number() over (order by line_no) rn from public.customer_invoice_lines where invoice_id = v_id) s where s.id = l.id;
  end if;
  return v_id;
end $$;

create or replace function public.delete_invoice_draft(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('invoice.create');
  delete from public.customer_invoices where id = p_id and status = 'draft';
  if not found then perform public.raise_business_error('invalid_state', 'Only draft invoices can be deleted.'); end if;
end $$;

-- E-invoice queue entry when the mandate is switched on.
create or replace function public.einvoice_enqueue(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.company_settings;
begin
  select * into s from public.company_settings;
  if not s.einvoicing_enabled then
    update public.customer_invoices set einvoice_status = 'not_enabled' where id = p_invoice_id;
    return;
  end if;
  insert into public.einvoice_transmissions(invoice_id, provider) values (p_invoice_id, s.einvoice_provider);
  update public.customer_invoices set einvoice_status = 'queued', einvoice_updated_at = now(), einvoice_message = null where id = p_invoice_id;
end $$;

-- Issue the invoice (or credit note): number, due date, quantity counters, e-invoice queue.
create or replace function public.post_invoice(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  inv public.customer_invoices; orig public.customer_invoices; l public.customer_invoice_lines; c public.customers;
  v_avail numeric; v_days integer; v_prev text := coalesce(current_setting('smp.allow_locked_edit', true), ''); v_no text;
begin
  perform public.require_permission('invoice.post');
  select * into inv from public.customer_invoices where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Invoice not found.'); end if;
  if inv.status <> 'draft' then perform public.raise_business_error('invalid_state', 'This document has already been posted.'); end if;
  if not exists (select 1 from public.customer_invoice_lines where invoice_id = p_id) then
    perform public.raise_business_error('validation', 'The invoice has no lines.');
  end if;
  if inv.total <= 0 then perform public.raise_business_error('validation', 'The total must be greater than zero.'); end if;
  select * into c from public.customers where id = inv.customer_id;
  if c.vat_registered and coalesce(inv.customer_trn, c.trn) is null then
    perform public.raise_business_error('validation', 'The customer is VAT-registered but has no TRN. Add the TRN to the customer first — it must appear on the tax invoice.');
  end if;
  if inv.invoice_date > current_date then perform public.raise_business_error('validation', 'The invoice date cannot be in the future.'); end if;

  perform set_config('smp.allow_locked_edit', 'on', true);
  if inv.kind = 'invoice' then
    for l in select * from public.customer_invoice_lines where invoice_id = p_id and delivery_note_line_id is not null loop
      perform 1 from public.delivery_note_lines where id = l.delivery_note_line_id for update;
      v_avail := public.dn_line_uninvoiced_qty(l.delivery_note_line_id, p_id);
      if l.qty > v_avail then
        perform public.raise_business_error('validation', format('%s: only %s delivered and not yet invoiced.', l.description, v_avail));
      end if;
      update public.delivery_note_lines set qty_invoiced = qty_invoiced + l.qty where id = l.delivery_note_line_id;
      update public.sales_order_lines set qty_invoiced = qty_invoiced + l.qty where id = l.sales_order_line_id;
    end loop;
    select days into v_days from public.payment_terms where id = inv.payment_term_id;
    v_no := public.next_document_number('invoice', inv.invoice_date);
    update public.customer_invoices set doc_no = v_no, status = 'posted', posted_at = now(), posted_by = auth.uid(),
      customer_trn = coalesce(customer_trn, c.trn), supply_date = coalesce(supply_date, invoice_date),
      due_date = coalesce(due_date, invoice_date + coalesce(v_days, 0))
    where id = p_id;
    perform public.sales_orders_refresh_invoicing(inv.sales_order_id);
  else
    select * into orig from public.customer_invoices where id = inv.credit_for_invoice_id for update;
    if orig.status not in ('posted', 'partially_paid') then
      perform public.raise_business_error('invalid_state', format('Invoice %s is %s; credit notes can only reduce an unpaid balance.', orig.doc_no, orig.status));
    end if;
    if inv.total > orig.balance then
      perform public.raise_business_error('validation', format('The credit note (%s) is more than the invoice balance (%s).', inv.total, orig.balance));
    end if;
    v_no := public.next_document_number('credit_note', inv.invoice_date);
    update public.customer_invoices set doc_no = v_no, status = 'posted', posted_at = now(), posted_by = auth.uid(),
      supply_date = coalesce(supply_date, invoice_date), due_date = invoice_date where id = p_id;
    update public.customer_invoices set amount_credited = amount_credited + inv.total where id = orig.id;
    perform public.customer_invoices_refresh_status(orig.id);
  end if;
  perform set_config('smp.allow_locked_edit', v_prev, true);
  perform public.einvoice_enqueue(p_id);
  return v_no;
end $$;

-- Void: only unpaid, uncredited invoices that the tax authority has not received.
create or replace function public.void_invoice(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare inv public.customer_invoices; l public.customer_invoice_lines; v_prev text := coalesce(current_setting('smp.allow_locked_edit', true), '');
begin
  perform public.require_permission('invoice.void');
  if coalesce(trim(p_reason), '') = '' then perform public.raise_business_error('validation', 'Please give a reason for voiding.'); end if;
  select * into inv from public.customer_invoices where id = p_id for update;
  if not found or inv.status not in ('posted') or inv.amount_paid > 0 or inv.amount_credited > 0 then
    perform public.raise_business_error('invalid_state', 'Only posted invoices with no payments or credit notes can be voided.');
  end if;
  if inv.einvoice_status in ('submitted', 'accepted') then
    perform public.raise_business_error('invalid_state', 'This invoice has been reported through e-invoicing. Issue a credit note instead of voiding it.');
  end if;
  perform set_config('smp.allow_locked_edit', 'on', true);
  if inv.kind = 'invoice' then
    for l in select * from public.customer_invoice_lines where invoice_id = p_id and delivery_note_line_id is not null loop
      update public.delivery_note_lines set qty_invoiced = qty_invoiced - l.qty where id = l.delivery_note_line_id;
      update public.sales_order_lines set qty_invoiced = qty_invoiced - l.qty where id = l.sales_order_line_id;
    end loop;
  else
    update public.customer_invoices set amount_credited = amount_credited - inv.total where id = inv.credit_for_invoice_id;
    perform public.customer_invoices_refresh_status(inv.credit_for_invoice_id);
  end if;
  update public.customer_invoices set status = 'void', void_reason = trim(p_reason), voided_at = now(), voided_by = auth.uid() where id = p_id;
  update public.einvoice_transmissions set status = 'failed', error = 'Invoice voided before transmission', updated_at = now()
   where invoice_id = p_id and status in ('queued', 'failed');
  perform set_config('smp.allow_locked_edit', v_prev, true);
  perform public.sales_orders_refresh_invoicing(inv.sales_order_id);
end $$;

-- Credit note against a posted invoice: whole invoice, or chosen lines/quantities.
create or replace function public.create_credit_note(p_invoice_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare orig public.customer_invoices; v_id uuid; l public.customer_invoice_lines; v_q numeric; v_n integer := 0; v_sel jsonb := p->'lines';
begin
  perform public.require_permission('invoice.create');
  select * into orig from public.customer_invoices where id = p_invoice_id;
  if not found or orig.kind <> 'invoice' or orig.status not in ('posted', 'partially_paid') then
    perform public.raise_business_error('invalid_state', 'Credit notes can only be raised against a posted invoice with a balance.');
  end if;
  if coalesce(trim(p->>'reason'), '') = '' then perform public.raise_business_error('validation', 'Enter the reason for the credit note (it is printed on the document).'); end if;
  insert into public.customer_invoices(kind, credit_for_invoice_id, customer_id, sales_order_id, invoice_date, currency_code, exchange_rate,
    customer_name, customer_trn, billing_address, customer_reference, reason)
  values ('credit_note', orig.id, orig.customer_id, orig.sales_order_id, current_date, orig.currency_code, orig.exchange_rate,
    orig.customer_name, orig.customer_trn, orig.billing_address, orig.doc_no, trim(p->>'reason'))
  returning id into v_id;
  for l in select * from public.customer_invoice_lines where invoice_id = orig.id order by line_no loop
    v_q := case when v_sel is null then l.qty
                else (select (x->>'qty')::numeric from jsonb_array_elements(v_sel) x where x->>'invoice_line_id' = l.id::text) end;
    continue when coalesce(v_q, 0) <= 0;
    if v_q > l.qty then perform public.raise_business_error('validation', format('%s: cannot credit more than the %s invoiced.', l.description, l.qty)); end if;
    v_n := v_n + 1;
    insert into public.customer_invoice_lines(invoice_id, line_no, credited_line_id, product_id, description, uom_code, qty, unit_price, discount_pct,
      tax_code_id, tax_category, tax_rate)
    values (v_id, v_n, l.id, l.product_id, l.description, l.uom_code, v_q,
      coalesce((select (x->>'unit_price')::numeric from jsonb_array_elements(v_sel) x where x->>'invoice_line_id' = l.id::text and x ? 'unit_price'), l.unit_price),
      l.discount_pct, l.tax_code_id, l.tax_category, l.tax_rate);
  end loop;
  if v_n = 0 then perform public.raise_business_error('validation', 'Choose at least one line to credit.'); end if;
  return v_id;
end $$;

-- Retry a failed or rejected e-invoice after the data has been corrected.
create or replace function public.retry_einvoice(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('invoice.post');
  if not exists (select 1 from public.customer_invoices where id = p_invoice_id and status <> 'void' and status <> 'draft' and einvoice_status in ('failed', 'rejected', 'not_enabled')) then
    perform public.raise_business_error('invalid_state', 'Only failed, rejected or unsent posted invoices can be sent again.');
  end if;
  perform public.einvoice_enqueue(p_invoice_id);
end $$;

-- =============================================================================
-- E-INVOICING — called only by the server-side dispatcher (service role)
-- =============================================================================
-- Structured invoice data for the PINT AE (UBL) document.
create or replace function public.einvoice_document(p_invoice_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'invoice', to_jsonb(i) - 'created_by' - 'updated_by',
    'original_invoice', (select jsonb_build_object('doc_no', o.doc_no, 'invoice_date', o.invoice_date, 'einvoice_uuid', o.einvoice_uuid) from public.customer_invoices o where o.id = i.credit_for_invoice_id),
    'seller', (select jsonb_build_object('legal_name', s.legal_name, 'trade_name', s.trade_name, 'trn', s.trn, 'address', s.address, 'city', s.city,
                 'country', s.country, 'email', s.email, 'phone', s.phone, 'participant_id', s.einvoice_participant_id) from public.company_settings s),
    'buyer', (select jsonb_build_object('name', i.customer_name, 'trn', i.customer_trn, 'address', i.billing_address, 'email', c.email, 'phone', c.phone,
                 'customer_type', c.customer_type, 'code', c.code) from public.customers c where c.id = i.customer_id),
    'payment_terms', (select name from public.payment_terms where id = i.payment_term_id),
    'lines', (select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'description', l.description, 'sku', p.sku, 'uom', l.uom_code, 'qty', l.qty,
                 'unit_price', l.unit_price, 'discount_pct', l.discount_pct, 'gross', l.gross_amount, 'discount', l.discount_amount,
                 'net', l.net_amount, 'tax_category', l.tax_category, 'tax_rate', l.tax_rate, 'tax', l.tax_amount, 'total', l.line_total) order by l.line_no)
              from public.customer_invoice_lines l left join public.products p on p.id = l.product_id where l.invoice_id = i.id))
  from public.customer_invoices i where i.id = p_invoice_id;
$$;

-- Claim a batch of queued transmissions (skip-locked so parallel runs don't collide).
create or replace function public.einvoice_claim_batch(p_limit integer default 10)
returns table (transmission_id uuid, invoice_id uuid, attempt integer, document jsonb)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with c as (
    select t.id from public.einvoice_transmissions t
     where t.status in ('queued', 'failed') and t.next_attempt_at <= now() and t.attempt < 8
     order by t.created_at limit p_limit for update skip locked
  ), u as (
    update public.einvoice_transmissions t set status = 'sending', attempt = t.attempt + 1, updated_at = now()
      from c where t.id = c.id returning t.id, t.invoice_id, t.attempt
  )
  select u.id, u.invoice_id, u.attempt, public.einvoice_document(u.invoice_id) from u;
end $$;

create or replace function public.einvoice_record_result(p_transmission_id uuid, p_status text, p_provider_ref text,
  p_request jsonb, p_response jsonb, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare t public.einvoice_transmissions;
begin
  if p_status not in ('submitted', 'accepted', 'rejected', 'failed') then raise exception 'Invalid e-invoice status %', p_status; end if;
  update public.einvoice_transmissions set status = p_status, provider_ref = coalesce(p_provider_ref, provider_ref), request_payload = p_request,
    response = p_response, error = p_error, updated_at = now(),
    -- Back off on transport failures: 5, 10, 20 … minutes.
    next_attempt_at = case when p_status = 'failed' then now() + make_interval(mins => 5 * power(2, greatest(attempt - 1, 0))::int) else next_attempt_at end
  where id = p_transmission_id returning * into t;
  perform set_config('smp.allow_locked_edit', 'on', true);
  update public.customer_invoices set einvoice_status = p_status::public.einvoice_status, einvoice_ref = coalesce(p_provider_ref, einvoice_ref),
    einvoice_message = p_error, einvoice_updated_at = now() where id = t.invoice_id;
  perform set_config('smp.allow_locked_edit', 'off', true);
  if p_status in ('rejected') or (p_status = 'failed' and t.attempt >= 8) then
    perform public.notify_permission_holders('invoice.post', 'E-invoice ' || p_status,
      (select doc_no from public.customer_invoices where id = t.invoice_id) || ': ' || coalesce(p_error, ''), '/invoices/' || t.invoice_id);
  end if;
end $$;

revoke execute on function public.einvoice_document(uuid) from public, anon, authenticated;
revoke execute on function public.einvoice_claim_batch(integer) from public, anon, authenticated;
revoke execute on function public.einvoice_record_result(uuid, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.einvoice_claim_batch(integer) to service_role;
grant execute on function public.einvoice_record_result(uuid, text, text, jsonb, jsonb, text) to service_role;
grant execute on function public.einvoice_document(uuid) to service_role;

-- =============================================================================
-- CUSTOMER RECEIPTS
-- =============================================================================
create or replace function public.allocate_customer_payment(p_payment_id uuid, p_allocations jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare pay public.customer_payments; a jsonb; inv public.customer_invoices; v_amt numeric; v_prev text := coalesce(current_setting('smp.allow_locked_edit', true), '');
begin
  perform public.require_permission('payment.record');
  select * into pay from public.customer_payments where id = p_payment_id for update;
  if not found or pay.status <> 'posted' then perform public.raise_business_error('invalid_state', 'Payment not found or void.'); end if;
  for a in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_amt := round(coalesce((a->>'amount')::numeric, 0), 2);
    continue when v_amt = 0;
    if v_amt < 0 then perform public.raise_business_error('validation', 'Allocated amounts must be positive.'); end if;
    select * into inv from public.customer_invoices where id = (a->>'invoice_id')::uuid for update;
    if not found or inv.kind <> 'invoice' or inv.status not in ('posted', 'partially_paid') or inv.customer_id <> pay.customer_id then
      perform public.raise_business_error('validation', 'Payments can only be allocated to this customer''s open invoices.');
    end if;
    if inv.currency_code <> pay.currency_code then
      perform public.raise_business_error('validation', format('Invoice %s is in %s; the payment is in %s.', inv.doc_no, inv.currency_code, pay.currency_code));
    end if;
    if v_amt > inv.balance then perform public.raise_business_error('validation', format('Invoice %s only has %s outstanding.', inv.doc_no, inv.balance)); end if;
    if v_amt > pay.amount - pay.amount_allocated then
      perform public.raise_business_error('validation', format('Only %s of this payment is left to allocate.', pay.amount - pay.amount_allocated));
    end if;
    insert into public.customer_payment_allocations(payment_id, invoice_id, amount) values (pay.id, inv.id, v_amt);
    update public.customer_payments set amount_allocated = amount_allocated + v_amt where id = pay.id returning * into pay;
    perform set_config('smp.allow_locked_edit', 'on', true);
    update public.customer_invoices set amount_paid = amount_paid + v_amt where id = inv.id;
    perform set_config('smp.allow_locked_edit', v_prev, true);
    perform public.customer_invoices_refresh_status(inv.id);
  end loop;
end $$;

create or replace function public.record_customer_payment(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; c public.customers; v_ccy char(3); v_rate numeric; v_date date := coalesce(nullif(p->>'payment_date', '')::date, current_date);
begin
  perform public.require_permission('payment.record');
  select * into c from public.customers where id = nullif(p->>'customer_id', '')::uuid;
  if not found then perform public.raise_business_error('validation', 'Select the customer.'); end if;
  if coalesce((p->>'amount')::numeric, 0) <= 0 then perform public.raise_business_error('validation', 'Enter the amount received.'); end if;
  if v_date > current_date then perform public.raise_business_error('validation', 'The payment date cannot be in the future.'); end if;
  if p->>'method' in ('cheque', 'pdc') and coalesce(trim(p->>'reference'), '') = '' then
    perform public.raise_business_error('validation', 'Enter the cheque number.');
  end if;
  v_ccy := coalesce(nullif(p->>'currency_code', ''), c.currency_code);
  v_rate := case when v_ccy = public.base_currency() then 1 else coalesce(nullif(p->>'exchange_rate', '')::numeric, public.rate_to_base(v_ccy, v_date)) end;
  if v_rate is null then perform public.raise_business_error('validation', format('Enter the exchange rate for %s.', v_ccy)); end if;
  if nullif(p->>'bank_account_id', '') is not null and not exists (select 1 from public.bank_accounts where id = (p->>'bank_account_id')::uuid and is_active) then
    perform public.raise_business_error('validation', 'Choose an active bank account.');
  end if;
  insert into public.customer_payments(doc_no, customer_id, payment_date, method, bank_account_id, reference, cheque_date, currency_code, exchange_rate, amount, notes)
  values (public.next_document_number('customer_payment', v_date), c.id, v_date, (p->>'method')::public.payment_method,
    nullif(p->>'bank_account_id', '')::uuid, nullif(trim(p->>'reference'), ''), nullif(p->>'cheque_date', '')::date, v_ccy, v_rate,
    round((p->>'amount')::numeric, 2), nullif(trim(p->>'notes'), ''))
  returning id into v_id;
  perform public.allocate_customer_payment(v_id, p->'allocations');
  return v_id;
end $$;

create or replace function public.void_customer_payment(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare pay public.customer_payments; a public.customer_payment_allocations; v_prev text := coalesce(current_setting('smp.allow_locked_edit', true), '');
begin
  perform public.require_permission('payment.void');
  if coalesce(trim(p_reason), '') = '' then perform public.raise_business_error('validation', 'Please give a reason (e.g. bounced cheque).'); end if;
  select * into pay from public.customer_payments where id = p_id for update;
  if not found or pay.status <> 'posted' then perform public.raise_business_error('invalid_state', 'Payment not found or already void.'); end if;
  perform set_config('smp.allow_locked_edit', 'on', true);
  for a in select * from public.customer_payment_allocations where payment_id = p_id and not is_reversed loop
    update public.customer_invoices set amount_paid = amount_paid - a.amount where id = a.invoice_id;
    update public.customer_invoices set status = 'posted' where id = a.invoice_id and status = 'paid';
    perform public.customer_invoices_refresh_status(a.invoice_id);
    update public.customer_payment_allocations set is_reversed = true where id = a.id;
  end loop;
  perform set_config('smp.allow_locked_edit', v_prev, true);
  update public.customer_payments set status = 'void', void_reason = trim(p_reason), amount_allocated = 0 where id = p_id;
end $$;

-- =============================================================================
-- SUPPLIER BILLS
-- =============================================================================
create or replace function public.po_line_unbilled_qty(p_line uuid, p_excluding_bill uuid default null)
returns numeric language sql stable security definer set search_path = public as $$
  select greatest(l.qty_received - l.qty_billed - coalesce((select sum(bl.qty) from public.supplier_bill_lines bl
            join public.supplier_bills b on b.id = bl.bill_id
           where bl.purchase_order_line_id = l.id and b.status in ('draft', 'pending_approval') and b.id is distinct from p_excluding_bill), 0), 0)
  from public.purchase_order_lines l where l.id = p_line;
$$;

create or replace function public.save_supplier_bill(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid; b public.supplier_bills; s public.suppliers; po public.purchase_orders;
  v_ccy char(3); v_rate numeric; v_line jsonb; v_n integer := 0; pol public.purchase_order_lines; v_tax public.tax_codes;
  v_avail numeric; v_date date := nullif(p->>'bill_date', '')::date; v_days integer;
begin
  perform public.require_permission('payable.manage');
  if v_id is not null then
    select * into b from public.supplier_bills where id = v_id for update;
    if not found then perform public.raise_business_error('not_found', 'Bill not found.'); end if;
    if b.status <> 'draft' then perform public.raise_business_error('locked', 'Only draft bills can be edited.'); end if;
  end if;
  select * into s from public.suppliers where id = nullif(p->>'supplier_id', '')::uuid;
  if not found then perform public.raise_business_error('validation', 'Select the supplier.'); end if;
  if coalesce(trim(p->>'supplier_invoice_no'), '') = '' then perform public.raise_business_error('validation', 'Enter the supplier''s invoice number.'); end if;
  if v_date is null or v_date > current_date then perform public.raise_business_error('validation', 'Enter the supplier invoice date (not in the future).'); end if;
  if exists (select 1 from public.supplier_bills where supplier_id = s.id and lower(supplier_invoice_no) = lower(trim(p->>'supplier_invoice_no'))
              and status <> 'void' and id is distinct from v_id) then
    perform public.raise_business_error('duplicate', format('Supplier invoice %s from %s has already been entered.', trim(p->>'supplier_invoice_no'), s.name));
  end if;
  if nullif(p->>'purchase_order_id', '') is not null then
    select * into po from public.purchase_orders where id = (p->>'purchase_order_id')::uuid;
    if not found or po.supplier_id <> s.id then perform public.raise_business_error('validation', 'The purchase order belongs to another supplier.'); end if;
    v_ccy := po.currency_code;
  end if;
  v_ccy := coalesce(v_ccy, nullif(p->>'currency_code', ''), s.currency_code);
  v_rate := case when v_ccy = public.base_currency() then 1
                 else coalesce(nullif(p->>'exchange_rate', '')::numeric, po.exchange_rate, public.rate_to_base(v_ccy, v_date)) end;
  if v_rate is null then perform public.raise_business_error('validation', format('Enter the exchange rate for %s.', v_ccy)); end if;
  select days into v_days from public.payment_terms where id = s.payment_term_id;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then perform public.raise_business_error('validation', 'Add at least one line.'); end if;

  if v_id is null then
    insert into public.supplier_bills(doc_no, supplier_id, purchase_order_id, supplier_invoice_no, supplier_trn, bill_date, due_date, currency_code, exchange_rate, notes, attachment_path)
    values (public.next_document_number('supplier_bill', v_date), s.id, po.id, trim(p->>'supplier_invoice_no'), coalesce(nullif(trim(p->>'supplier_trn'), ''), s.trn),
      v_date, coalesce(nullif(p->>'due_date', '')::date, v_date + coalesce(v_days, 0)), v_ccy, v_rate, nullif(trim(p->>'notes'), ''), nullif(p->>'attachment_path', ''))
    returning id into v_id;
  else
    update public.supplier_bills set supplier_id = s.id, purchase_order_id = po.id, supplier_invoice_no = trim(p->>'supplier_invoice_no'),
      supplier_trn = coalesce(nullif(trim(p->>'supplier_trn'), ''), s.trn), bill_date = v_date,
      due_date = coalesce(nullif(p->>'due_date', '')::date, v_date + coalesce(v_days, 0)), currency_code = v_ccy, exchange_rate = v_rate,
      notes = nullif(trim(p->>'notes'), ''), attachment_path = coalesce(nullif(p->>'attachment_path', ''), attachment_path)
    where id = v_id;
    delete from public.supplier_bill_lines where bill_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p->'lines') loop
    continue when coalesce((v_line->>'qty')::numeric, 0) = 0;
    v_n := v_n + 1;
    if (v_line->>'qty')::numeric < 0 or coalesce((v_line->>'unit_cost')::numeric, -1) < 0 then
      perform public.raise_business_error('validation', format('Line %s: enter quantity and unit cost.', v_n));
    end if;
    pol := null;
    if nullif(v_line->>'purchase_order_line_id', '') is not null then
      select * into pol from public.purchase_order_lines where id = (v_line->>'purchase_order_line_id')::uuid;
      if not found or pol.purchase_order_id is distinct from po.id then
        perform public.raise_business_error('validation', format('Line %s is not on the selected purchase order.', v_n));
      end if;
      v_avail := public.po_line_unbilled_qty(pol.id, v_id);
      if (v_line->>'qty')::numeric > v_avail then
        perform public.raise_business_error('validation',
          format('%s: only %s received and not yet billed. Bills cannot be for more than the goods received.', pol.description, v_avail));
      end if;
    end if;
    select * into v_tax from public.tax_codes where id = coalesce(nullif(v_line->>'tax_code_id', '')::uuid, pol.tax_code_id, (select id from public.tax_codes where is_default));
    insert into public.supplier_bill_lines(bill_id, line_no, purchase_order_line_id, product_id, description, qty, unit_cost, po_unit_cost, tax_code_id, tax_rate)
    values (v_id, v_n, pol.id, coalesce(pol.product_id, nullif(v_line->>'product_id', '')::uuid),
      coalesce(nullif(trim(v_line->>'description'), ''), pol.description), (v_line->>'qty')::numeric, (v_line->>'unit_cost')::numeric,
      pol.unit_cost, v_tax.id, v_tax.rate);
  end loop;
  if v_n = 0 then perform public.raise_business_error('validation', 'Enter a quantity on at least one line.'); end if;
  return v_id;
end $$;

create or replace function public.supplier_bill_apply_approval(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l public.supplier_bill_lines; v_prev text := coalesce(current_setting('smp.allow_locked_edit', true), '');
begin
  perform set_config('smp.allow_locked_edit', 'on', true);
  for l in select * from public.supplier_bill_lines where bill_id = p_id and purchase_order_line_id is not null loop
    update public.purchase_order_lines set qty_billed = qty_billed + l.qty where id = l.purchase_order_line_id;
  end loop;
  perform set_config('smp.allow_locked_edit', v_prev, true);
  update public.supplier_bills set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = p_id;
end $$;

-- Three-way match on submit: quantities are already limited to goods received;
-- price differences against the PO (or a bill without a PO) need approval.
create or replace function public.submit_supplier_bill(p_id uuid)
returns public.bill_status language plpgsql security definer set search_path = public as $$
declare b public.supplier_bills; r public.approval_rules; v_reasons text[] := '{}'; v_approver text := 'payable.approve'; l public.supplier_bill_lines;
begin
  perform public.require_permission('payable.manage');
  select * into b from public.supplier_bills where id = p_id for update;
  if not found or b.status <> 'draft' then perform public.raise_business_error('invalid_state', 'Only draft bills can be submitted.'); end if;
  for l in select * from public.supplier_bill_lines where bill_id = p_id and purchase_order_line_id is not null loop
    if l.qty > public.po_line_unbilled_qty(l.purchase_order_line_id, p_id) then
      perform public.raise_business_error('validation', format('%s: more than the goods received and not yet billed.', l.description));
    end if;
  end loop;
  if not exists (select 1 from public.supplier_bill_lines where bill_id = p_id and purchase_order_line_id is not null) then
    v_reasons := v_reasons || 'Bill without a purchase order'::text;
  end if;
  for r in select * from public.approval_rules where doc_type = 'supplier_bill' and is_active loop
    if r.metric = 'price_variance_pct' and coalesce(b.max_variance_pct, 0) > r.threshold then
      v_reasons := v_reasons || format('%s (%s%%)', r.name, b.max_variance_pct);
      v_approver := r.approver_permission;
    elsif r.metric = 'total_base' and ((r.comparison = 'gt' and b.total_base > r.threshold) or (r.comparison = 'lt' and b.total_base < r.threshold)) then
      v_reasons := v_reasons || r.name;
      v_approver := r.approver_permission;
    end if;
  end loop;
  if cardinality(v_reasons) > 0 then
    update public.supplier_bills set status = 'pending_approval' where id = p_id;
    insert into public.approval_requests(doc_type, doc_id, doc_no, reasons, approver_permission, requested_by)
    values ('supplier_bill', p_id, b.doc_no, v_reasons, v_approver, auth.uid());
    perform public.notify_permission_holders(v_approver, 'Supplier bill awaiting approval', b.doc_no || ': ' || array_to_string(v_reasons, '; '), '/payables/bills/' || p_id);
    return 'pending_approval';
  end if;
  perform public.supplier_bill_apply_approval(p_id);
  return 'approved';
end $$;

create or replace function public.void_supplier_bill(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare b public.supplier_bills; l public.supplier_bill_lines; v_prev text := coalesce(current_setting('smp.allow_locked_edit', true), '');
begin
  perform public.require_permission('payable.approve');
  if coalesce(trim(p_reason), '') = '' then perform public.raise_business_error('validation', 'Please give a reason for voiding.'); end if;
  select * into b from public.supplier_bills where id = p_id for update;
  if not found or b.status not in ('draft', 'pending_approval', 'approved') or b.amount_paid > 0 then
    perform public.raise_business_error('invalid_state', 'Only unpaid bills can be voided.');
  end if;
  if b.status = 'approved' then
    perform set_config('smp.allow_locked_edit', 'on', true);
    for l in select * from public.supplier_bill_lines where bill_id = p_id and purchase_order_line_id is not null loop
      update public.purchase_order_lines set qty_billed = qty_billed - l.qty where id = l.purchase_order_line_id;
    end loop;
    perform set_config('smp.allow_locked_edit', v_prev, true);
  end if;
  update public.approval_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where doc_type = 'supplier_bill' and doc_id = p_id and status = 'pending';
  update public.supplier_bills set status = 'void', void_reason = trim(p_reason) where id = p_id;
end $$;

-- =============================================================================
-- SUPPLIER PAYMENTS
-- =============================================================================
create or replace function public.record_supplier_payment(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; s public.suppliers; v_ccy char(3); v_rate numeric; a jsonb; b public.supplier_bills; v_amt numeric; v_left numeric;
  v_date date := coalesce(nullif(p->>'payment_date', '')::date, current_date);
begin
  perform public.require_permission('payable.manage');
  select * into s from public.suppliers where id = nullif(p->>'supplier_id', '')::uuid;
  if not found then perform public.raise_business_error('validation', 'Select the supplier.'); end if;
  if coalesce((p->>'amount')::numeric, 0) <= 0 then perform public.raise_business_error('validation', 'Enter the amount paid.'); end if;
  if v_date > current_date + 180 then perform public.raise_business_error('validation', 'Payment date is too far ahead.'); end if;
  v_ccy := coalesce(nullif(p->>'currency_code', ''), s.currency_code);
  v_rate := case when v_ccy = public.base_currency() then 1 else coalesce(nullif(p->>'exchange_rate', '')::numeric, public.rate_to_base(v_ccy, least(v_date, current_date))) end;
  if v_rate is null then perform public.raise_business_error('validation', format('Enter the exchange rate for %s.', v_ccy)); end if;
  if jsonb_array_length(coalesce(p->'allocations', '[]'::jsonb)) = 0 then
    perform public.raise_business_error('validation', 'Choose the approved bills this payment settles.');
  end if;
  insert into public.supplier_payments(doc_no, supplier_id, payment_date, method, bank_account_id, reference, cheque_date, currency_code, exchange_rate, amount, notes)
  values (public.next_document_number('supplier_payment', least(v_date, current_date)), s.id, v_date, (p->>'method')::public.payment_method,
    nullif(p->>'bank_account_id', '')::uuid, nullif(trim(p->>'reference'), ''), nullif(p->>'cheque_date', '')::date, v_ccy, v_rate,
    round((p->>'amount')::numeric, 2), nullif(trim(p->>'notes'), ''))
  returning id into v_id;
  v_left := round((p->>'amount')::numeric, 2);
  for a in select * from jsonb_array_elements(p->'allocations') loop
    v_amt := round(coalesce((a->>'amount')::numeric, 0), 2);
    continue when v_amt = 0;
    select * into b from public.supplier_bills where id = (a->>'bill_id')::uuid for update;
    if not found or b.supplier_id <> s.id or b.status not in ('approved', 'partially_paid') then
      perform public.raise_business_error('validation', 'Payments can only settle this supplier''s approved bills.');
    end if;
    if b.currency_code <> v_ccy then perform public.raise_business_error('validation', format('Bill %s is in %s; the payment is in %s.', b.doc_no, b.currency_code, v_ccy)); end if;
    if v_amt < 0 or v_amt > b.balance then perform public.raise_business_error('validation', format('Bill %s only has %s outstanding.', b.doc_no, b.balance)); end if;
    if v_amt > v_left then perform public.raise_business_error('validation', 'The allocations are more than the payment amount.'); end if;
    v_left := v_left - v_amt;
    insert into public.supplier_payment_allocations(payment_id, bill_id, amount) values (v_id, b.id, v_amt);
    update public.supplier_bills set amount_paid = amount_paid + v_amt where id = b.id;
    perform public.supplier_bills_refresh_status(b.id);
  end loop;
  update public.supplier_payments set amount_allocated = amount - v_left where id = v_id;
  return v_id;
end $$;

create or replace function public.void_supplier_payment(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare pay public.supplier_payments; a public.supplier_payment_allocations;
begin
  perform public.require_permission('payable.approve');
  if coalesce(trim(p_reason), '') = '' then perform public.raise_business_error('validation', 'Please give a reason.'); end if;
  select * into pay from public.supplier_payments where id = p_id for update;
  if not found or pay.status <> 'posted' then perform public.raise_business_error('invalid_state', 'Payment not found or already void.'); end if;
  for a in select * from public.supplier_payment_allocations where payment_id = p_id and not is_reversed loop
    update public.supplier_bills set amount_paid = amount_paid - a.amount where id = a.bill_id;
    update public.supplier_bills set status = 'approved' where id = a.bill_id and status = 'paid';
    perform public.supplier_bills_refresh_status(a.bill_id);
    update public.supplier_payment_allocations set is_reversed = true where id = a.id;
  end loop;
  update public.supplier_payments set status = 'void', void_reason = trim(p_reason), amount_allocated = 0 where id = p_id;
end $$;

-- =============================================================================
-- EXPENSES
-- =============================================================================
create or replace function public.save_expense(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; e public.expenses; v_date date := nullif(p->>'expense_date', '')::date;
begin
  perform public.require_permission('expense.submit');
  if v_id is not null then
    select * into e from public.expenses where id = v_id for update;
    if not found or e.created_by <> auth.uid() then perform public.raise_business_error('forbidden', 'You can only edit your own expense claims.'); end if;
    if e.status not in ('draft', 'rejected') then perform public.raise_business_error('locked', 'Submitted expenses cannot be edited.'); end if;
  end if;
  if v_date is null or v_date > current_date then perform public.raise_business_error('validation', 'Enter the expense date (not in the future).'); end if;
  if v_date < current_date - 120 then perform public.raise_business_error('validation', 'Expenses older than 120 days cannot be claimed.'); end if;
  if coalesce((p->>'amount')::numeric, 0) <= 0 then perform public.raise_business_error('validation', 'Enter the amount before VAT.'); end if;
  if coalesce((p->>'vat_amount')::numeric, 0) > round((p->>'amount')::numeric * 0.05, 2) + 0.01 then
    perform public.raise_business_error('validation', 'VAT cannot be more than 5% of the amount.');
  end if;
  if coalesce((p->>'vat_amount')::numeric, 0) > 0 and nullif(regexp_replace(coalesce(p->>'vendor_trn', ''), '\s', '', 'g'), '') is null then
    perform public.raise_business_error('validation', 'Enter the vendor''s TRN to claim VAT (it is on the tax invoice).');
  end if;
  if v_id is null then
    insert into public.expenses(doc_no, expense_date, category_id, description, vendor_name, vendor_trn, receipt_no, amount, vat_amount, paid_by, sales_order_id, notes)
    values (public.next_document_number('expense', v_date), v_date, (p->>'category_id')::uuid, trim(p->>'description'), nullif(trim(p->>'vendor_name'), ''),
      nullif(regexp_replace(coalesce(p->>'vendor_trn', ''), '\s', '', 'g'), ''), nullif(trim(p->>'receipt_no'), ''), round((p->>'amount')::numeric, 2),
      round(coalesce((p->>'vat_amount')::numeric, 0), 2), coalesce(nullif(p->>'paid_by', ''), 'employee'), nullif(p->>'sales_order_id', '')::uuid, nullif(trim(p->>'notes'), ''))
    returning id into v_id;
  else
    update public.expenses set expense_date = v_date, category_id = (p->>'category_id')::uuid, description = trim(p->>'description'),
      vendor_name = nullif(trim(p->>'vendor_name'), ''), vendor_trn = nullif(regexp_replace(coalesce(p->>'vendor_trn', ''), '\s', '', 'g'), ''),
      receipt_no = nullif(trim(p->>'receipt_no'), ''), amount = round((p->>'amount')::numeric, 2), vat_amount = round(coalesce((p->>'vat_amount')::numeric, 0), 2),
      paid_by = coalesce(nullif(p->>'paid_by', ''), 'employee'), sales_order_id = nullif(p->>'sales_order_id', '')::uuid, notes = nullif(trim(p->>'notes'), ''),
      status = 'draft', rejection_reason = null
    where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.set_expense_receipt(p_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_path not like 'expenses/' || p_id || '/%' then perform public.raise_business_error('validation', 'Invalid receipt file.'); end if;
  update public.expenses set receipt_path = p_path where id = p_id and created_by = auth.uid() and status in ('draft', 'rejected');
  if not found then perform public.raise_business_error('forbidden', 'You can only attach receipts to your own draft claims.'); end if;
end $$;

create or replace function public.submit_expense(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e public.expenses; r public.approval_rules; v_reasons text[] := '{}'; v_approver text := 'expense.approve';
begin
  perform public.require_permission('expense.submit');
  select * into e from public.expenses where id = p_id for update;
  if not found or e.created_by <> auth.uid() then perform public.raise_business_error('forbidden', 'You can only submit your own expense claims.'); end if;
  if e.status not in ('draft', 'rejected') then perform public.raise_business_error('invalid_state', 'This claim has already been submitted.'); end if;
  for r in select * from public.approval_rules where doc_type = 'expense' and is_active and metric = 'total_base' loop
    if (r.comparison = 'gt' and e.total > r.threshold) or (r.comparison = 'lt' and e.total < r.threshold) then
      v_reasons := v_reasons || format('%s (AED %s)', r.name, e.total); v_approver := r.approver_permission;
    end if;
  end loop;
  if cardinality(v_reasons) = 0 then
    update public.expenses set status = 'approved', approved_at = now() where id = p_id;
    return;
  end if;
  update public.expenses set status = 'submitted', rejection_reason = null where id = p_id;
  insert into public.approval_requests(doc_type, doc_id, doc_no, reasons, approver_permission, requested_by)
  values ('expense', p_id, e.doc_no, v_reasons, v_approver, auth.uid());
  perform public.notify_permission_holders(v_approver, 'Expense claim to approve', e.doc_no || ' · AED ' || e.total, '/expenses/' || p_id);
end $$;

create or replace function public.cancel_expense(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.approval_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where doc_type = 'expense' and doc_id = p_id and status = 'pending';
  update public.expenses set status = 'cancelled' where id = p_id and created_by = auth.uid() and status in ('draft', 'submitted', 'rejected');
  if not found then perform public.raise_business_error('invalid_state', 'Only your own unapproved claims can be cancelled.'); end if;
end $$;

create or replace function public.mark_expense_paid(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_date date := coalesce(nullif(p->>'paid_at', '')::date, current_date);
begin
  perform public.require_permission('expense.pay');
  if v_date > current_date then perform public.raise_business_error('validation', 'The payment date cannot be in the future.'); end if;
  if nullif(p->>'bank_account_id', '') is null then perform public.raise_business_error('validation', 'Choose the account it was paid from.'); end if;
  update public.expenses set status = 'paid', paid_at = v_date, paid_from_account_id = (p->>'bank_account_id')::uuid,
    payment_reference = nullif(trim(p->>'reference'), '') where id = p_id and status = 'approved';
  if not found then perform public.raise_business_error('invalid_state', 'Only approved expenses can be marked as paid.'); end if;
end $$;

-- =============================================================================
-- APPROVAL ROUTING for purchase orders, supplier bills and expenses
-- =============================================================================
create or replace function public.decide_approval_extension(a public.approval_requests, p_approve boolean, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if a.doc_type = 'purchase_order' then
    if p_approve then perform public.purchase_order_apply_approval(a.doc_id);
    else update public.purchase_orders set status = 'draft' where id = a.doc_id and status = 'pending_approval'; end if;
    perform public.notify_user(a.requested_by, 'Purchase order ' || a.doc_no || case when p_approve then ' approved' else ' rejected' end, p_comment, '/purchase-orders/' || a.doc_id);
  elsif a.doc_type = 'supplier_bill' then
    if p_approve then perform public.supplier_bill_apply_approval(a.doc_id);
    else update public.supplier_bills set status = 'draft' where id = a.doc_id and status = 'pending_approval'; end if;
    perform public.notify_user(a.requested_by, 'Supplier bill ' || a.doc_no || case when p_approve then ' approved' else ' returned' end, p_comment, '/payables/bills/' || a.doc_id);
  elsif a.doc_type = 'expense' then
    if p_approve then update public.expenses set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = a.doc_id and status = 'submitted';
    else update public.expenses set status = 'rejected', rejection_reason = trim(p_comment) where id = a.doc_id and status = 'submitted'; end if;
    perform public.notify_user(a.requested_by, 'Expense ' || a.doc_no || case when p_approve then ' approved' else ' rejected' end, p_comment, '/expenses/' || a.doc_id);
  else
    perform public.raise_business_error('invalid_state', format('No approval handler for %s.', a.doc_type));
  end if;
end $$;

-- =============================================================================
-- VIEWS (security_invoker: the caller's RLS applies)
-- =============================================================================
create or replace view public.v_receivables with (security_invoker = true) as
select i.id, i.doc_no, i.customer_id, i.customer_name, i.sales_order_id, i.invoice_date, i.due_date, i.currency_code, i.exchange_rate,
       i.total, i.balance, round(i.balance * i.exchange_rate, 2) as balance_base, i.status,
       greatest(current_date - i.due_date, 0) as days_overdue,
       case when i.due_date >= current_date then 'current' when current_date - i.due_date <= 30 then '1-30'
            when current_date - i.due_date <= 60 then '31-60' when current_date - i.due_date <= 90 then '61-90' else '90+' end as bucket
from public.customer_invoices i
where i.kind = 'invoice' and i.status in ('posted', 'partially_paid') and i.balance > 0;

create or replace view public.v_payables with (security_invoker = true) as
select b.id, b.doc_no, b.supplier_id, s.name as supplier_name, b.supplier_invoice_no, b.bill_date, b.due_date, b.currency_code, b.exchange_rate,
       b.total, b.balance, round(b.balance * b.exchange_rate, 2) as balance_base, b.status,
       greatest(current_date - b.due_date, 0) as days_overdue,
       case when b.due_date >= current_date then 'current' when current_date - b.due_date <= 30 then '1-30'
            when current_date - b.due_date <= 60 then '31-60' when current_date - b.due_date <= 90 then '61-90' else '90+' end as bucket
from public.supplier_bills b join public.suppliers s on s.id = b.supplier_id
where b.status in ('approved', 'partially_paid') and b.balance > 0;

-- What can be invoiced now, per order.
create or replace view public.v_uninvoiced_deliveries with (security_invoker = true) as
select d.sales_order_id, so.doc_no as sales_order_no, so.customer_id, c.name as customer_name, d.id as delivery_note_id, d.doc_no as delivery_note_no,
       d.delivery_date, d.status as delivery_status, sum(dl.qty - dl.qty_invoiced) as qty_uninvoiced,
       sum(round(l.line_total * (dl.qty - dl.qty_invoiced) / l.qty, 2)) as value_uninvoiced, so.currency_code
from public.delivery_notes d
join public.delivery_note_lines dl on dl.delivery_note_id = d.id
join public.sales_order_lines l on l.id = dl.sales_order_line_id
join public.sales_orders so on so.id = d.sales_order_id
join public.customers c on c.id = so.customer_id
where d.status in ('dispatched', 'delivered') and dl.qty_invoiced < dl.qty
group by d.sales_order_id, so.doc_no, so.customer_id, c.name, d.id, d.doc_no, d.delivery_date, d.status, so.currency_code;

-- VAT summary for a period (box-level totals for the VAT 201 return preparation).
create or replace function public.vat_summary(p_from date, p_to date)
returns table (section text, tax_category text, net numeric, vat numeric)
language sql stable security definer set search_path = public as $$
  select 'Sales (output VAT)', l.tax_category,
         sum(case when i.kind = 'invoice' then 1 else -1 end * round(l.net_amount * i.exchange_rate, 2)),
         sum(case when i.kind = 'invoice' then 1 else -1 end * round(l.tax_amount * i.exchange_rate, 2))
    from public.customer_invoices i join public.customer_invoice_lines l on l.invoice_id = i.id
   where i.status <> 'draft' and i.status <> 'void' and i.invoice_date between p_from and p_to and public.has_permission('report.finance')
   group by l.tax_category
  union all
  select 'Purchases (input VAT)', t.code, sum(round(l.net_amount * b.exchange_rate, 2)), sum(round(l.tax_amount * b.exchange_rate, 2))
    from public.supplier_bills b join public.supplier_bill_lines l on l.bill_id = b.id join public.tax_codes t on t.id = l.tax_code_id
   where b.status in ('approved', 'partially_paid', 'paid') and b.bill_date between p_from and p_to and public.has_permission('report.finance')
   group by t.code
  union all
  select 'Expenses (input VAT)', case when sum(e.vat_amount) > 0 then 'SR' else 'n/a' end, sum(e.amount), sum(e.vat_amount)
    from public.expenses e where e.status in ('approved', 'paid') and e.expense_date between p_from and p_to and e.vendor_trn is not null
     and public.has_permission('report.finance')
  order by 1, 2;
$$;

-- =============================================================================
-- SECURITY
-- =============================================================================
alter table public.bank_accounts enable row level security;
alter table public.customer_invoices enable row level security;
alter table public.customer_invoice_lines enable row level security;
alter table public.einvoice_transmissions enable row level security;
alter table public.customer_payments enable row level security;
alter table public.customer_payment_allocations enable row level security;
alter table public.supplier_bills enable row level security;
alter table public.supplier_bill_lines enable row level security;
alter table public.supplier_payments enable row level security;
alter table public.supplier_payment_allocations enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;
revoke insert, update, delete, truncate on public.customer_invoices, public.customer_invoice_lines, public.einvoice_transmissions,
  public.customer_payments, public.customer_payment_allocations, public.supplier_bills, public.supplier_bill_lines,
  public.supplier_payments, public.supplier_payment_allocations, public.expenses from anon, authenticated;

create policy bank_accounts_read on public.bank_accounts for select to authenticated
  using (public.has_permission('payment.record') or public.has_permission('payable.manage') or public.has_permission('expense.pay')
         or public.has_permission('payment.view') or public.has_permission('payable.view'));
create policy bank_accounts_write on public.bank_accounts for all to authenticated
  using (public.has_permission('payable.approve')) with check (public.has_permission('payable.approve'));
-- Invoices: finance sees all; sales roles only for customers they may see.
create policy customer_invoices_read on public.customer_invoices for select to authenticated
  using (public.has_permission('invoice.view') and exists (select 1 from public.customers c where c.id = customer_id));
create policy customer_invoice_lines_read on public.customer_invoice_lines for select to authenticated
  using (exists (select 1 from public.customer_invoices i where i.id = invoice_id));
create policy einvoice_transmissions_read on public.einvoice_transmissions for select to authenticated
  using (public.has_permission('invoice.post'));
create policy customer_payments_read on public.customer_payments for select to authenticated
  using (public.has_permission('payment.view') and exists (select 1 from public.customers c where c.id = customer_id));
create policy customer_payment_allocations_read on public.customer_payment_allocations for select to authenticated
  using (exists (select 1 from public.customer_payments p where p.id = payment_id));
create policy supplier_bills_read on public.supplier_bills for select to authenticated using (public.has_permission('payable.view'));
create policy supplier_bill_lines_read on public.supplier_bill_lines for select to authenticated
  using (exists (select 1 from public.supplier_bills b where b.id = bill_id));
create policy supplier_payments_read on public.supplier_payments for select to authenticated using (public.has_permission('payable.view'));
create policy supplier_payment_allocations_read on public.supplier_payment_allocations for select to authenticated
  using (exists (select 1 from public.supplier_payments p where p.id = payment_id));
create policy expense_categories_read on public.expense_categories for select to authenticated using (true);
create policy expense_categories_write on public.expense_categories for all to authenticated
  using (public.has_permission('expense.approve')) with check (public.has_permission('expense.approve'));
create policy expenses_read on public.expenses for select to authenticated
  using (created_by = auth.uid() or public.has_permission('expense.view_all') or public.has_permission('expense.approve'));

revoke execute on function public.customer_invoices_recalc(uuid) from public, anon, authenticated;
revoke execute on function public.supplier_bills_recalc(uuid) from public, anon, authenticated;
revoke execute on function public.customer_invoices_refresh_status(uuid) from public, anon, authenticated;
revoke execute on function public.supplier_bills_refresh_status(uuid) from public, anon, authenticated;
revoke execute on function public.sales_orders_refresh_invoicing(uuid) from public, anon, authenticated;
revoke execute on function public.einvoice_enqueue(uuid) from public, anon, authenticated;
revoke execute on function public.supplier_bill_apply_approval(uuid) from public, anon, authenticated;
revoke execute on function public.decide_approval_extension(public.approval_requests, boolean, text) from public, anon, authenticated;

-- Finance documents bucket: expenses/<expense_id>/…, bills/<bill_id>/…
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('finance-docs', 'finance-docs', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do nothing;
    execute $p$create policy finance_docs_read on storage.objects for select to authenticated using (
      bucket_id = 'finance-docs' and (
        ((storage.foldername(name))[1] = 'bills' and public.has_permission('payable.view'))
        or ((storage.foldername(name))[1] = 'expenses' and exists (select 1 from public.expenses e where e.id::text = (storage.foldername(name))[2]
              and (e.created_by = auth.uid() or public.has_permission('expense.view_all') or public.has_permission('expense.approve'))))))$p$;
    execute $p$create policy finance_docs_insert on storage.objects for insert to authenticated with check (
      bucket_id = 'finance-docs' and (
        ((storage.foldername(name))[1] = 'bills' and public.has_permission('payable.manage'))
        or ((storage.foldername(name))[1] = 'expenses' and exists (select 1 from public.expenses e where e.id::text = (storage.foldername(name))[2]
              and e.created_by = auth.uid()))))$p$;
  end if;
end $$;

-- Attach the supplier's invoice scan (any status; replaces the previous file reference).
create or replace function public.set_bill_attachment(p_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('payable.manage');
  if p_path not like 'bills/' || p_id || '/%' then perform public.raise_business_error('validation', 'Invalid file.'); end if;
  update public.supplier_bills set attachment_path = p_path where id = p_id and status <> 'void';
  if not found then perform public.raise_business_error('not_found', 'Bill not found.'); end if;
end $$;

-- Scheduled jobs run as the service role (Vercel Cron → /api/cron/*).
grant execute on function public.notify_low_stock() to service_role;
grant execute on function public.expire_quotations() to service_role;
