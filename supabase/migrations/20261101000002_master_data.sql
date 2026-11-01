-- =============================================================================
-- 0002 Master data — customers, suppliers, products, stock balances.
-- =============================================================================

create type public.party_status as enum ('active', 'on_hold', 'blocked', 'inactive');
create type public.address_kind as enum ('billing', 'shipping');
create type public.item_type as enum ('stock', 'non_stock', 'service');
create type public.customer_type as enum ('company', 'government', 'individual');

-- Normalise a company name for duplicate detection:
-- "ABC Trading L.L.C." and "abc trading llc" both become "abc trading".
create or replace function public.normalize_party_name(p text)
returns text language sql immutable as $$
  select trim(regexp_replace(
           regexp_replace(lower(coalesce(p, '')), '[^a-z0-9 ]', '', 'g'),
           '\m(llc|l l c|fze|fzco|fz llc|fzllc|est|establishment|co|company|ltd|limited|trading|general trading|gt)\M', '', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique,
  name               text not null check (length(trim(name)) > 1),
  name_normalized    text generated always as (public.normalize_party_name(name)) stored,
  customer_type      public.customer_type not null default 'company',
  trade_license_no   text,
  trn                text check (trn is null or trn ~ '^[0-9]{15}$'),
  vat_registered     boolean not null default false,
  default_tax_code_id uuid references public.tax_codes(id),
  industry           text,
  website            text,
  email              citext,
  phone              text,
  currency_code      char(3) not null default 'AED' references public.currencies(code),
  payment_term_id    uuid references public.payment_terms(id),
  delivery_term_id   uuid references public.delivery_terms(id),
  credit_limit       numeric(18,2) not null default 0 check (credit_limit >= 0),
  account_manager_id uuid references public.profiles(id),
  status             public.party_status not null default 'active',
  source             text,
  notes              text,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles(id),
  constraint customers_vat_trn check (not vat_registered or trn is not null)
);
create unique index customers_trn_unique on public.customers(trn) where trn is not null;
create index customers_name_norm_idx on public.customers(name_normalized);
create index customers_manager_idx on public.customers(account_manager_id);
create index customers_status_idx on public.customers(status);
select public.attach_standard_triggers('public.customers');

create table public.customer_contacts (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  designation text,
  email       citext,
  phone       text,
  mobile      text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);
create index on public.customer_contacts(customer_id);
create unique index customer_contacts_one_primary on public.customer_contacts(customer_id) where is_primary;
select public.attach_standard_triggers('public.customer_contacts');

create table public.customer_addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  kind        public.address_kind not null,
  label       text,
  line1       text not null,
  line2       text,
  city        text not null,
  emirate     text,
  country     text not null default 'United Arab Emirates',
  po_box      text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles(id)
);
create index on public.customer_addresses(customer_id);
create unique index customer_addresses_one_default on public.customer_addresses(customer_id, kind) where is_default;
select public.attach_standard_triggers('public.customer_addresses');

-- Customer code assigned by the database, never by the client.
create or replace function public.customers_assign_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code is null or new.code = '' then
    new.code := public.next_document_number('customer');
  end if;
  return new;
end $$;
create trigger customers_code before insert on public.customers
  for each row execute function public.customers_assign_code();

-- ---------------------------------------------------------------------------
-- Suppliers (master only; procurement screens arrive in phase 3)
-- ---------------------------------------------------------------------------
create table public.suppliers (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null check (length(trim(name)) > 1),
  name_normalized  text generated always as (public.normalize_party_name(name)) stored,
  trn              text check (trn is null or trn ~ '^[0-9]{15}$'),
  country          text,
  email            citext,
  phone            text,
  currency_code    char(3) not null default 'AED' references public.currencies(code),
  payment_term_id  uuid references public.payment_terms(id),
  lead_time_days   integer not null default 0 check (lead_time_days >= 0),
  status           public.party_status not null default 'active',
  notes            text,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.profiles(id)
);
create unique index suppliers_trn_unique on public.suppliers(trn) where trn is not null;
select public.attach_standard_triggers('public.suppliers');

create or replace function public.suppliers_assign_code()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.code is null or new.code = '' then
    new.code := public.next_document_number('supplier');
  end if;
  return new;
end $$;
create trigger suppliers_code before insert on public.suppliers
  for each row execute function public.suppliers_assign_code();

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
create table public.product_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  parent_id  uuid references public.product_categories(id),
  is_active  boolean not null default true,
  unique (parent_id, name)
);

create table public.brands (
  id        uuid primary key default gen_random_uuid(),
  name      text not null unique,
  is_active boolean not null default true
);

create table public.products (
  id                 uuid primary key default gen_random_uuid(),
  sku                text not null unique,
  name               text not null check (length(trim(name)) > 1),
  description        text,
  category_id        uuid references public.product_categories(id),
  brand_id           uuid references public.brands(id),
  uom_id             uuid not null references public.units_of_measure(id),
  item_type          public.item_type not null default 'stock',
  default_sell_price numeric(18,2) not null default 0 check (default_sell_price >= 0),
  tax_code_id        uuid references public.tax_codes(id),
  min_stock_level    numeric(18,3) not null default 0 check (min_stock_level >= 0),
  reorder_qty        numeric(18,3) not null default 0 check (reorder_qty >= 0),
  hs_code            text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.profiles(id)
);
create index products_name_idx on public.products using gin (to_tsvector('simple', name || ' ' || sku));
select public.attach_standard_triggers('public.products');

create or replace function public.products_assign_sku()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sku is null or new.sku = '' then
    new.sku := public.next_document_number('product');
  end if;
  return new;
end $$;
create trigger products_sku before insert on public.products
  for each row execute function public.products_assign_sku();

create table public.supplier_products (
  id              uuid primary key default gen_random_uuid(),
  supplier_id     uuid not null references public.suppliers(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  supplier_sku    text,
  last_cost       numeric(18,4) not null default 0 check (last_cost >= 0),
  currency_code   char(3) not null default 'AED' references public.currencies(code),
  lead_time_days  integer check (lead_time_days >= 0),
  is_preferred    boolean not null default false,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  unique (supplier_id, product_id)
);
create unique index supplier_products_one_preferred on public.supplier_products(product_id) where is_preferred;
select public.attach_standard_triggers('public.supplier_products');


-- =============================================================================
-- STOCK ENGINE
-- stock_levels    : current balance per product per warehouse (a cache).
-- stock_movements : immutable ledger — the source of truth.
-- The ONLY code that changes a balance is stock_post_movement() /
-- stock_reserve() / stock_release(), each of which writes a movement in the
-- same transaction. A deferred check at commit proves balance = ledger.
-- =============================================================================
create type public.movement_type as enum (
  'opening',        -- opening balance on go-live            (+ on hand)
  'receipt',        -- goods received note                    (+)
  'return_in',      -- customer return restocked              (+)
  'transfer_in',    -- transfer arriving at this warehouse    (+)
  'adjust_in',      -- approved positive adjustment           (+)
  'issue',          -- goods issued / delivered               (−)
  'transfer_out',   -- transfer leaving this warehouse        (−)
  'adjust_out',     -- approved negative adjustment           (−)
  'return_out',     -- returned to supplier                   (−)
  'reserve',        -- stock set aside for an order line      (reserved +)
  'release'         -- reservation released                   (reserved −)
);

create table public.stock_levels (
  product_id    uuid not null references public.products(id),
  warehouse_id  uuid not null references public.warehouses(id),
  qty_on_hand   numeric(18,3) not null default 0,
  qty_reserved  numeric(18,3) not null default 0 check (qty_reserved >= 0),
  qty_available numeric(18,3) generated always as (qty_on_hand - qty_reserved) stored,
  avg_cost      numeric(18,4) not null default 0 check (avg_cost >= 0),   -- base currency
  stock_value   numeric(18,2) generated always as (round(greatest(qty_on_hand, 0) * avg_cost, 2)) stored,
  last_movement_at timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (product_id, warehouse_id),
  -- Reserved stock must physically exist (and none can be reserved while negative).
  constraint stock_reserved_le_on_hand check (qty_reserved <= greatest(qty_on_hand, 0))
);
create index stock_levels_wh_idx on public.stock_levels(warehouse_id);

create table public.stock_movements (
  id               uuid primary key default gen_random_uuid(),
  seq              bigint generated always as identity unique,   -- strict posting order
  product_id       uuid not null references public.products(id),
  warehouse_id     uuid not null references public.warehouses(id),
  movement_type    public.movement_type not null,
  qty              numeric(18,3) not null check (qty > 0),
  on_hand_change   numeric(18,3) not null,                       -- signed
  reserved_change  numeric(18,3) not null default 0,             -- signed
  unit_cost        numeric(18,4) not null default 0 check (unit_cost >= 0),   -- base currency
  value_change     numeric(18,2) not null default 0,             -- signed, base currency
  on_hand_after    numeric(18,3) not null,
  reserved_after   numeric(18,3) not null,
  avg_cost_after   numeric(18,4) not null,
  source_type      text not null,                                -- goods_receipt, stock_transfer, ...
  source_id        uuid,
  source_line_id   uuid,
  source_doc_no    text,
  sales_order_line_id uuid,                                      -- FK added in 0003
  negative_authorised_by uuid references public.profiles(id),
  notes            text,
  moved_at         timestamptz not null default now(),
  created_by       uuid references public.profiles(id) default auth.uid(),
  constraint stock_movements_signs check (
    case
      when movement_type in ('opening','receipt','return_in','transfer_in','adjust_in')
        then on_hand_change = qty and reserved_change = 0
      when movement_type in ('issue','transfer_out','adjust_out','return_out')
        then on_hand_change = -qty and reserved_change <= 0
      when movement_type = 'reserve' then on_hand_change = 0 and reserved_change = qty
      when movement_type = 'release' then on_hand_change = 0 and reserved_change = -qty
    end)
);
create index stock_movements_product_idx on public.stock_movements(product_id, warehouse_id, seq desc);
create index stock_movements_source_idx on public.stock_movements(source_type, source_id);
create index stock_movements_date_idx on public.stock_movements(moved_at desc);

-- The ledger can never be edited or deleted.
create or replace function public.stock_movements_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'Stock movements are permanent. Post a reversing transaction instead.';
end $$;
create trigger stock_movements_no_change before update or delete on public.stock_movements
  for each row execute function public.stock_movements_immutable();

-- Balances can only be written by the posting functions (they set a
-- transaction-local flag). Blocks direct edits from ANY role, even service_role.
create or replace function public.stock_levels_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('smp.stock_posting', true), '') <> 'on' then
    raise exception using errcode = 'P0001', hint = 'forbidden',
      message = 'Stock balances cannot be edited directly. Post a stock transaction (receipt, issue, transfer or approved adjustment).';
  end if;
  if tg_op = 'UPDATE' and new.qty_on_hand < 0 and new.qty_on_hand < old.qty_on_hand
     and coalesce(current_setting('smp.negative_authorised', true), '') <> 'on' then
    raise exception using errcode = 'P0001', hint = 'negative_stock',
      message = 'This transaction would make stock negative, which requires management authorisation.';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Stock balances cannot be deleted.';
  end if;
  return new;
end $$;
create trigger stock_levels_guard before insert or update or delete on public.stock_levels
  for each row execute function public.stock_levels_guard();

-- At commit: balance must equal the ledger, and reserved must equal the
-- active reservations. Any inconsistency rolls the whole transaction back.
create or replace function public.stock_levels_verify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ledger_on_hand numeric;
  v_ledger_reserved numeric;
  v_active numeric;
  v_level public.stock_levels;
begin
  select * into v_level from public.stock_levels
   where product_id = new.product_id and warehouse_id = new.warehouse_id;
  select coalesce(sum(on_hand_change), 0), coalesce(sum(reserved_change), 0)
    into v_ledger_on_hand, v_ledger_reserved
    from public.stock_movements where product_id = new.product_id and warehouse_id = new.warehouse_id;
  select coalesce(sum(qty), 0) into v_active from public.stock_reservations
   where product_id = new.product_id and warehouse_id = new.warehouse_id and status = 'active';
  if v_level.qty_on_hand <> v_ledger_on_hand then
    raise exception 'Stock integrity: on-hand % ≠ ledger % for product % in warehouse %',
      v_level.qty_on_hand, v_ledger_on_hand, new.product_id, new.warehouse_id;
  end if;
  if v_level.qty_reserved <> v_ledger_reserved or v_level.qty_reserved <> v_active then
    raise exception 'Stock integrity: reserved % ≠ ledger % / active reservations % for product % in warehouse %',
      v_level.qty_reserved, v_ledger_reserved, v_active, new.product_id, new.warehouse_id;
  end if;
  return null;
end $$;
create constraint trigger stock_levels_verify
  after insert or update on public.stock_levels
  deferrable initially deferred
  for each row execute function public.stock_levels_verify();

-- -----------------------------------------------------------------------------
-- stock_post_movement — the single entry point for on-hand changes.
-- p_unit_cost: base-currency cost for inbound valued movements; ignored for
-- outbound (they leave at current average cost).
-- p_consume_reservation: outbound qty that may come out of reserved stock
-- (a delivery of a reserved order line). Otherwise only AVAILABLE stock can
-- leave, so nobody can take stock promised to a customer.
-- p_allow_negative: honoured only for holders of inventory.allow_negative.
-- Internal: not callable through the API.
-- -----------------------------------------------------------------------------
create or replace function public.stock_post_movement(
  p_product_id uuid, p_warehouse_id uuid, p_type public.movement_type, p_qty numeric,
  p_unit_cost numeric, p_source_type text, p_source_id uuid, p_source_line_id uuid,
  p_source_doc_no text, p_notes text default null,
  p_consume_reservation numeric default 0, p_allow_negative boolean default false,
  p_sales_order_line_id uuid default null)
returns public.stock_movements
language plpgsql security definer set search_path = public as $$
declare
  v_level  public.stock_levels;
  v_prod   public.products;
  v_in     boolean := p_type in ('opening','receipt','return_in','transfer_in','adjust_in');
  v_change numeric;
  v_res_change numeric := 0;
  v_new_on_hand numeric;
  v_new_avg numeric;
  v_cost   numeric;
  v_mv     public.stock_movements;
  v_neg_by uuid;
begin
  if p_type in ('reserve', 'release') then
    raise exception 'Use stock_reserve / stock_release for reservations.';
  end if;
  if p_qty is null or p_qty <= 0 then
    perform public.raise_business_error('validation', 'Quantity must be greater than zero.');
  end if;
  select * into v_prod from public.products where id = p_product_id;
  if not found or v_prod.item_type <> 'stock' then
    perform public.raise_business_error('validation', 'Only stock items can be moved in inventory.');
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse_id and is_active) then
    perform public.raise_business_error('validation', 'Warehouse is inactive or does not exist.');
  end if;

  perform set_config('smp.stock_posting', 'on', true);
  insert into public.stock_levels(product_id, warehouse_id) values (p_product_id, p_warehouse_id)
  on conflict do nothing;
  select * into v_level from public.stock_levels
   where product_id = p_product_id and warehouse_id = p_warehouse_id for update;

  if v_in then
    if p_unit_cost is null or p_unit_cost < 0 then
      perform public.raise_business_error('validation', 'A unit cost is required for incoming stock.');
    end if;
    v_change := p_qty;
    v_cost := round(p_unit_cost, 4);
    v_new_on_hand := v_level.qty_on_hand + p_qty;
    -- Weighted average; when stock was zero/negative the new cost becomes the receipt cost.
    v_new_avg := case when v_level.qty_on_hand <= 0 then v_cost
                      else round((v_level.qty_on_hand * v_level.avg_cost + p_qty * v_cost) / v_new_on_hand, 4) end;
  else
    v_change := -p_qty;
    v_cost := v_level.avg_cost;
    v_new_on_hand := v_level.qty_on_hand - p_qty;
    v_new_avg := v_level.avg_cost;
    if coalesce(p_consume_reservation, 0) < 0 or coalesce(p_consume_reservation, 0) > p_qty then
      raise exception 'Invalid reservation consumption.';
    end if;
    v_res_change := -coalesce(p_consume_reservation, 0);
    if v_level.qty_reserved + v_res_change < 0 then
      raise exception 'Cannot consume more reserved stock than is reserved.';
    end if;
    -- Unreserved part must come from available stock.
    if p_qty - coalesce(p_consume_reservation, 0) > greatest(v_level.qty_available, 0) then
      if v_new_on_hand >= 0 then
        perform public.raise_business_error('reserved_stock',
          format('%s: only %s available (the rest is reserved for customer orders).',
                 v_prod.name, greatest(v_level.qty_available, 0)));
      end if;
    end if;
    if v_new_on_hand < 0 then
      if not (p_allow_negative and public.has_permission('inventory.allow_negative')) then
        perform public.raise_business_error('negative_stock',
          format('%s: insufficient stock (on hand %s, required %s). Negative stock needs management authorisation.',
                 v_prod.name, v_level.qty_on_hand, p_qty));
      end if;
      if v_level.qty_reserved + v_res_change > 0 then
        perform public.raise_business_error('reserved_stock',
          format('%s: cannot go negative while stock is reserved for orders.', v_prod.name));
      end if;
      v_neg_by := auth.uid();
      perform set_config('smp.negative_authorised', 'on', true);
    end if;
  end if;

  update public.stock_levels
     set qty_on_hand = v_new_on_hand,
         qty_reserved = qty_reserved + v_res_change,
         avg_cost = v_new_avg,
         last_movement_at = now(),
         updated_at = now()
   where product_id = p_product_id and warehouse_id = p_warehouse_id;

  insert into public.stock_movements(product_id, warehouse_id, movement_type, qty, on_hand_change, reserved_change,
    unit_cost, value_change, on_hand_after, reserved_after, avg_cost_after, source_type, source_id, source_line_id,
    source_doc_no, sales_order_line_id, negative_authorised_by, notes)
  values (p_product_id, p_warehouse_id, p_type, p_qty, v_change, v_res_change, v_cost, round(v_change * v_cost, 2),
    v_new_on_hand, v_level.qty_reserved + v_res_change, v_new_avg, p_source_type, p_source_id, p_source_line_id,
    p_source_doc_no, p_sales_order_line_id, v_neg_by, p_notes)
  returning * into v_mv;

  perform set_config('smp.negative_authorised', 'off', true);
  perform set_config('smp.stock_posting', 'off', true);
  return v_mv;
end $$;

-- stock_reserve / stock_release live in 0005 (they need stock_reservations from 0004).
