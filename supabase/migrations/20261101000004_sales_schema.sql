-- =============================================================================
-- 0003 Sales & CRM schema — leads, activities, quotations, approvals,
-- sales orders, reservations, purchase requisitions.
-- =============================================================================

create type public.lead_stage as enum ('new', 'contacted', 'qualified', 'quoted', 'won', 'lost');
create type public.lead_source as enum ('phone', 'email', 'walk_in', 'website', 'referral', 'exhibition', 'existing_customer', 'tender', 'other');
create type public.priority_level as enum ('low', 'medium', 'high');
create type public.activity_type as enum ('call', 'meeting', 'email', 'whatsapp', 'site_visit', 'follow_up', 'note');
create type public.fulfilment_mode as enum ('stock', 'procure');
create type public.quotation_status as enum
  ('draft', 'pending_approval', 'approved', 'rejected', 'sent', 'accepted', 'lost', 'expired', 'superseded', 'converted');
create type public.sales_order_status as enum
  ('draft', 'pending_approval', 'confirmed', 'partially_fulfilled', 'fulfilled', 'invoiced', 'closed', 'on_hold', 'cancelled');
create type public.approval_status as enum ('pending', 'approved', 'rejected', 'cancelled');

-- ---------------------------------------------------------------------------
-- Leads & enquiries
-- ---------------------------------------------------------------------------
create table public.leads (
  id                  uuid primary key default gen_random_uuid(),
  doc_no              text not null unique,
  title               text not null check (length(trim(title)) > 2),
  source              public.lead_source not null default 'other',
  customer_id         uuid references public.customers(id),
  company_name        text,
  contact_name        text,
  contact_email       citext,
  contact_phone       text,
  requirement         text,
  estimated_value     numeric(18,2) check (estimated_value is null or estimated_value >= 0),
  currency_code       char(3) not null default 'AED' references public.currencies(code),
  probability         smallint not null default 20 check (probability between 0 and 100),
  expected_close_date date,
  priority            public.priority_level not null default 'medium',
  stage               public.lead_stage not null default 'new',
  lost_reason         text,
  owner_id            uuid not null references public.profiles(id),
  won_at              timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id),
  constraint leads_party check (customer_id is not null or coalesce(trim(company_name), '') <> ''),
  constraint leads_lost_reason check (stage <> 'lost' or coalesce(trim(lost_reason), '') <> '')
);
create index leads_owner_stage_idx on public.leads(owner_id, stage);
create index leads_customer_idx on public.leads(customer_id);
select public.attach_standard_triggers('public.leads');

create or replace function public.leads_assign_no()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.doc_no is null or new.doc_no = '' then
    new.doc_no := public.next_document_number('lead');
  end if;
  return new;
end $$;
create trigger leads_no before insert on public.leads
  for each row execute function public.leads_assign_no();

-- Structured requirement lines on an enquiry (optional; free text also allowed).
create table public.lead_items (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  product_id   uuid references public.products(id),
  description  text not null check (length(trim(description)) > 0),
  qty          numeric(18,3) not null check (qty > 0),
  target_price numeric(18,2) check (target_price is null or target_price >= 0),
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id)
);
create index on public.lead_items(lead_id);
select public.attach_standard_triggers('public.lead_items');

-- ---------------------------------------------------------------------------
-- Activities & follow-ups (linked to any sales record by a real FK)
-- ---------------------------------------------------------------------------
create table public.activities (
  id              uuid primary key default gen_random_uuid(),
  activity_type   public.activity_type not null,
  subject         text not null check (length(trim(subject)) > 0),
  notes           text,
  due_at          timestamptz,
  completed_at    timestamptz,
  outcome         text,
  owner_id        uuid not null references public.profiles(id),
  lead_id         uuid references public.leads(id) on delete cascade,
  customer_id     uuid references public.customers(id) on delete cascade,
  quotation_id    uuid,   -- FK added after quotations table
  sales_order_id  uuid,   -- FK added after sales_orders table
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id),
  constraint activities_linked check (num_nonnulls(lead_id, customer_id, quotation_id, sales_order_id) >= 1),
  constraint activities_followup_due check (activity_type <> 'follow_up' or due_at is not null)
);
create index activities_owner_due_idx on public.activities(owner_id, completed_at, due_at);
create index on public.activities(lead_id);
create index on public.activities(customer_id);
select public.attach_standard_triggers('public.activities');

-- ---------------------------------------------------------------------------
-- Approval rules & requests (generic; used by quotations and sales orders)
-- ---------------------------------------------------------------------------
create table public.approval_rules (
  id                  uuid primary key default gen_random_uuid(),
  doc_type            text not null check (doc_type in ('quotation', 'sales_order', 'purchase_order', 'supplier_bill', 'expense', 'stock_adjustment')),
  name                text not null,
  metric              text not null check (metric in ('max_discount_pct', 'margin_pct', 'total_base', 'credit_exceeded', 'price_variance_pct')),
  comparison          text not null check (comparison in ('gt', 'lt')),
  threshold           numeric(18,2) not null default 0,
  approver_permission text not null,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);
select public.attach_standard_triggers('public.approval_rules', false);

create table public.approval_requests (
  id            uuid primary key default gen_random_uuid(),
  doc_type      text not null check (doc_type in ('quotation', 'sales_order', 'purchase_order', 'supplier_bill', 'expense', 'stock_adjustment')),
  doc_id        uuid not null,
  doc_no        text not null,
  reasons       text[] not null,
  approver_permission text not null,
  status        public.approval_status not null default 'pending',
  requested_by  uuid references public.profiles(id),
  requested_at  timestamptz not null default now(),
  decided_by    uuid references public.profiles(id),
  decided_at    timestamptz,
  comment       text
);
create unique index approval_requests_one_pending on public.approval_requests(doc_type, doc_id) where status = 'pending';
create index on public.approval_requests(status, requested_at);
select public.attach_standard_triggers('public.approval_requests', false);

-- ---------------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------------
create table public.quotations (
  id                  uuid primary key default gen_random_uuid(),
  doc_no              text not null unique,
  base_doc_no         text not null,               -- QT-2026-00012 (shared by all revisions)
  revision_no         integer not null default 0 check (revision_no >= 0),
  parent_quotation_id uuid references public.quotations(id),
  lead_id             uuid references public.leads(id),
  customer_id         uuid not null references public.customers(id),
  contact_id          uuid references public.customer_contacts(id),
  billing_address_id  uuid references public.customer_addresses(id),
  shipping_address_id uuid references public.customer_addresses(id),
  sales_rep_id        uuid not null references public.profiles(id),
  subject             text,
  customer_reference  text,
  quotation_date      date not null default current_date,
  valid_until         date not null,
  currency_code       char(3) not null references public.currencies(code),
  exchange_rate       numeric(18,6) not null default 1 check (exchange_rate > 0),  -- 1 doc ccy = x AED
  payment_term_id     uuid references public.payment_terms(id),
  delivery_term_id    uuid references public.delivery_terms(id),
  delivery_time       text,                          -- e.g. "2–3 weeks from PO"
  delivery_location   text,
  terms_conditions    text not null default '',
  notes               text,                          -- printed on the PDF
  internal_notes      text,                          -- never printed
  status              public.quotation_status not null default 'draft',
  gross_amount        numeric(18,2) not null default 0,  -- sum(qty × price)
  discount_total      numeric(18,2) not null default 0,
  net_total           numeric(18,2) not null default 0,
  tax_total           numeric(18,2) not null default 0,
  total               numeric(18,2) not null default 0,
  total_base          numeric(18,2) not null default 0,  -- in AED
  max_discount_pct    numeric(5,2) not null default 0,
  submitted_at        timestamptz,
  approved_at         timestamptz,
  approved_by         uuid references public.profiles(id),
  sent_at             timestamptz,
  accepted_at         timestamptz,
  lost_reason         text,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id),
  constraint quotations_validity check (valid_until >= quotation_date),
  constraint quotations_lost_reason check (status <> 'lost' or coalesce(trim(lost_reason), '') <> ''),
  unique (base_doc_no, revision_no)
);
create index quotations_customer_idx on public.quotations(customer_id, quotation_date desc);
create index quotations_rep_status_idx on public.quotations(sales_rep_id, status);
create index quotations_status_idx on public.quotations(status, valid_until);
select public.attach_standard_triggers('public.quotations');

alter table public.activities
  add constraint activities_quotation_fk foreign key (quotation_id) references public.quotations(id) on delete cascade;

create table public.quotation_lines (
  id              uuid primary key default gen_random_uuid(),
  quotation_id    uuid not null references public.quotations(id) on delete cascade,
  line_no         integer not null check (line_no > 0),
  product_id      uuid not null references public.products(id),
  description     text not null check (length(trim(description)) > 0),
  uom_id          uuid not null references public.units_of_measure(id),
  qty             numeric(18,3) not null check (qty > 0),
  unit_price      numeric(18,2) not null check (unit_price >= 0),
  discount_pct    numeric(5,2) not null default 0 check (discount_pct >= 0 and discount_pct <= 100),
  tax_code_id     uuid not null references public.tax_codes(id),
  tax_rate        numeric(5,2) not null check (tax_rate >= 0),
  fulfilment_mode public.fulfilment_mode not null default 'stock',
  lead_time_text  text,
  -- Money is computed by the database, never trusted from the client.
  gross_amount    numeric(18,2) generated always as (round(qty * unit_price, 2)) stored,
  discount_amount numeric(18,2) generated always as (round(round(qty * unit_price, 2) * discount_pct / 100, 2)) stored,
  net_amount      numeric(18,2) generated always as
                    (round(qty * unit_price, 2) - round(round(qty * unit_price, 2) * discount_pct / 100, 2)) stored,
  tax_amount      numeric(18,2) generated always as
                    (round((round(qty * unit_price, 2) - round(round(qty * unit_price, 2) * discount_pct / 100, 2)) * tax_rate / 100, 2)) stored,
  line_total      numeric(18,2) generated always as
                    ((round(qty * unit_price, 2) - round(round(qty * unit_price, 2) * discount_pct / 100, 2))
                     + round((round(qty * unit_price, 2) - round(round(qty * unit_price, 2) * discount_pct / 100, 2)) * tax_rate / 100, 2)) stored,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id),
  unique (quotation_id, line_no)
);
create index on public.quotation_lines(product_id);
select public.attach_standard_triggers('public.quotation_lines');

-- Internal costing kept in its own table so RLS can hide it from roles
-- without the quotation.view_cost permission.
create table public.quotation_line_costs (
  line_id      uuid primary key references public.quotation_lines(id) on delete cascade,
  quotation_id uuid not null references public.quotations(id) on delete cascade,
  unit_cost    numeric(18,4) not null default 0 check (unit_cost >= 0),   -- in quotation currency
  cost_source  text not null default 'manual' check (cost_source in ('stock_avg', 'supplier', 'manual', 'none')),
  supplier_id  uuid references public.suppliers(id),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id)
);
create index on public.quotation_line_costs(quotation_id);
select public.attach_standard_triggers('public.quotation_line_costs', false);

-- Header totals always equal the sum of the lines.
create or replace function public.quotations_recalc_totals(p_quotation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.quotations q
     set gross_amount     = coalesce(s.gross, 0),
         discount_total   = coalesce(s.disc, 0),
         net_total        = coalesce(s.net, 0),
         tax_total        = coalesce(s.tax, 0),
         total            = coalesce(s.total, 0),
         total_base       = round(coalesce(s.total, 0) * q.exchange_rate, 2),
         max_discount_pct = coalesce(s.max_disc, 0)
    from (select sum(gross_amount) gross, sum(discount_amount) disc, sum(net_amount) net,
                 sum(tax_amount) tax, sum(line_total) total, max(discount_pct) max_disc
            from public.quotation_lines where quotation_id = p_quotation_id) s
   where q.id = p_quotation_id;
end $$;

create or replace function public.quotation_lines_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.quotations_recalc_totals(coalesce(new.quotation_id, old.quotation_id));
  return null;
end $$;
create trigger quotation_lines_totals after insert or update or delete on public.quotation_lines
  for each row execute function public.quotation_lines_after_change();

-- Lines of anything but a draft (or a quotation being revised by the system)
-- are frozen. Header fields too, except status-workflow columns.
create or replace function public.quotation_lines_guard()
returns trigger language plpgsql as $$
declare v_status public.quotation_status;
begin
  select status into v_status from public.quotations where id = coalesce(new.quotation_id, old.quotation_id);
  if v_status is distinct from 'draft' and coalesce(current_setting('smp.allow_locked_edit', true), '') <> 'on' then
    raise exception using errcode = 'P0001', hint = 'locked',
      message = 'This quotation is no longer a draft. Create a revision to change it.';
  end if;
  return coalesce(new, old);
end $$;
create trigger quotation_lines_guard before insert or update or delete on public.quotation_lines
  for each row execute function public.quotation_lines_guard();

create or replace function public.quotations_header_guard()
returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' and coalesce(current_setting('smp.allow_locked_edit', true), '') <> 'on' then
    if (to_jsonb(new) - array['status','submitted_at','approved_at','approved_by','sent_at','accepted_at',
                              'lost_reason','updated_at','updated_by','internal_notes',
                              'gross_amount','discount_total','net_total','tax_total','total','total_base','max_discount_pct'])
       is distinct from
       (to_jsonb(old) - array['status','submitted_at','approved_at','approved_by','sent_at','accepted_at',
                              'lost_reason','updated_at','updated_by','internal_notes',
                              'gross_amount','discount_total','net_total','tax_total','total','total_base','max_discount_pct']) then
      raise exception using errcode = 'P0001', hint = 'locked',
        message = 'This quotation is no longer a draft. Create a revision to change it.';
    end if;
  end if;
  return new;
end $$;
create trigger quotations_header_guard before update on public.quotations
  for each row execute function public.quotations_header_guard();

-- ---------------------------------------------------------------------------
-- Sales orders
-- ---------------------------------------------------------------------------
create table public.sales_orders (
  id                  uuid primary key default gen_random_uuid(),
  doc_no              text not null unique,
  quotation_id        uuid unique references public.quotations(id),
  customer_id         uuid not null references public.customers(id),
  contact_id          uuid references public.customer_contacts(id),
  billing_address_id  uuid references public.customer_addresses(id),
  shipping_address_id uuid references public.customer_addresses(id),
  sales_rep_id        uuid not null references public.profiles(id),
  customer_po_ref     text,
  order_date          date not null default current_date,
  required_date       date,
  currency_code       char(3) not null references public.currencies(code),
  exchange_rate       numeric(18,6) not null default 1 check (exchange_rate > 0),
  payment_term_id     uuid references public.payment_terms(id),
  delivery_term_id    uuid references public.delivery_terms(id),
  delivery_location   text,
  terms_conditions    text not null default '',
  notes               text,
  internal_notes      text,
  status              public.sales_order_status not null default 'draft',
  hold_reason         text,
  cancel_reason       text,
  gross_amount        numeric(18,2) not null default 0,
  discount_total      numeric(18,2) not null default 0,
  net_total           numeric(18,2) not null default 0,
  tax_total           numeric(18,2) not null default 0,
  total               numeric(18,2) not null default 0,
  total_base          numeric(18,2) not null default 0,
  confirmed_at        timestamptz,
  confirmed_by        uuid references public.profiles(id),
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id),
  constraint so_required_date check (required_date is null or required_date >= order_date),
  constraint so_cancel_reason check (status <> 'cancelled' or coalesce(trim(cancel_reason), '') <> '')
);
create index sales_orders_customer_idx on public.sales_orders(customer_id, order_date desc);
create index sales_orders_rep_status_idx on public.sales_orders(sales_rep_id, status);
select public.attach_standard_triggers('public.sales_orders');

alter table public.activities
  add constraint activities_sales_order_fk foreign key (sales_order_id) references public.sales_orders(id) on delete cascade;

create table public.sales_order_lines (
  id                uuid primary key default gen_random_uuid(),
  sales_order_id    uuid not null references public.sales_orders(id) on delete cascade,
  line_no           integer not null check (line_no > 0),
  quotation_line_id uuid references public.quotation_lines(id),
  product_id        uuid not null references public.products(id),
  description       text not null check (length(trim(description)) > 0),
  uom_id            uuid not null references public.units_of_measure(id),
  qty               numeric(18,3) not null check (qty > 0),
  unit_price        numeric(18,2) not null check (unit_price >= 0),
  discount_pct      numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_code_id       uuid not null references public.tax_codes(id),
  tax_rate          numeric(5,2) not null check (tax_rate >= 0),
  fulfilment_mode   public.fulfilment_mode not null,
  warehouse_id      uuid references public.warehouses(id),
  split_from_line_id uuid references public.sales_order_lines(id),
  -- Fulfilment counters, maintained only by posting functions.
  qty_reserved      numeric(18,3) not null default 0 check (qty_reserved >= 0),
  qty_requisitioned numeric(18,3) not null default 0 check (qty_requisitioned >= 0),
  qty_ordered       numeric(18,3) not null default 0 check (qty_ordered >= 0),
  qty_received      numeric(18,3) not null default 0 check (qty_received >= 0),
  qty_delivered     numeric(18,3) not null default 0 check (qty_delivered >= 0),
  qty_invoiced      numeric(18,3) not null default 0 check (qty_invoiced >= 0),
  is_cancelled      boolean not null default false,
  gross_amount      numeric(18,2) generated always as (round(qty * unit_price, 2)) stored,
  discount_amount   numeric(18,2) generated always as (round(round(qty * unit_price, 2) * discount_pct / 100, 2)) stored,
  net_amount        numeric(18,2) generated always as
                      (round(qty * unit_price, 2) - round(round(qty * unit_price, 2) * discount_pct / 100, 2)) stored,
  tax_amount        numeric(18,2) generated always as
                      (round((round(qty * unit_price, 2) - round(round(qty * unit_price, 2) * discount_pct / 100, 2)) * tax_rate / 100, 2)) stored,
  line_total        numeric(18,2) generated always as
                      ((round(qty * unit_price, 2) - round(round(qty * unit_price, 2) * discount_pct / 100, 2))
                       + round((round(qty * unit_price, 2) - round(round(qty * unit_price, 2) * discount_pct / 100, 2)) * tax_rate / 100, 2)) stored,
  -- Independent status per line, derived — can never drift from the counters.
  stock_status      text generated always as (
                      case
                        when is_cancelled then 'cancelled'
                        when qty_reserved + qty_delivered >= qty then 'reserved'
                        when qty_reserved + qty_delivered > 0 then 'partially_reserved'
                        when fulfilment_mode = 'procure' then 'awaiting_receipt'
                        else 'not_reserved'
                      end) stored,
  procurement_status text generated always as (
                      case
                        when is_cancelled then 'cancelled'
                        when fulfilment_mode = 'stock' then 'not_required'
                        when qty_received >= qty then 'received'
                        when qty_received > 0 then 'partially_received'
                        when qty_ordered >= qty then 'ordered'
                        when qty_ordered > 0 then 'partially_ordered'
                        when qty_requisitioned >= qty then 'requisitioned'
                        else 'pending'
                      end) stored,
  delivery_status   text generated always as (
                      case
                        when is_cancelled then 'cancelled'
                        when qty_delivered >= qty then 'delivered'
                        when qty_delivered > 0 then 'partially_delivered'
                        else 'pending'
                      end) stored,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id),
  unique (sales_order_id, line_no),
  constraint sol_reserved_le_qty  check (qty_reserved + qty_delivered <= qty),
  constraint sol_delivered_le_qty check (qty_delivered <= qty),
  constraint sol_invoiced_le_qty  check (qty_invoiced <= qty),
  constraint sol_procure_counters check (fulfilment_mode = 'procure' or (qty_requisitioned = 0 and qty_ordered = 0 and qty_received = 0))
);
create index on public.sales_order_lines(product_id);
create index on public.sales_order_lines(sales_order_id);
select public.attach_standard_triggers('public.sales_order_lines');

create table public.sales_order_line_costs (
  line_id        uuid primary key references public.sales_order_lines(id) on delete cascade,
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  unit_cost      numeric(18,4) not null default 0 check (unit_cost >= 0),
  cost_source    text not null default 'manual' check (cost_source in ('stock_avg', 'supplier', 'manual', 'none', 'purchase_order')),
  supplier_id    uuid references public.suppliers(id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id)
);
create index on public.sales_order_line_costs(sales_order_id);
select public.attach_standard_triggers('public.sales_order_line_costs', false);

create or replace function public.sales_orders_recalc_totals(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.sales_orders so
     set gross_amount   = coalesce(s.gross, 0),
         discount_total = coalesce(s.disc, 0),
         net_total      = coalesce(s.net, 0),
         tax_total      = coalesce(s.tax, 0),
         total          = coalesce(s.total, 0),
         total_base     = round(coalesce(s.total, 0) * so.exchange_rate, 2)
    from (select sum(gross_amount) gross, sum(discount_amount) disc, sum(net_amount) net,
                 sum(tax_amount) tax, sum(line_total) total
            from public.sales_order_lines
           where sales_order_id = p_id and not is_cancelled) s
   where so.id = p_id;
end $$;

create or replace function public.sales_order_lines_after_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sales_orders_recalc_totals(coalesce(new.sales_order_id, old.sales_order_id));
  return null;
end $$;
create trigger sales_order_lines_totals after insert or update or delete on public.sales_order_lines
  for each row execute function public.sales_order_lines_after_change();

-- Commercial terms of a line are frozen once the order leaves draft;
-- only system functions may change counters.
create or replace function public.sales_order_lines_guard()
returns trigger language plpgsql as $$
declare v_status public.sales_order_status;
begin
  select status into v_status from public.sales_orders where id = coalesce(new.sales_order_id, old.sales_order_id);
  if coalesce(current_setting('smp.allow_locked_edit', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if v_status not in ('draft') then
    raise exception using errcode = 'P0001', hint = 'locked',
      message = 'Order lines can only be changed while the order is a draft.';
  end if;
  if tg_op = 'UPDATE' and (new.qty_reserved, new.qty_requisitioned, new.qty_ordered, new.qty_received,
                           new.qty_delivered, new.qty_invoiced)
     is distinct from (old.qty_reserved, old.qty_requisitioned, old.qty_ordered, old.qty_received,
                       old.qty_delivered, old.qty_invoiced) then
    raise exception 'Fulfilment quantities are maintained by the system.';
  end if;
  return coalesce(new, old);
end $$;
create trigger sales_order_lines_guard before insert or update or delete on public.sales_order_lines
  for each row execute function public.sales_order_lines_guard();

-- ---------------------------------------------------------------------------
-- Stock reservations
-- ---------------------------------------------------------------------------
create table public.stock_reservations (
  id                  uuid primary key default gen_random_uuid(),
  sales_order_line_id uuid not null references public.sales_order_lines(id),
  product_id          uuid not null references public.products(id),
  warehouse_id        uuid not null references public.warehouses(id),
  qty                 numeric(18,3) not null check (qty > 0),
  status              text not null default 'active' check (status in ('active', 'released', 'consumed')),
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id) default auth.uid(),
  released_at         timestamptz
);
-- At most ONE active reservation per order line per warehouse (no duplicates).
create unique index stock_reservations_one_active on public.stock_reservations(sales_order_line_id, warehouse_id) where status = 'active';
create index stock_reservations_level_idx on public.stock_reservations(product_id, warehouse_id) where status = 'active';
alter table public.stock_movements
  add constraint stock_movements_sol_fk foreign key (sales_order_line_id) references public.sales_order_lines(id);
-- Reservations change only through stock_reserve / stock_release.
create or replace function public.stock_reservations_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('smp.stock_posting', true), '') <> 'on' then
    raise exception using errcode = 'P0001', hint = 'forbidden',
      message = 'Reservations can only be changed through reserve/release transactions.';
  end if;
  if tg_op = 'DELETE' then raise exception 'Reservations cannot be deleted; release them instead.'; end if;
  return new;
end $$;
create trigger stock_reservations_guard before insert or update or delete on public.stock_reservations
  for each row execute function public.stock_reservations_guard();
select public.attach_standard_triggers('public.stock_reservations', false);

-- ---------------------------------------------------------------------------
-- Purchase requisitions (created by sales order confirmation; worked by
-- procurement in phase 3)
-- ---------------------------------------------------------------------------
create table public.purchase_requisitions (
  id             uuid primary key default gen_random_uuid(),
  doc_no         text not null unique,
  source         text not null check (source in ('sales_order', 'reorder', 'manual')),
  sales_order_id uuid references public.sales_orders(id),
  required_date  date,
  status         text not null default 'open' check (status in ('open', 'partially_ordered', 'ordered', 'cancelled')),
  notes          text,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id),
  constraint pr_so_source check (source <> 'sales_order' or sales_order_id is not null)
);
select public.attach_standard_triggers('public.purchase_requisitions');

create table public.purchase_requisition_lines (
  id                    uuid primary key default gen_random_uuid(),
  requisition_id        uuid not null references public.purchase_requisitions(id) on delete cascade,
  product_id            uuid not null references public.products(id),
  description           text not null,
  qty                   numeric(18,3) not null check (qty > 0),
  uom_id                uuid not null references public.units_of_measure(id),
  sales_order_line_id   uuid references public.sales_order_lines(id),
  suggested_supplier_id uuid references public.suppliers(id),
  qty_ordered           numeric(18,3) not null default 0 check (qty_ordered >= 0),
  is_cancelled          boolean not null default false,
  created_at            timestamptz not null default now(),
  created_by            uuid references public.profiles(id),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles(id)
);
create index on public.purchase_requisition_lines(sales_order_line_id);
select public.attach_standard_triggers('public.purchase_requisition_lines');

-- ---------------------------------------------------------------------------
-- Default approval rules (editable in System Settings)
-- ---------------------------------------------------------------------------
insert into public.approval_rules (doc_type, name, metric, comparison, threshold, approver_permission) values
  ('quotation', 'Discount above 10%', 'max_discount_pct', 'gt', 10, 'quotation.approve'),
  ('quotation', 'Gross margin below 15%', 'margin_pct', 'lt', 15, 'quotation.approve'),
  ('quotation', 'Quotation above AED 250,000', 'total_base', 'gt', 250000, 'quotation.approve'),
  ('sales_order', 'Customer credit limit exceeded', 'credit_exceeded', 'gt', 0, 'sales_order.approve');
