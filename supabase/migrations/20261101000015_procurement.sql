-- =============================================================================
-- 0015 Procurement
--   suppliers' contacts · supplier quotations (compare & select) · purchase
--   orders with approval · receiving against POs · incoming stock from POs.
-- Quantities flow: requisition line → PO line (ordered) → GRN line (received)
-- → sales order line (received + reserved, for back-to-back items).
-- =============================================================================

create type public.po_status as enum
  ('draft', 'pending_approval', 'approved', 'sent', 'partially_received', 'received', 'closed', 'cancelled');

-- ---------------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------------
alter table public.suppliers
  add column address        text,
  add column city           text,
  add column website        text,
  add column bank_details   text,
  add column trade_license_no text,
  add column category       text;

create table public.supplier_contacts (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  designation text,
  email       citext,
  phone       text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);
create index on public.supplier_contacts(supplier_id);
create unique index supplier_contacts_one_primary on public.supplier_contacts(supplier_id) where is_primary;
select public.attach_standard_triggers('public.supplier_contacts');

create or replace function public.save_supplier(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id  uuid := nullif(p->>'id', '')::uuid;
  v_trn text := nullif(regexp_replace(coalesce(p->>'trn', ''), '\s', '', 'g'), '');
  v_c   jsonb;
  v_keep uuid[] := '{}';
  v_cid uuid;
begin
  perform public.require_permission('supplier.edit');
  if length(trim(coalesce(p->>'name', ''))) < 2 then perform public.raise_business_error('validation', 'Enter the supplier name.'); end if;
  if v_trn is not null and v_trn !~ '^[0-9]{15}$' then
    perform public.raise_business_error('validation', 'The TRN must be exactly 15 digits.');
  end if;
  if exists (select 1 from public.suppliers where id is distinct from v_id
              and ((v_trn is not null and trn = v_trn) or name_normalized = public.normalize_party_name(p->>'name'))) then
    perform public.raise_business_error('duplicate', 'A supplier with the same name or TRN already exists.');
  end if;
  if v_id is null then
    insert into public.suppliers(code, name, trn, country, email, phone, currency_code, payment_term_id, lead_time_days, status, notes,
                                 address, city, website, bank_details, trade_license_no, category)
    values ('', trim(p->>'name'), v_trn, nullif(trim(p->>'country'), ''), nullif(trim(p->>'email'), ''), nullif(trim(p->>'phone'), ''),
            coalesce(nullif(p->>'currency_code', ''), public.base_currency()), nullif(p->>'payment_term_id', '')::uuid,
            coalesce(nullif(p->>'lead_time_days', '')::int, 0), coalesce(nullif(p->>'status', ''), 'active')::public.party_status,
            nullif(trim(p->>'notes'), ''), nullif(trim(p->>'address'), ''), nullif(trim(p->>'city'), ''), nullif(trim(p->>'website'), ''),
            nullif(trim(p->>'bank_details'), ''), nullif(trim(p->>'trade_license_no'), ''), nullif(trim(p->>'category'), ''))
    returning id into v_id;
  else
    update public.suppliers set name = trim(p->>'name'), trn = v_trn, country = nullif(trim(p->>'country'), ''),
      email = nullif(trim(p->>'email'), ''), phone = nullif(trim(p->>'phone'), ''),
      currency_code = coalesce(nullif(p->>'currency_code', ''), currency_code), payment_term_id = nullif(p->>'payment_term_id', '')::uuid,
      lead_time_days = coalesce(nullif(p->>'lead_time_days', '')::int, 0), status = coalesce(nullif(p->>'status', ''), 'active')::public.party_status,
      notes = nullif(trim(p->>'notes'), ''), address = nullif(trim(p->>'address'), ''), city = nullif(trim(p->>'city'), ''),
      website = nullif(trim(p->>'website'), ''), bank_details = nullif(trim(p->>'bank_details'), ''),
      trade_license_no = nullif(trim(p->>'trade_license_no'), ''), category = nullif(trim(p->>'category'), '')
    where id = v_id;
    if not found then perform public.raise_business_error('not_found', 'Supplier not found.'); end if;
  end if;
  if p ? 'contacts' then
    update public.supplier_contacts set is_primary = false where supplier_id = v_id;
    for v_c in select * from jsonb_array_elements(p->'contacts') loop
      continue when coalesce(trim(v_c->>'name'), '') = '';
      if nullif(v_c->>'id', '') is not null then
        update public.supplier_contacts set name = trim(v_c->>'name'), designation = nullif(trim(v_c->>'designation'), ''),
          email = nullif(trim(v_c->>'email'), ''), phone = nullif(trim(v_c->>'phone'), ''), is_primary = coalesce((v_c->>'is_primary')::boolean, false)
        where id = (v_c->>'id')::uuid and supplier_id = v_id returning id into v_cid;
      else
        insert into public.supplier_contacts(supplier_id, name, designation, email, phone, is_primary)
        values (v_id, trim(v_c->>'name'), nullif(trim(v_c->>'designation'), ''), nullif(trim(v_c->>'email'), ''),
                nullif(trim(v_c->>'phone'), ''), coalesce((v_c->>'is_primary')::boolean, false))
        returning id into v_cid;
      end if;
      v_keep := v_keep || v_cid;
    end loop;
    delete from public.supplier_contacts c where c.supplier_id = v_id and not (c.id = any (v_keep))
      and not exists (select 1 from public.purchase_orders po where po.supplier_contact_id = c.id);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Supplier quotations (prices received against requisitions)
-- ---------------------------------------------------------------------------
create table public.supplier_quotations (
  id                uuid primary key default gen_random_uuid(),
  doc_no            text not null unique,
  supplier_id       uuid not null references public.suppliers(id),
  requisition_id    uuid references public.purchase_requisitions(id),
  quote_date        date not null default current_date,
  valid_until       date,
  supplier_reference text,
  currency_code     char(3) not null references public.currencies(code),
  exchange_rate     numeric(18,6) not null default 1 check (exchange_rate > 0),
  delivery_days     integer check (delivery_days >= 0),
  payment_term_id   uuid references public.payment_terms(id),
  status            text not null default 'received' check (status in ('received', 'selected', 'rejected')),
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id)
);
create index on public.supplier_quotations(requisition_id);
create index on public.supplier_quotations(supplier_id, quote_date desc);
select public.attach_standard_triggers('public.supplier_quotations');

create table public.supplier_quotation_lines (
  id                    uuid primary key default gen_random_uuid(),
  supplier_quotation_id uuid not null references public.supplier_quotations(id) on delete cascade,
  line_no               integer not null check (line_no > 0),
  requisition_line_id   uuid references public.purchase_requisition_lines(id),
  product_id            uuid not null references public.products(id),
  qty                   numeric(18,3) not null check (qty > 0),
  unit_price            numeric(18,4) not null check (unit_price >= 0),
  lead_time_days        integer check (lead_time_days >= 0),
  notes                 text,
  unique (supplier_quotation_id, line_no)
);
create index on public.supplier_quotation_lines(requisition_line_id);
select public.attach_standard_triggers('public.supplier_quotation_lines', false);

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------
create table public.purchase_orders (
  id                    uuid primary key default gen_random_uuid(),
  doc_no                text not null unique,
  supplier_id           uuid not null references public.suppliers(id),
  supplier_contact_id   uuid references public.supplier_contacts(id),
  supplier_quotation_id uuid references public.supplier_quotations(id),
  supplier_reference    text,
  order_date            date not null default current_date,
  expected_date         date,
  warehouse_id          uuid not null references public.warehouses(id),
  currency_code         char(3) not null references public.currencies(code),
  exchange_rate         numeric(18,6) not null default 1 check (exchange_rate > 0),
  payment_term_id       uuid references public.payment_terms(id),
  delivery_term_id      uuid references public.delivery_terms(id),
  terms_conditions      text not null default '',
  notes                 text,
  status                public.po_status not null default 'draft',
  net_total             numeric(18,2) not null default 0,
  tax_total             numeric(18,2) not null default 0,
  total                 numeric(18,2) not null default 0,
  total_base            numeric(18,2) not null default 0,
  approved_at           timestamptz,
  approved_by           uuid references public.profiles(id),
  sent_at               timestamptz,
  cancel_reason         text,
  created_at            timestamptz not null default now(),
  created_by            uuid references public.profiles(id),
  updated_at            timestamptz not null default now(),
  updated_by            uuid references public.profiles(id),
  constraint po_expected check (expected_date is null or expected_date >= order_date),
  constraint po_cancel_reason check (status <> 'cancelled' or coalesce(trim(cancel_reason), '') <> '')
);
create index purchase_orders_supplier_idx on public.purchase_orders(supplier_id, order_date desc);
create index purchase_orders_status_idx on public.purchase_orders(status, expected_date);
select public.attach_standard_triggers('public.purchase_orders');

create table public.purchase_order_lines (
  id                  uuid primary key default gen_random_uuid(),
  purchase_order_id   uuid not null references public.purchase_orders(id) on delete cascade,
  line_no             integer not null check (line_no > 0),
  product_id          uuid not null references public.products(id),
  description         text not null check (length(trim(description)) > 0),
  uom_id              uuid not null references public.units_of_measure(id),
  qty                 numeric(18,3) not null check (qty > 0),
  unit_cost           numeric(18,4) not null check (unit_cost >= 0),
  tax_code_id         uuid not null references public.tax_codes(id),
  tax_rate            numeric(5,2) not null check (tax_rate >= 0),
  net_amount          numeric(18,2) generated always as (round(qty * unit_cost, 2)) stored,
  tax_amount          numeric(18,2) generated always as (round(round(qty * unit_cost, 2) * tax_rate / 100, 2)) stored,
  line_total          numeric(18,2) generated always as (round(qty * unit_cost, 2) + round(round(qty * unit_cost, 2) * tax_rate / 100, 2)) stored,
  qty_received        numeric(18,3) not null default 0 check (qty_received >= 0),
  qty_billed          numeric(18,3) not null default 0 check (qty_billed >= 0),
  requisition_line_id uuid references public.purchase_requisition_lines(id),
  sales_order_line_id uuid references public.sales_order_lines(id),
  supplier_quotation_line_id uuid references public.supplier_quotation_lines(id),
  is_cancelled        boolean not null default false,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id),
  unique (purchase_order_id, line_no),
  constraint pol_received_le_qty check (qty_received <= qty),
  constraint pol_billed_le_received check (qty_billed <= qty_received)
);
create index on public.purchase_order_lines(product_id);
create index on public.purchase_order_lines(requisition_line_id);
create index on public.purchase_order_lines(sales_order_line_id);
select public.attach_standard_triggers('public.purchase_order_lines');

create or replace function public.purchase_orders_recalc(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.purchase_orders po set
    net_total = coalesce(s.net, 0), tax_total = coalesce(s.tax, 0), total = coalesce(s.tot, 0),
    total_base = round(coalesce(s.tot, 0) * po.exchange_rate, 2)
  from (select sum(net_amount) net, sum(tax_amount) tax, sum(line_total) tot
          from public.purchase_order_lines where purchase_order_id = p_id and not is_cancelled) s
  where po.id = p_id;
end $$;
create or replace function public.purchase_order_lines_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.purchase_orders_recalc(coalesce(new.purchase_order_id, old.purchase_order_id));
  return null;
end $$;
create trigger purchase_order_lines_totals after insert or update or delete on public.purchase_order_lines
  for each row execute function public.purchase_order_lines_after();

-- Commercial terms are frozen once the PO leaves draft.
create or replace function public.purchase_order_lines_guard()
returns trigger language plpgsql as $$
declare v_status public.po_status;
begin
  select status into v_status from public.purchase_orders where id = coalesce(new.purchase_order_id, old.purchase_order_id);
  if v_status <> 'draft' and coalesce(current_setting('smp.allow_locked_edit', true), '') <> 'on' then
    raise exception using errcode = 'P0001', hint = 'locked', message = 'This purchase order is no longer a draft.';
  end if;
  return coalesce(new, old);
end $$;
create trigger purchase_order_lines_guard before insert or update or delete on public.purchase_order_lines
  for each row execute function public.purchase_order_lines_guard();

-- Goods receipts now link to purchase orders.
alter table public.goods_receipts add constraint goods_receipts_po_fk foreign key (purchase_order_id) references public.purchase_orders(id);
alter table public.goods_receipt_lines add constraint grl_po_line_fk foreign key (purchase_order_line_id) references public.purchase_order_lines(id);
create index on public.goods_receipt_lines(purchase_order_line_id);

insert into public.approval_rules (doc_type, name, metric, comparison, threshold, approver_permission)
values ('purchase_order', 'Purchase order above AED 25,000', 'total_base', 'gt', 25000, 'purchase_order.approve');

-- ---------------------------------------------------------------------------
-- Quantity still to be ordered on a requisition line (non-cancelled POs count).
-- ---------------------------------------------------------------------------
create or replace function public.requisition_line_open_qty(p_line uuid, p_excluding_po uuid default null)
returns numeric language sql stable security definer set search_path = public as $$
  select greatest(rl.qty - coalesce((select sum(case when po.status = 'closed' then pol.qty_received else pol.qty end) from public.purchase_order_lines pol
                                       join public.purchase_orders po on po.id = pol.purchase_order_id
                                      where pol.requisition_line_id = rl.id and not pol.is_cancelled
                                        and po.status <> 'cancelled' and po.id is distinct from p_excluding_po), 0), 0)
  from public.purchase_requisition_lines rl where rl.id = p_line and not rl.is_cancelled;
$$;

create or replace function public.requisitions_refresh(p_requisition uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.purchase_requisitions r set status = case
      when r.status = 'cancelled' then 'cancelled'
      when not exists (select 1 from public.purchase_requisition_lines l where l.requisition_id = r.id and not l.is_cancelled and l.qty_ordered < l.qty) then 'ordered'
      when exists (select 1 from public.purchase_requisition_lines l where l.requisition_id = r.id and l.qty_ordered > 0) then 'partially_ordered'
      else 'open' end
  where r.id = p_requisition;
end $$;

-- ---------------------------------------------------------------------------
-- Manual / reorder requisitions
-- ---------------------------------------------------------------------------
create or replace function public.create_requisition(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_line jsonb; v_prod public.products;
begin
  perform public.require_permission('purchase_requisition.manage');
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then
    perform public.raise_business_error('validation', 'Add at least one item.');
  end if;
  insert into public.purchase_requisitions(doc_no, source, required_date, notes)
  values (public.next_document_number('purchase_requisition'), coalesce(nullif(p->>'source', ''), 'manual'),
          nullif(p->>'required_date', '')::date, nullif(trim(p->>'notes'), ''))
  returning id into v_id;
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    select * into v_prod from public.products where id = (v_line->>'product_id')::uuid and is_active;
    if not found then perform public.raise_business_error('validation', 'Select an active product on every line.'); end if;
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 then perform public.raise_business_error('validation', 'Quantities must be greater than zero.'); end if;
    insert into public.purchase_requisition_lines(requisition_id, product_id, description, qty, uom_id, suggested_supplier_id)
    values (v_id, v_prod.id, coalesce(nullif(trim(v_line->>'description'), ''), v_prod.name), (v_line->>'qty')::numeric,
            v_prod.uom_id, coalesce(nullif(v_line->>'supplier_id', '')::uuid, v_prod.default_supplier_id));
  end loop;
  return v_id;
end $$;

-- Raise one requisition for every stock item below its minimum (reorder qty, or up to the minimum).
create or replace function public.create_reorder_requisition()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_lines jsonb;
begin
  perform public.require_permission('purchase_requisition.manage');
  select jsonb_agg(jsonb_build_object('product_id', i.product_id,
           'qty', greatest(p.reorder_qty, p.min_stock_level - i.available_qty - i.incoming_qty)))
    into v_lines
    from public.v_product_inventory i join public.products p on p.id = i.product_id
   where i.below_min and p.is_active
     and i.available_qty + i.incoming_qty < p.min_stock_level
     and not exists (select 1 from public.purchase_requisition_lines rl join public.purchase_requisitions r on r.id = rl.requisition_id
                      where rl.product_id = p.id and r.source = 'reorder' and r.status in ('open', 'partially_ordered') and not rl.is_cancelled);
  if v_lines is null then
    perform public.raise_business_error('nothing_to_do', 'No items need reordering (or they are already on an open reorder requisition).');
  end if;
  return public.create_requisition(jsonb_build_object('source', 'reorder', 'notes', 'Generated from minimum stock levels', 'lines', v_lines));
end $$;

create or replace function public.cancel_requisition_line(p_line uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare rl public.purchase_requisition_lines;
begin
  perform public.require_permission('purchase_requisition.manage');
  select * into rl from public.purchase_requisition_lines where id = p_line for update;
  if public.requisition_line_open_qty(p_line) < rl.qty then
    perform public.raise_business_error('invalid_state', 'This line is already on a purchase order.');
  end if;
  if rl.sales_order_line_id is not null then
    perform public.raise_business_error('invalid_state', 'This line belongs to a customer order. Change or cancel the sales order instead.');
  end if;
  update public.purchase_requisition_lines set is_cancelled = true where id = p_line;
  perform public.requisitions_refresh(rl.requisition_id);
end $$;

-- ---------------------------------------------------------------------------
-- Supplier quotations
-- ---------------------------------------------------------------------------
create or replace function public.save_supplier_quotation(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_ccy char(3); v_rate numeric; v_line jsonb; v_n integer := 0;
  v_sup public.suppliers;
begin
  perform public.require_permission('purchase_order.create');
  select * into v_sup from public.suppliers where id = (p->>'supplier_id')::uuid;
  if not found then perform public.raise_business_error('validation', 'Select a supplier.'); end if;
  v_ccy := coalesce(nullif(p->>'currency_code', ''), v_sup.currency_code);
  v_rate := case when v_ccy = public.base_currency() then 1 else coalesce(nullif(p->>'exchange_rate', '')::numeric, public.rate_to_base(v_ccy)) end;
  if v_rate is null then perform public.raise_business_error('validation', format('Enter the exchange rate for %s.', v_ccy)); end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then perform public.raise_business_error('validation', 'Add at least one item.'); end if;
  if v_id is null then
    insert into public.supplier_quotations(doc_no, supplier_id, requisition_id, quote_date, valid_until, supplier_reference,
      currency_code, exchange_rate, delivery_days, payment_term_id, notes)
    values (public.next_document_number('supplier_quotation'), v_sup.id, nullif(p->>'requisition_id', '')::uuid,
      coalesce(nullif(p->>'quote_date', '')::date, current_date), nullif(p->>'valid_until', '')::date,
      nullif(trim(p->>'supplier_reference'), ''), v_ccy, v_rate, nullif(p->>'delivery_days', '')::int,
      coalesce(nullif(p->>'payment_term_id', '')::uuid, v_sup.payment_term_id), nullif(trim(p->>'notes'), ''))
    returning id into v_id;
  else
    if (select status from public.supplier_quotations where id = v_id) <> 'received' then
      perform public.raise_business_error('locked', 'A selected or rejected supplier quotation cannot be edited.');
    end if;
    update public.supplier_quotations set supplier_id = v_sup.id, requisition_id = nullif(p->>'requisition_id', '')::uuid,
      quote_date = coalesce(nullif(p->>'quote_date', '')::date, quote_date), valid_until = nullif(p->>'valid_until', '')::date,
      supplier_reference = nullif(trim(p->>'supplier_reference'), ''), currency_code = v_ccy, exchange_rate = v_rate,
      delivery_days = nullif(p->>'delivery_days', '')::int, payment_term_id = nullif(p->>'payment_term_id', '')::uuid,
      notes = nullif(trim(p->>'notes'), '')
    where id = v_id;
    delete from public.supplier_quotation_lines where supplier_quotation_id = v_id;
  end if;
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_n := v_n + 1;
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 or coalesce((v_line->>'unit_price')::numeric, -1) < 0 then
      perform public.raise_business_error('validation', format('Line %s: enter quantity and price.', v_n));
    end if;
    insert into public.supplier_quotation_lines(supplier_quotation_id, line_no, requisition_line_id, product_id, qty, unit_price, lead_time_days, notes)
    values (v_id, v_n, nullif(v_line->>'requisition_line_id', '')::uuid, (v_line->>'product_id')::uuid,
            (v_line->>'qty')::numeric, (v_line->>'unit_price')::numeric, nullif(v_line->>'lead_time_days', '')::int, nullif(trim(v_line->>'notes'), ''));
  end loop;
  return v_id;
end $$;

-- Choosing a supplier quote: it becomes "selected", competing quotes for the
-- same requisition are "rejected", and the supplier price list is updated.
create or replace function public.select_supplier_quotation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare q public.supplier_quotations;
begin
  perform public.require_permission('purchase_order.create');
  select * into q from public.supplier_quotations where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Supplier quotation not found.'); end if;
  if q.valid_until is not null and q.valid_until < current_date then
    perform public.raise_business_error('validation', 'This supplier quotation has expired.');
  end if;
  update public.supplier_quotations set status = 'selected' where id = p_id;
  if q.requisition_id is not null then
    update public.supplier_quotations set status = 'rejected'
     where requisition_id = q.requisition_id and id <> p_id and status = 'received';
  end if;
  insert into public.supplier_products(supplier_id, product_id, last_cost, currency_code, lead_time_days)
  select q.supplier_id, l.product_id, l.unit_price, q.currency_code, l.lead_time_days
    from public.supplier_quotation_lines l where l.supplier_quotation_id = p_id
  on conflict (supplier_id, product_id) do update
    set last_cost = excluded.last_cost, currency_code = excluded.currency_code,
        lead_time_days = coalesce(excluded.lead_time_days, public.supplier_products.lead_time_days), updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------
create or replace function public.save_purchase_order(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := nullif(p->>'id', '')::uuid;
  v_old  public.purchase_orders;
  v_sup  public.suppliers;
  v_ccy  char(3); v_rate numeric;
  v_date date := coalesce(nullif(p->>'order_date', '')::date, current_date);
  v_line jsonb; v_n integer := 0;
  v_prod public.products; v_tax public.tax_codes;
  v_rl   public.purchase_requisition_lines;
  v_open numeric;
begin
  perform public.require_permission('purchase_order.create');
  if v_id is not null then
    select * into v_old from public.purchase_orders where id = v_id for update;
    if not found then perform public.raise_business_error('not_found', 'Purchase order not found.'); end if;
    if v_old.status <> 'draft' then perform public.raise_business_error('locked', 'Only draft purchase orders can be edited.'); end if;
  end if;
  select * into v_sup from public.suppliers where id = nullif(p->>'supplier_id', '')::uuid;
  if not found then perform public.raise_business_error('validation', 'Select a supplier.'); end if;
  if v_sup.status in ('blocked', 'inactive') then perform public.raise_business_error('validation', format('Supplier %s is %s.', v_sup.name, v_sup.status)); end if;
  perform public.inv_require_active_warehouse(nullif(p->>'warehouse_id', '')::uuid);
  v_ccy := coalesce(nullif(p->>'currency_code', ''), v_sup.currency_code);
  v_rate := case when v_ccy = public.base_currency() then 1 else coalesce(nullif(p->>'exchange_rate', '')::numeric, public.rate_to_base(v_ccy, v_date)) end;
  if v_rate is null or v_rate <= 0 then perform public.raise_business_error('validation', format('Enter the exchange rate for %s.', v_ccy)); end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then perform public.raise_business_error('validation', 'Add at least one item.'); end if;

  if v_id is null then
    insert into public.purchase_orders(doc_no, supplier_id, supplier_contact_id, supplier_quotation_id, supplier_reference, order_date,
      expected_date, warehouse_id, currency_code, exchange_rate, payment_term_id, delivery_term_id, terms_conditions, notes)
    values (public.next_document_number('purchase_order', v_date), v_sup.id, nullif(p->>'supplier_contact_id', '')::uuid,
      nullif(p->>'supplier_quotation_id', '')::uuid, nullif(trim(p->>'supplier_reference'), ''), v_date,
      nullif(p->>'expected_date', '')::date, (p->>'warehouse_id')::uuid, v_ccy, v_rate,
      coalesce(nullif(p->>'payment_term_id', '')::uuid, v_sup.payment_term_id), nullif(p->>'delivery_term_id', '')::uuid,
      coalesce(p->>'terms_conditions', ''), nullif(trim(p->>'notes'), ''))
    returning id into v_id;
  else
    update public.purchase_orders set supplier_id = v_sup.id, supplier_contact_id = nullif(p->>'supplier_contact_id', '')::uuid,
      supplier_reference = nullif(trim(p->>'supplier_reference'), ''), order_date = v_date,
      expected_date = nullif(p->>'expected_date', '')::date, warehouse_id = (p->>'warehouse_id')::uuid,
      currency_code = v_ccy, exchange_rate = v_rate, payment_term_id = nullif(p->>'payment_term_id', '')::uuid,
      delivery_term_id = nullif(p->>'delivery_term_id', '')::uuid, terms_conditions = coalesce(p->>'terms_conditions', ''),
      notes = nullif(trim(p->>'notes'), '')
    where id = v_id;
    delete from public.purchase_order_lines where purchase_order_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_n := v_n + 1;
    select * into v_prod from public.products where id = nullif(v_line->>'product_id', '')::uuid;
    if not found or not v_prod.is_active then perform public.raise_business_error('validation', format('Line %s: select an active product.', v_n)); end if;
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 then perform public.raise_business_error('validation', format('Line %s: quantity must be greater than zero.', v_n)); end if;
    if coalesce(nullif(v_line->>'unit_cost', '')::numeric, -1) < 0 then perform public.raise_business_error('validation', format('Line %s: enter the unit cost.', v_n)); end if;
    select * into v_tax from public.tax_codes
     where id = coalesce(nullif(v_line->>'tax_code_id', '')::uuid, v_prod.tax_code_id, (select id from public.tax_codes where is_default));
    if not found then perform public.raise_business_error('validation', format('Line %s: select a VAT code.', v_n)); end if;
    v_rl := null;
    if nullif(v_line->>'requisition_line_id', '') is not null then
      select * into v_rl from public.purchase_requisition_lines where id = (v_line->>'requisition_line_id')::uuid;
      if not found or v_rl.is_cancelled or v_rl.product_id <> v_prod.id then
        perform public.raise_business_error('validation', format('Line %s: the requisition line does not match this product.', v_n));
      end if;
      v_open := public.requisition_line_open_qty(v_rl.id, v_id);
      if (v_line->>'qty')::numeric > v_open then
        perform public.raise_business_error('validation',
          format('Line %s: only %s left to order on the requisition (others are already on purchase orders).', v_n, v_open));
      end if;
    end if;
    insert into public.purchase_order_lines(purchase_order_id, line_no, product_id, description, uom_id, qty, unit_cost,
      tax_code_id, tax_rate, requisition_line_id, sales_order_line_id, supplier_quotation_line_id)
    values (v_id, v_n, v_prod.id, coalesce(nullif(trim(v_line->>'description'), ''), v_prod.name), v_prod.uom_id,
      (v_line->>'qty')::numeric, (v_line->>'unit_cost')::numeric, v_tax.id, v_tax.rate, v_rl.id, v_rl.sales_order_line_id,
      nullif(v_line->>'supplier_quotation_line_id', '')::uuid);
  end loop;
  return v_id;
end $$;

-- Approved POs commit their quantities: requisition and sales order lines move to "ordered".
create or replace function public.purchase_order_apply_approval(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l public.purchase_order_lines; v_req uuid;
begin
  update public.purchase_orders set status = 'approved', approved_at = now(), approved_by = auth.uid() where id = p_id;
  perform set_config('smp.allow_locked_edit', 'on', true);
  for l in select * from public.purchase_order_lines where purchase_order_id = p_id and not is_cancelled loop
    if l.requisition_line_id is not null then
      update public.purchase_requisition_lines set qty_ordered = qty_ordered + l.qty where id = l.requisition_line_id
      returning requisition_id into v_req;
      perform public.requisitions_refresh(v_req);
    end if;
    if l.sales_order_line_id is not null then
      update public.sales_order_lines set qty_ordered = least(qty, qty_ordered + l.qty) where id = l.sales_order_line_id;
    end if;
  end loop;
  perform set_config('smp.allow_locked_edit', 'off', true);
end $$;

create or replace function public.submit_purchase_order(p_id uuid)
returns public.po_status language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders; r public.approval_rules; v_reasons text[] := '{}'; v_approver text;
begin
  perform public.require_permission('purchase_order.create');
  select * into po from public.purchase_orders where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Purchase order not found.'); end if;
  if po.status <> 'draft' then perform public.raise_business_error('invalid_state', 'Only draft purchase orders can be submitted.'); end if;
  if not exists (select 1 from public.purchase_order_lines where purchase_order_id = p_id) then
    perform public.raise_business_error('validation', 'The purchase order has no items.');
  end if;
  for r in select * from public.approval_rules where doc_type = 'purchase_order' and is_active and metric = 'total_base' loop
    if (r.comparison = 'gt' and po.total_base > r.threshold) or (r.comparison = 'lt' and po.total_base < r.threshold) then
      v_reasons := v_reasons || format('%s (%s %s)', r.name, to_char(po.total_base, 'FM999,999,999,990.00'), public.base_currency());
      v_approver := r.approver_permission;
    end if;
  end loop;
  if cardinality(v_reasons) > 0 then
    update public.purchase_orders set status = 'pending_approval' where id = p_id;
    insert into public.approval_requests(doc_type, doc_id, doc_no, reasons, approver_permission, requested_by)
    values ('purchase_order', p_id, po.doc_no, v_reasons, v_approver, auth.uid());
    perform public.notify_permission_holders(v_approver, 'Purchase order awaiting approval', po.doc_no || ': ' || array_to_string(v_reasons, '; '), '/purchase-orders/' || p_id);
    return 'pending_approval';
  end if;
  perform public.purchase_order_apply_approval(p_id);
  return 'approved';
end $$;

create or replace function public.mark_purchase_order_sent(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('purchase_order.create');
  update public.purchase_orders set status = 'sent', sent_at = now() where id = p_id and status = 'approved';
  if not found then perform public.raise_business_error('invalid_state', 'Only approved purchase orders can be marked as sent.'); end if;
end $$;

create or replace function public.reopen_purchase_order(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('purchase_order.create');
  update public.approval_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where doc_type = 'purchase_order' and doc_id = p_id and status = 'pending';
  update public.purchase_orders set status = 'draft' where id = p_id and status = 'pending_approval';
  if not found then perform public.raise_business_error('invalid_state', 'Only purchase orders awaiting approval can be returned to draft.'); end if;
end $$;

create or replace function public.cancel_purchase_order(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders; l public.purchase_order_lines; v_req uuid;
begin
  perform public.require_permission('purchase_order.approve');
  select * into po from public.purchase_orders where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Purchase order not found.'); end if;
  if coalesce(trim(p_reason), '') = '' then perform public.raise_business_error('validation', 'Please give a reason for cancelling.'); end if;
  if po.status in ('cancelled', 'closed', 'received', 'partially_received') then
    perform public.raise_business_error('invalid_state', 'Goods have already been received on this purchase order. Close it instead.');
  end if;
  perform set_config('smp.allow_locked_edit', 'on', true);
  if po.status in ('approved', 'sent') then
    for l in select * from public.purchase_order_lines where purchase_order_id = p_id and not is_cancelled loop
      if l.requisition_line_id is not null then
        update public.purchase_requisition_lines set qty_ordered = greatest(qty_ordered - l.qty, 0) where id = l.requisition_line_id
        returning requisition_id into v_req;
        perform public.requisitions_refresh(v_req);
      end if;
      if l.sales_order_line_id is not null then
        update public.sales_order_lines set qty_ordered = greatest(qty_ordered - l.qty, 0) where id = l.sales_order_line_id;
      end if;
    end loop;
  end if;
  update public.approval_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where doc_type = 'purchase_order' and doc_id = p_id and status = 'pending';
  update public.purchase_orders set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_id;
  perform set_config('smp.allow_locked_edit', 'off', true);
end $$;

-- Short-close: the supplier will not deliver the rest.
create or replace function public.close_purchase_order(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare po public.purchase_orders; l public.purchase_order_lines; v_short numeric; v_req uuid;
begin
  perform public.require_permission('purchase_order.approve');
  select * into po from public.purchase_orders where id = p_id for update;
  if po.status not in ('approved', 'sent', 'partially_received', 'received') then
    perform public.raise_business_error('invalid_state', 'Only open purchase orders can be closed.');
  end if;
  perform set_config('smp.allow_locked_edit', 'on', true);
  for l in select * from public.purchase_order_lines where purchase_order_id = p_id and not is_cancelled loop
    v_short := l.qty - l.qty_received;
    continue when v_short <= 0;
    if l.requisition_line_id is not null then
      update public.purchase_requisition_lines set qty_ordered = greatest(qty_ordered - v_short, 0) where id = l.requisition_line_id
      returning requisition_id into v_req;
      perform public.requisitions_refresh(v_req);
    end if;
    if l.sales_order_line_id is not null then
      update public.sales_order_lines set qty_ordered = greatest(qty_ordered - v_short, 0) where id = l.sales_order_line_id;
    end if;
  end loop;
  update public.purchase_orders set status = 'closed', notes = concat_ws(E'\n', notes, 'Closed: ' || coalesce(trim(p_reason), '')) where id = p_id;
  perform set_config('smp.allow_locked_edit', 'off', true);
end $$;

create or replace function public.purchase_orders_refresh_status(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.purchase_orders po set status = case
      when not exists (select 1 from public.purchase_order_lines l where l.purchase_order_id = po.id and not l.is_cancelled and l.qty_received < l.qty) then 'received'
      when exists (select 1 from public.purchase_order_lines l where l.purchase_order_id = po.id and l.qty_received > 0) then 'partially_received'
      else po.status end::public.po_status
  where po.id = p_id and po.status in ('approved', 'sent', 'partially_received');
end $$;

-- ---------------------------------------------------------------------------
-- Goods receipts: now also against purchase orders (replaces the 0005 versions)
-- ---------------------------------------------------------------------------
create or replace function public.save_goods_receipt(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := nullif(p->>'id', '')::uuid;
  v_old  public.goods_receipts;
  v_po   public.purchase_orders;
  v_ccy  char(3) := coalesce(nullif(p->>'currency_code', ''), public.base_currency());
  v_rate numeric;
  v_date date := coalesce(nullif(p->>'receipt_date', '')::date, current_date);
  v_line jsonb;
  v_n    integer := 0;
  v_sol  public.sales_order_lines;
  v_pol  public.purchase_order_lines;
  v_pending numeric;
begin
  perform public.require_permission('inventory.receive');
  if v_id is not null then
    select * into v_old from public.goods_receipts where id = v_id for update;
    if not found then perform public.raise_business_error('not_found', 'Goods receipt not found.'); end if;
    if v_old.status <> 'draft' then perform public.raise_business_error('locked', 'Only draft receipts can be edited.'); end if;
  end if;
  perform public.inv_require_active_warehouse(nullif(p->>'warehouse_id', '')::uuid);
  if v_date > current_date then perform public.raise_business_error('validation', 'The receipt date cannot be in the future.'); end if;

  if nullif(p->>'purchase_order_id', '') is not null then
    select * into v_po from public.purchase_orders where id = (p->>'purchase_order_id')::uuid;
    if not found or v_po.status not in ('approved', 'sent', 'partially_received') then
      perform public.raise_business_error('validation', 'Goods can only be received against an approved, open purchase order.');
    end if;
    v_ccy := v_po.currency_code;
    v_rate := v_po.exchange_rate;
  else
    v_rate := case when v_ccy = public.base_currency() then 1
                   else coalesce(nullif(p->>'exchange_rate', '')::numeric, public.rate_to_base(v_ccy, v_date)) end;
  end if;
  if v_rate is null or v_rate <= 0 then perform public.raise_business_error('validation', format('Enter the exchange rate for %s.', v_ccy)); end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then perform public.raise_business_error('validation', 'Add at least one item.'); end if;

  if v_id is null then
    insert into public.goods_receipts(doc_no, warehouse_id, supplier_id, purchase_order_id, receipt_date, supplier_reference, currency_code, exchange_rate, notes)
    values (public.next_document_number('goods_receipt', v_date), (p->>'warehouse_id')::uuid,
      coalesce(v_po.supplier_id, nullif(p->>'supplier_id', '')::uuid), v_po.id, v_date, nullif(trim(p->>'supplier_reference'), ''), v_ccy, v_rate,
      nullif(trim(p->>'notes'), ''))
    returning id into v_id;
  else
    update public.goods_receipts set warehouse_id = (p->>'warehouse_id')::uuid, supplier_id = coalesce(v_po.supplier_id, nullif(p->>'supplier_id', '')::uuid),
      purchase_order_id = v_po.id, receipt_date = v_date, supplier_reference = nullif(trim(p->>'supplier_reference'), ''),
      currency_code = v_ccy, exchange_rate = v_rate, notes = nullif(trim(p->>'notes'), '')
    where id = v_id;
    delete from public.goods_receipt_lines where goods_receipt_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_n := v_n + 1;
    perform public.inv_validate_stock_product(nullif(v_line->>'product_id', '')::uuid, v_n);
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 then
      perform public.raise_business_error('validation', format('Line %s: quantity must be greater than zero.', v_n));
    end if;
    v_pol := null;
    if nullif(v_line->>'purchase_order_line_id', '') is not null then
      select * into v_pol from public.purchase_order_lines where id = (v_line->>'purchase_order_line_id')::uuid;
      if not found or v_pol.purchase_order_id is distinct from v_po.id or v_pol.product_id <> (v_line->>'product_id')::uuid or v_pol.is_cancelled then
        perform public.raise_business_error('validation', format('Line %s does not match the purchase order.', v_n));
      end if;
      -- Other draft receipts against the same PO line count too, so it can't be over-received.
      select coalesce(sum(gl.qty), 0) into v_pending from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.goods_receipt_id
       where gl.purchase_order_line_id = v_pol.id and g.status = 'draft' and g.id <> v_id;
      if (v_line->>'qty')::numeric > v_pol.qty - v_pol.qty_received - v_pending then
        perform public.raise_business_error('validation', format('Line %s: only %s still to be received on the purchase order.', v_n,
          greatest(v_pol.qty - v_pol.qty_received - v_pending, 0)));
      end if;
    elsif v_po.id is not null then
      perform public.raise_business_error('validation', format('Line %s: choose the purchase order line being received.', v_n));
    end if;
    if coalesce(v_pol.unit_cost, nullif(v_line->>'unit_cost', '')::numeric, -1) < 0 then
      perform public.raise_business_error('validation', format('Line %s: enter the unit cost.', v_n));
    end if;
    if coalesce(v_pol.sales_order_line_id, nullif(v_line->>'sales_order_line_id', '')::uuid) is not null then
      select * into v_sol from public.sales_order_lines where id = coalesce(v_pol.sales_order_line_id, (v_line->>'sales_order_line_id')::uuid);
      if not found or v_sol.product_id <> (v_line->>'product_id')::uuid or v_sol.fulfilment_mode <> 'procure' then
        perform public.raise_business_error('validation',
          format('Line %s: the linked order line must be a direct-procurement line for the same product.', v_n));
      end if;
    end if;
    insert into public.goods_receipt_lines(goods_receipt_id, line_no, product_id, qty, unit_cost, purchase_order_line_id, sales_order_line_id, notes)
    values (v_id, v_n, (v_line->>'product_id')::uuid, (v_line->>'qty')::numeric,
      coalesce(v_pol.unit_cost, (v_line->>'unit_cost')::numeric), v_pol.id,
      coalesce(v_pol.sales_order_line_id, nullif(v_line->>'sales_order_line_id', '')::uuid), nullif(trim(v_line->>'notes'), ''));
  end loop;
  return v_id;
end $$;

create or replace function public.post_goods_receipt(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  g    public.goods_receipts;
  l    public.goods_receipt_lines;
  v_sol public.sales_order_lines;
  v_pol public.purchase_order_lines;
  v_cost numeric;
  v_for_order numeric;
  v_prev_lock text;
begin
  perform public.require_permission('inventory.receive');
  select * into g from public.goods_receipts where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Goods receipt not found.'); end if;
  if g.status <> 'draft' then perform public.raise_business_error('invalid_state', 'This receipt is already posted or cancelled.'); end if;
  perform public.inv_require_active_warehouse(g.warehouse_id);
  v_prev_lock := coalesce(current_setting('smp.allow_locked_edit', true), '');

  for l in select * from public.goods_receipt_lines where goods_receipt_id = p_id order by product_id, line_no loop
    -- Purchase order line: re-check the open quantity under a lock.
    if l.purchase_order_line_id is not null then
      select * into v_pol from public.purchase_order_lines where id = l.purchase_order_line_id for update;
      if l.qty > v_pol.qty - v_pol.qty_received then
        perform public.raise_business_error('validation', format('%s: only %s still to be received on the purchase order.',
          v_pol.description, v_pol.qty - v_pol.qty_received));
      end if;
      perform set_config('smp.allow_locked_edit', 'on', true);
      update public.purchase_order_lines set qty_received = qty_received + l.qty where id = v_pol.id;
      perform set_config('smp.allow_locked_edit', v_prev_lock, true);
    end if;

    v_cost := round(l.unit_cost * g.exchange_rate, 4);
    perform public.stock_post_movement(l.product_id, g.warehouse_id, 'receipt', l.qty, v_cost,
      'goods_receipt', g.id, l.id, g.doc_no, g.supplier_reference, 0, false, l.sales_order_line_id);
    perform set_config('smp.stock_posting', 'on', true);
    update public.goods_receipt_lines set unit_cost_base = v_cost where id = l.id;
    perform set_config('smp.stock_posting', 'off', true);

    -- Back-to-back: received goods are reserved for the customer order at once.
    if l.sales_order_line_id is not null then
      select * into v_sol from public.sales_order_lines where id = l.sales_order_line_id for update;
      v_for_order := least(l.qty, greatest(v_sol.qty - v_sol.qty_received, 0));
      if v_for_order > 0 then
        perform set_config('smp.allow_locked_edit', 'on', true);
        update public.sales_order_lines set qty_received = qty_received + v_for_order, warehouse_id = g.warehouse_id where id = v_sol.id;
        perform set_config('smp.allow_locked_edit', v_prev_lock, true);
        if not v_sol.is_cancelled then
          perform public.stock_reserve(v_sol.id, g.warehouse_id, v_for_order, 'Reserved on receipt ' || g.doc_no);
        end if;
      end if;
    end if;
  end loop;

  if g.purchase_order_id is not null then perform public.purchase_orders_refresh_status(g.purchase_order_id); end if;
  update public.goods_receipts set status = 'posted', posted_at = now(), posted_by = auth.uid() where id = p_id;
  perform public.notify_permission_holders('sales_order.view_all', 'Goods received', g.doc_no || ' posted', '/inventory/receipts/' || p_id);
end $$;

-- ---------------------------------------------------------------------------
-- Incoming stock now includes open purchase orders.
-- ---------------------------------------------------------------------------
create or replace view public.v_stock_incoming as
select product_id, warehouse_id, sum(qty) as qty_incoming from (
  select tl.product_id, t.to_warehouse_id as warehouse_id, tl.qty
    from public.stock_transfers t join public.stock_transfer_lines tl on tl.stock_transfer_id = t.id
   where t.status = 'in_transit'
  union all
  select pol.product_id, po.warehouse_id, pol.qty - pol.qty_received
    from public.purchase_orders po join public.purchase_order_lines pol on pol.purchase_order_id = po.id
   where po.status in ('approved', 'sent', 'partially_received') and not pol.is_cancelled and pol.qty > pol.qty_received
) x group by product_id, warehouse_id;
revoke all on public.v_stock_incoming from anon, authenticated;

-- Open requisition lines (what procurement still has to buy).
create or replace view public.v_open_requisition_lines as
select rl.id, rl.requisition_id, r.doc_no as requisition_no, r.source, r.required_date, r.created_at,
       rl.product_id, p.sku, p.name as product_name, u.code as uom_code, rl.description,
       rl.qty, public.requisition_line_open_qty(rl.id) as qty_open,
       rl.suggested_supplier_id, s.name as suggested_supplier,
       rl.sales_order_line_id, so.doc_no as sales_order_no, c.name as customer_name
from public.purchase_requisition_lines rl
join public.purchase_requisitions r on r.id = rl.requisition_id
join public.products p on p.id = rl.product_id
join public.units_of_measure u on u.id = p.uom_id
left join public.suppliers s on s.id = rl.suggested_supplier_id
left join public.sales_order_lines sol on sol.id = rl.sales_order_line_id
left join public.sales_orders so on so.id = sol.sales_order_id
left join public.customers c on c.id = so.customer_id
where not rl.is_cancelled and r.status in ('open', 'partially_ordered')
  and public.requisition_line_open_qty(rl.id) > 0
  and public.has_permission('purchase_requisition.manage');
revoke all on public.v_open_requisition_lines from anon;
grant select on public.v_open_requisition_lines to authenticated;

-- ---------------------------------------------------------------------------
-- Approval routing for purchase orders
-- ---------------------------------------------------------------------------
-- decide_approval (0007) hands any document type it doesn't know to this function;
-- later modules re-create it with their own branches.
create or replace function public.decide_approval_extension(a public.approval_requests, p_approve boolean, p_comment text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if a.doc_type <> 'purchase_order' then
    perform public.raise_business_error('invalid_state', format('No approval handler for %s.', a.doc_type));
  end if;
  if p_approve then
    perform public.purchase_order_apply_approval(a.doc_id);
  else
    update public.purchase_orders set status = 'draft' where id = a.doc_id and status = 'pending_approval';
  end if;
  perform public.notify_user(a.requested_by, 'Purchase order ' || a.doc_no || case when p_approve then ' approved' else ' rejected' end,
    p_comment, '/purchase-orders/' || a.doc_id);
end $$;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------
alter table public.supplier_contacts enable row level security;
alter table public.supplier_quotations enable row level security;
alter table public.supplier_quotation_lines enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_lines enable row level security;
revoke insert, update, delete, truncate on public.supplier_quotations, public.supplier_quotation_lines,
  public.purchase_orders, public.purchase_order_lines from anon, authenticated;

create policy supplier_contacts_read on public.supplier_contacts for select to authenticated using (public.has_permission('supplier.view'));
create policy supplier_contacts_write on public.supplier_contacts for all to authenticated
  using (public.has_permission('supplier.edit')) with check (public.has_permission('supplier.edit'));
create policy supplier_quotations_read on public.supplier_quotations for select to authenticated
  using (public.has_permission('purchase_order.view') or public.has_permission('purchase_requisition.manage'));
create policy supplier_quotation_lines_read on public.supplier_quotation_lines for select to authenticated
  using (exists (select 1 from public.supplier_quotations q where q.id = supplier_quotation_id));
create policy purchase_orders_read on public.purchase_orders for select to authenticated
  using (public.has_permission('purchase_order.view'));
create policy purchase_order_lines_read on public.purchase_order_lines for select to authenticated
  using (exists (select 1 from public.purchase_orders po where po.id = purchase_order_id));

revoke execute on function public.purchase_order_apply_approval(uuid) from public, anon, authenticated;
revoke execute on function public.purchase_orders_recalc(uuid) from public, anon, authenticated;
revoke execute on function public.purchase_orders_refresh_status(uuid) from public, anon, authenticated;
revoke execute on function public.requisitions_refresh(uuid) from public, anon, authenticated;
revoke execute on function public.decide_approval_extension(public.approval_requests, boolean, text) from public, anon, authenticated;

-- Standard purchase order terms printed on every PO (editable in System Settings).
alter table public.company_settings add column purchase_order_terms text not null default
  E'1. Please quote our PO number on all delivery notes and invoices.\n2. Goods must match the specifications and quantities ordered; partial deliveries only with our written consent.\n3. Tax invoices must show your TRN and comply with UAE VAT requirements.\n4. We may reject goods that are damaged, non-conforming or delivered late.';
