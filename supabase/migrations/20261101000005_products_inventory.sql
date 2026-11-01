-- =============================================================================
-- 0005 Product Master & Inventory Management
--
-- Stock rules enforced here and in the stock engine (0002):
--   * Available = Physical − Reserved, kept as a generated column.
--   * Every change to a balance is a row in stock_movements (immutable).
--   * Balances can't be edited directly by any role; only posting functions
--     may touch them, and a deferred check proves balance = ledger at commit.
--   * Stock never goes negative unless a holder of inventory.allow_negative
--     authorises that specific transaction (recorded on the movement).
--   * Reserved stock can't be issued, transferred or adjusted away.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- stock_reserve — set stock aside for a sales order line.
-- One active reservation row per (order line, warehouse): repeated calls add
-- to it, so duplicate reservations cannot exist.
-- -----------------------------------------------------------------------------
create or replace function public.stock_reserve(
  p_sales_order_line_id uuid, p_warehouse_id uuid, p_qty numeric, p_notes text default null)
returns numeric   -- quantity actually reserved (may be less than asked when stock is short)
language plpgsql security definer set search_path = public as $$
declare
  v_line   record;
  v_level  public.stock_levels;
  v_take   numeric;
  v_prev_lock text := coalesce(current_setting('smp.allow_locked_edit', true), '');
begin
  if p_qty is null or p_qty <= 0 then return 0; end if;
  select l.*, so.doc_no as so_doc_no, so.status as so_status into v_line
    from public.sales_order_lines l join public.sales_orders so on so.id = l.sales_order_id
   where l.id = p_sales_order_line_id for update of l;
  if not found then perform public.raise_business_error('not_found', 'Order line not found.'); end if;
  if v_line.is_cancelled then perform public.raise_business_error('invalid_state', 'Order line is cancelled.'); end if;
  if v_line.so_status not in ('draft', 'pending_approval', 'confirmed', 'partially_fulfilled', 'on_hold') then
    perform public.raise_business_error('invalid_state', 'Stock can only be reserved for open orders.');
  end if;

  perform set_config('smp.stock_posting', 'on', true);
  insert into public.stock_levels(product_id, warehouse_id) values (v_line.product_id, p_warehouse_id)
  on conflict do nothing;
  select * into v_level from public.stock_levels
   where product_id = v_line.product_id and warehouse_id = p_warehouse_id for update;

  v_take := least(p_qty, greatest(v_level.qty_available, 0),
                  v_line.qty - v_line.qty_reserved - v_line.qty_delivered);
  if v_take <= 0 then
    perform set_config('smp.stock_posting', 'off', true);
    return 0;
  end if;

  update public.stock_levels set qty_reserved = qty_reserved + v_take, last_movement_at = now(), updated_at = now()
   where product_id = v_line.product_id and warehouse_id = p_warehouse_id;

  insert into public.stock_reservations(sales_order_line_id, product_id, warehouse_id, qty)
  values (p_sales_order_line_id, v_line.product_id, p_warehouse_id, v_take)
  on conflict (sales_order_line_id, warehouse_id) where status = 'active'
  do update set qty = public.stock_reservations.qty + excluded.qty;

  perform set_config('smp.allow_locked_edit', 'on', true);
  update public.sales_order_lines set qty_reserved = qty_reserved + v_take where id = p_sales_order_line_id;
  perform set_config('smp.allow_locked_edit', v_prev_lock, true);

  insert into public.stock_movements(product_id, warehouse_id, movement_type, qty, on_hand_change, reserved_change,
    unit_cost, value_change, on_hand_after, reserved_after, avg_cost_after, source_type, source_id, source_line_id,
    source_doc_no, sales_order_line_id, notes)
  values (v_line.product_id, p_warehouse_id, 'reserve', v_take, 0, v_take, v_level.avg_cost, 0,
    v_level.qty_on_hand, v_level.qty_reserved + v_take, v_level.avg_cost, 'sales_order', v_line.sales_order_id,
    p_sales_order_line_id, v_line.so_doc_no, p_sales_order_line_id, p_notes);

  perform set_config('smp.stock_posting', 'off', true);
  return v_take;
end $$;

-- -----------------------------------------------------------------------------
-- stock_release — give reserved stock back to "available".
-- p_consumed = true when the stock is leaving through an issue/delivery (the
-- issue movement then carries the reserved change; no separate release row).
-- -----------------------------------------------------------------------------
create or replace function public.stock_release(
  p_reservation_id uuid, p_qty numeric, p_reason text, p_consumed boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  r       public.stock_reservations;
  v_level public.stock_levels;
  v_doc   text;
  v_prev_lock text := coalesce(current_setting('smp.allow_locked_edit', true), '');
begin
  select * into r from public.stock_reservations where id = p_reservation_id for update;
  if not found or r.status <> 'active' then
    perform public.raise_business_error('invalid_state', 'Reservation is not active.');
  end if;
  if p_qty is null or p_qty <= 0 or p_qty > r.qty then
    perform public.raise_business_error('validation', format('Release quantity must be between 0 and %s.', r.qty));
  end if;

  perform set_config('smp.stock_posting', 'on', true);
  perform set_config('smp.allow_locked_edit', 'on', true);
  select * into v_level from public.stock_levels
   where product_id = r.product_id and warehouse_id = r.warehouse_id for update;

  update public.stock_reservations
     set qty = case when qty - p_qty = 0 then qty else qty - p_qty end,
         status = case when qty - p_qty = 0 then (case when p_consumed then 'consumed' else 'released' end) else status end,
         released_at = case when qty - p_qty = 0 then now() else released_at end
   where id = r.id;
  update public.sales_order_lines set qty_reserved = qty_reserved - p_qty where id = r.sales_order_line_id;

  if not p_consumed then
    update public.stock_levels set qty_reserved = qty_reserved - p_qty, last_movement_at = now(), updated_at = now()
     where product_id = r.product_id and warehouse_id = r.warehouse_id;
    select so.doc_no into v_doc from public.sales_order_lines l join public.sales_orders so on so.id = l.sales_order_id
     where l.id = r.sales_order_line_id;
    insert into public.stock_movements(product_id, warehouse_id, movement_type, qty, on_hand_change, reserved_change,
      unit_cost, value_change, on_hand_after, reserved_after, avg_cost_after, source_type, source_id, source_line_id,
      source_doc_no, sales_order_line_id, notes)
    values (r.product_id, r.warehouse_id, 'release', p_qty, 0, -p_qty, v_level.avg_cost, 0,
      v_level.qty_on_hand, v_level.qty_reserved - p_qty, v_level.avg_cost, 'stock_reservation', r.id,
      r.sales_order_line_id, v_doc, r.sales_order_line_id, p_reason);
  end if;
  perform set_config('smp.allow_locked_edit', v_prev_lock, true);
  perform set_config('smp.stock_posting', 'off', true);
end $$;

-- =============================================================================
-- MANUAL RESERVATION / RELEASE (API wrappers with permission checks)
-- =============================================================================
create or replace function public.reserve_stock_for_order_line(
  p_sales_order_line_id uuid, p_warehouse_id uuid, p_qty numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_line public.sales_order_lines;
  v_got  numeric;
begin
  perform public.require_permission('inventory.reserve');
  select * into v_line from public.sales_order_lines where id = p_sales_order_line_id;
  if not found then perform public.raise_business_error('not_found', 'Order line not found.'); end if;
  if v_line.fulfilment_mode = 'procure' and v_line.qty_received <= v_line.qty_reserved + v_line.qty_delivered then
    perform public.raise_business_error('validation',
      'This line is set to direct procurement; stock is reserved automatically when its goods are received. Change the line to stock fulfilment first.');
  end if;
  if p_qty is null or p_qty <= 0 then
    perform public.raise_business_error('validation', 'Quantity must be greater than zero.');
  end if;
  v_got := public.stock_reserve(p_sales_order_line_id, p_warehouse_id, p_qty, 'Manual reservation');
  if v_got = 0 then
    perform public.raise_business_error('insufficient_stock', 'No available stock to reserve in this warehouse.');
  end if;
  return v_got;
end $$;

create or replace function public.release_stock_reservation(p_reservation_id uuid, p_qty numeric, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('inventory.reserve');
  if coalesce(trim(p_reason), '') = '' then
    perform public.raise_business_error('validation', 'Please give a reason for releasing the reservation.');
  end if;
  perform public.stock_release(p_reservation_id, p_qty, trim(p_reason), false);
end $$;

-- =============================================================================
-- PRODUCT MASTER
-- =============================================================================
alter table public.products
  add column technical_specs     jsonb not null default '[]'::jsonb
    check (jsonb_typeof(technical_specs) = 'array' and jsonb_array_length(technical_specs) <= 60),
  add column default_supplier_id uuid references public.suppliers(id),
  add column currency_code       char(3) not null default 'AED' references public.currencies(code),
  add column purchase_price      numeric(18,4) not null default 0 check (purchase_price >= 0),
  add column image_path          text,
  add column barcode             text,
  add column model_no            text,
  add column low_stock_alerted_at timestamptz;
comment on column public.products.currency_code is 'Preferred currency for purchase and selling price.';
comment on column public.products.default_sell_price is 'Selling price in the product''s preferred currency.';
comment on column public.products.min_stock_level is 'Minimum stock level across all warehouses; below it a low-stock alert is raised.';
comment on column public.products.technical_specs is 'Ordered list of {"name": "...", "value": "..."} pairs.';
create unique index products_barcode_unique on public.products(barcode) where barcode is not null;
create index products_category_idx on public.products(category_id);
create index products_supplier_idx on public.products(default_supplier_id);
create index products_active_idx on public.products(is_active, item_type);

-- ---------------------------------------------------------------------------
-- Categories: unlimited depth, no cycles, unique name per parent.
-- ---------------------------------------------------------------------------
alter table public.product_categories
  drop constraint if exists product_categories_parent_id_name_key,
  add column code        text,
  add column description text,
  add column sort_order  integer not null default 0,
  add column created_at  timestamptz not null default now(),
  add column created_by  uuid references public.profiles(id),
  add column updated_at  timestamptz not null default now(),
  add column updated_by  uuid references public.profiles(id),
  add constraint product_categories_name_check check (length(trim(name)) > 0),
  add constraint product_categories_not_self check (parent_id is distinct from id);
create unique index product_categories_name_per_parent
  on public.product_categories (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(trim(name)));
create unique index product_categories_code_unique on public.product_categories(upper(code)) where code is not null;
create index product_categories_parent_idx on public.product_categories(parent_id);
select public.attach_standard_triggers('public.product_categories');
select public.attach_standard_triggers('public.brands', false);

create or replace function public.product_categories_guard()
returns trigger language plpgsql as $$
declare v_loop boolean;
begin
  new.name := trim(new.name);
  new.code := nullif(upper(trim(new.code)), '');
  if new.parent_id is not null then
    with recursive up as (
      select id, parent_id from public.product_categories where id = new.parent_id
      union all
      select c.id, c.parent_id from public.product_categories c join up on c.id = up.parent_id
    )
    select exists (select 1 from up where id = new.id) into v_loop;
    if v_loop then
      raise exception using errcode = 'P0001', hint = 'validation',
        message = 'A category cannot be moved under itself or one of its own subcategories.';
    end if;
  end if;
  return new;
end $$;
create trigger product_categories_guard before insert or update on public.product_categories
  for each row execute function public.product_categories_guard();

-- Delete only empty leaf categories (no subcategories, no products).
create or replace function public.delete_product_category(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('category.manage');
  if exists (select 1 from public.product_categories where parent_id = p_id) then
    perform public.raise_business_error('in_use', 'Move or delete its subcategories first.');
  end if;
  if exists (select 1 from public.products where category_id = p_id) then
    perform public.raise_business_error('in_use', 'Products use this category. Move them or deactivate the category instead.');
  end if;
  delete from public.product_categories where id = p_id;
end $$;

-- Tree with full path, depth and product counts.
create or replace view public.v_product_categories with (security_invoker = true) as
with recursive tree as (
  select c.id, c.parent_id, c.name, c.code, c.sort_order, c.is_active, 0 as depth,
         c.name::text as full_path, array[c.id] as path_ids,
         array[lpad(c.sort_order::text, 6, '0') || lower(c.name)] as sort_path
  from public.product_categories c where c.parent_id is null
  union all
  select c.id, c.parent_id, c.name, c.code, c.sort_order, c.is_active, t.depth + 1,
         t.full_path || ' › ' || c.name, t.path_ids || c.id,
         t.sort_path || (lpad(c.sort_order::text, 6, '0') || lower(c.name))
  from public.product_categories c join tree t on c.parent_id = t.id
)
select t.*,
       (select count(*) from public.products p where p.category_id = t.id) as product_count,
       (select count(*) from public.products p
          join tree t2 on t2.id = p.category_id
         where t.id = any (t2.path_ids)) as product_count_incl_sub
from tree t;

-- ---------------------------------------------------------------------------
-- Product attachments (datasheets, certificates, manuals, drawings, images)
-- Files live in the private Storage bucket "product-media".
-- ---------------------------------------------------------------------------
create table public.product_attachments (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  kind         text not null default 'other'
               check (kind in ('datasheet', 'certificate', 'manual', 'drawing', 'image', 'other')),
  file_name    text not null check (length(trim(file_name)) > 0),
  storage_path text not null unique,
  mime_type    text,
  size_bytes   bigint check (size_bytes between 1 and 26214400),   -- 25 MB
  description  text,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) default auth.uid(),
  constraint product_attachments_path check (storage_path like 'products/' || product_id::text || '/%')
);
create index on public.product_attachments(product_id);
select public.attach_standard_triggers('public.product_attachments', false);

-- ---------------------------------------------------------------------------
-- save_product — create or update a product with specs, prices and supplier.
-- ---------------------------------------------------------------------------
create or replace function public.save_product(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id        uuid := nullif(p->>'id', '')::uuid;
  v_old       public.products;
  v_can_cost  boolean := public.has_permission('product.view_cost');
  v_sku       text := nullif(upper(trim(p->>'sku')), '');
  v_type      public.item_type := coalesce(nullif(p->>'item_type', ''), 'stock')::public.item_type;
  v_specs     jsonb := '[]'::jsonb;
  v_spec      jsonb;
  v_supplier  uuid := nullif(p->>'default_supplier_id', '')::uuid;
  v_currency  char(3) := coalesce(nullif(p->>'currency_code', ''), public.base_currency());
  v_purchase  numeric;
  v_sell      numeric := coalesce(nullif(p->>'default_sell_price', '')::numeric, 0);
begin
  perform public.require_permission('product.edit');
  if v_id is not null then
    select * into v_old from public.products where id = v_id for update;
    if not found then perform public.raise_business_error('not_found', 'Product not found.'); end if;
  end if;

  if coalesce(length(trim(p->>'name')), 0) < 2 then
    perform public.raise_business_error('validation', 'Enter a product name.');
  end if;
  if v_sku is not null and v_sku !~ '^[A-Z0-9][A-Z0-9._/-]{1,39}$' then
    perform public.raise_business_error('validation',
      'SKU may contain letters, numbers, dot, dash, slash and underscore (2–40 characters).');
  end if;
  if v_sku is not null and exists (select 1 from public.products where sku = v_sku and id is distinct from v_id) then
    perform public.raise_business_error('duplicate', format('SKU %s is already used by another product.', v_sku));
  end if;
  if nullif(p->>'barcode', '') is not null
     and exists (select 1 from public.products where barcode = trim(p->>'barcode') and id is distinct from v_id) then
    perform public.raise_business_error('duplicate', 'This barcode is already used by another product.');
  end if;
  if nullif(p->>'category_id', '') is not null and not exists
     (select 1 from public.product_categories where id = (p->>'category_id')::uuid and is_active) then
    perform public.raise_business_error('validation', 'Select an active category.');
  end if;
  if not exists (select 1 from public.units_of_measure where id = nullif(p->>'uom_id', '')::uuid and is_active) then
    perform public.raise_business_error('validation', 'Select a unit of measurement.');
  end if;
  if nullif(p->>'tax_code_id', '') is not null and not exists
     (select 1 from public.tax_codes where id = (p->>'tax_code_id')::uuid and is_active) then
    perform public.raise_business_error('validation', 'Select an active VAT category.');
  end if;
  if v_supplier is not null and not exists
     (select 1 from public.suppliers where id = v_supplier and status in ('active', 'on_hold')) then
    perform public.raise_business_error('validation', 'The default supplier is inactive or blocked.');
  end if;
  if not exists (select 1 from public.currencies where code = v_currency and is_active) then
    perform public.raise_business_error('validation', 'Select an active currency.');
  end if;
  if v_sell < 0 or coalesce(nullif(p->>'purchase_price', '')::numeric, 0) < 0
     or coalesce(nullif(p->>'min_stock_level', '')::numeric, 0) < 0 then
    perform public.raise_business_error('validation', 'Prices and stock levels cannot be negative.');
  end if;

  -- Purchase price is cost data: only users who may see costs can set it.
  v_purchase := case when v_can_cost then coalesce(nullif(p->>'purchase_price', '')::numeric, 0)
                     else coalesce(v_old.purchase_price, 0) end;

  if jsonb_typeof(coalesce(p->'technical_specs', '[]'::jsonb)) <> 'array' then
    perform public.raise_business_error('validation', 'Technical specifications must be a list of name/value pairs.');
  end if;
  for v_spec in select * from jsonb_array_elements(coalesce(p->'technical_specs', '[]'::jsonb)) loop
    if coalesce(trim(v_spec->>'name'), '') <> '' then
      v_specs := v_specs || jsonb_build_object('name', left(trim(v_spec->>'name'), 80),
                                               'value', left(coalesce(trim(v_spec->>'value'), ''), 500));
    end if;
  end loop;

  -- A stock item that has ever moved cannot become a non-stock item.
  if v_id is not null and v_old.item_type = 'stock' and v_type <> 'stock'
     and exists (select 1 from public.stock_movements where product_id = v_id) then
    perform public.raise_business_error('validation',
      'This product has stock history and must stay a stock item. Deactivate it instead.');
  end if;

  if v_id is null then
    insert into public.products(sku, name, description, category_id, brand_id, uom_id, item_type, default_sell_price,
      tax_code_id, min_stock_level, reorder_qty, hs_code, technical_specs, default_supplier_id, currency_code,
      purchase_price, barcode, model_no, is_active)
    values (v_sku, trim(p->>'name'), nullif(trim(p->>'description'), ''), nullif(p->>'category_id', '')::uuid,
      nullif(p->>'brand_id', '')::uuid, (p->>'uom_id')::uuid, v_type, round(v_sell, 2),
      coalesce(nullif(p->>'tax_code_id', '')::uuid, (select id from public.tax_codes where is_default)),
      coalesce(nullif(p->>'min_stock_level', '')::numeric, 0), coalesce(nullif(p->>'reorder_qty', '')::numeric, 0),
      nullif(trim(p->>'hs_code'), ''), v_specs, v_supplier, v_currency, v_purchase,
      nullif(trim(p->>'barcode'), ''), nullif(trim(p->>'model_no'), ''), coalesce((p->>'is_active')::boolean, true))
    returning id into v_id;
  else
    update public.products set sku = coalesce(v_sku, sku), name = trim(p->>'name'),
      description = nullif(trim(p->>'description'), ''), category_id = nullif(p->>'category_id', '')::uuid,
      brand_id = nullif(p->>'brand_id', '')::uuid, uom_id = (p->>'uom_id')::uuid, item_type = v_type,
      default_sell_price = round(v_sell, 2),
      tax_code_id = coalesce(nullif(p->>'tax_code_id', '')::uuid, tax_code_id),
      min_stock_level = coalesce(nullif(p->>'min_stock_level', '')::numeric, 0),
      reorder_qty = coalesce(nullif(p->>'reorder_qty', '')::numeric, 0),
      hs_code = nullif(trim(p->>'hs_code'), ''), technical_specs = v_specs,
      default_supplier_id = v_supplier, currency_code = v_currency, purchase_price = v_purchase,
      barcode = nullif(trim(p->>'barcode'), ''), model_no = nullif(trim(p->>'model_no'), '')
    where id = v_id;
    -- UoM cannot change once the product has moved (quantities would change meaning).
    if v_old.uom_id <> (p->>'uom_id')::uuid and exists (select 1 from public.stock_movements where product_id = v_id) then
      perform public.raise_business_error('validation', 'The unit of measurement cannot change after stock has moved.');
    end if;
  end if;

  -- Keep the supplier price list in step with the default supplier.
  if v_supplier is not null and v_can_cost then
    update public.supplier_products set is_preferred = false where product_id = v_id and supplier_id <> v_supplier and is_preferred;
    insert into public.supplier_products(supplier_id, product_id, last_cost, currency_code, is_preferred)
    values (v_supplier, v_id, v_purchase, v_currency, true)
    on conflict (supplier_id, product_id) do update
      set last_cost = excluded.last_cost, currency_code = excluded.currency_code, is_preferred = true, updated_at = now();
  end if;
  return v_id;
end $$;

create or replace function public.set_product_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('product.edit');
  if not p_active and exists (select 1 from public.stock_levels where product_id = p_id and qty_reserved > 0) then
    perform public.raise_business_error('in_use', 'Stock of this product is reserved for open orders. Release or deliver it first.');
  end if;
  if not p_active and exists (select 1 from public.quotations q join public.quotation_lines l on l.quotation_id = q.id
                               where l.product_id = p_id and q.status in ('draft', 'pending_approval')) then
    perform public.raise_business_error('in_use', 'This product is on draft quotations. Remove it from them first.');
  end if;
  update public.products set is_active = p_active where id = p_id;
  if not found then perform public.raise_business_error('not_found', 'Product not found.'); end if;
end $$;

create or replace function public.set_product_image(p_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('product.edit');
  if p_path is not null and p_path not like 'products/' || p_id::text || '/%' then
    perform public.raise_business_error('validation', 'Invalid image location.');
  end if;
  update public.products set image_path = p_path where id = p_id;
end $$;

-- =============================================================================
-- WAREHOUSES
-- =============================================================================
alter table public.warehouses
  add column manager_id uuid references public.profiles(id),
  add column phone      text,
  add column updated_at timestamptz not null default now(),
  add column updated_by uuid references public.profiles(id),
  add column created_by uuid references public.profiles(id),
  add constraint warehouses_code_format check (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$');
select public.attach_standard_triggers('public.warehouses');

create or replace function public.warehouses_guard()
returns trigger language plpgsql as $$
begin
  if old.is_active and not new.is_active and exists
     (select 1 from public.stock_levels where warehouse_id = old.id and (qty_on_hand <> 0 or qty_reserved <> 0)) then
    raise exception using errcode = 'P0001', hint = 'in_use',
      message = 'This warehouse still holds stock. Transfer it out before deactivating.';
  end if;
  if old.is_active and not new.is_active
     and exists (select 1 from public.company_settings where default_warehouse_id = old.id) then
    raise exception using errcode = 'P0001', hint = 'in_use',
      message = 'This is the default warehouse. Choose another default first.';
  end if;
  return new;
end $$;
create trigger warehouses_guard before update on public.warehouses
  for each row execute function public.warehouses_guard();

-- =============================================================================
-- INVENTORY DOCUMENTS
-- Each document is a draft until posted; posting writes stock movements in one
-- transaction. Posted documents are never edited — they are reversed by a new
-- document.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Goods received notes
-- ---------------------------------------------------------------------------
create table public.goods_receipts (
  id                uuid primary key default gen_random_uuid(),
  doc_no            text not null unique,
  warehouse_id      uuid not null references public.warehouses(id),
  supplier_id       uuid references public.suppliers(id),
  purchase_order_id uuid,                 -- FK added by the procurement migration
  receipt_date      date not null default current_date,
  supplier_reference text,                -- supplier delivery note / invoice no.
  currency_code     char(3) not null references public.currencies(code),
  exchange_rate     numeric(18,6) not null default 1 check (exchange_rate > 0),
  status            text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  notes             text,
  posted_at         timestamptz,
  posted_by         uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id),
  constraint grn_posted check (status <> 'posted' or posted_at is not null)
);
create index goods_receipts_wh_date_idx on public.goods_receipts(warehouse_id, receipt_date desc);
create index goods_receipts_supplier_idx on public.goods_receipts(supplier_id);
select public.attach_standard_triggers('public.goods_receipts');

create table public.goods_receipt_lines (
  id                  uuid primary key default gen_random_uuid(),
  goods_receipt_id    uuid not null references public.goods_receipts(id) on delete cascade,
  line_no             integer not null check (line_no > 0),
  product_id          uuid not null references public.products(id),
  qty                 numeric(18,3) not null check (qty > 0),
  unit_cost           numeric(18,4) not null check (unit_cost >= 0),       -- document currency
  unit_cost_base      numeric(18,4),                                        -- set at posting
  purchase_order_line_id uuid,                                              -- FK added by procurement
  sales_order_line_id uuid references public.sales_order_lines(id),         -- back-to-back receipt
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id),
  unique (goods_receipt_id, line_no)
);
create index on public.goods_receipt_lines(product_id);
create index on public.goods_receipt_lines(sales_order_line_id);
select public.attach_standard_triggers('public.goods_receipt_lines');

-- ---------------------------------------------------------------------------
-- Goods issues (non-sales outflows: internal use, samples, returns to supplier)
-- Customer deliveries are posted by the logistics module.
-- ---------------------------------------------------------------------------
create table public.goods_issues (
  id              uuid primary key default gen_random_uuid(),
  doc_no          text not null unique,
  warehouse_id    uuid not null references public.warehouses(id),
  issue_type      text not null check (issue_type in ('internal_use', 'sample', 'return_to_supplier', 'other')),
  supplier_id     uuid references public.suppliers(id),
  issued_to       text,
  reference       text,
  issue_date      date not null default current_date,
  allow_negative  boolean not null default false,
  negative_reason text,
  status          text not null default 'draft' check (status in ('draft', 'posted', 'cancelled')),
  notes           text,
  posted_at       timestamptz,
  posted_by       uuid references public.profiles(id),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id),
  constraint gi_return_supplier check (issue_type <> 'return_to_supplier' or supplier_id is not null),
  constraint gi_negative_reason check (not allow_negative or coalesce(trim(negative_reason), '') <> '')
);
create index goods_issues_wh_date_idx on public.goods_issues(warehouse_id, issue_date desc);
select public.attach_standard_triggers('public.goods_issues');

create table public.goods_issue_lines (
  id             uuid primary key default gen_random_uuid(),
  goods_issue_id uuid not null references public.goods_issues(id) on delete cascade,
  line_no        integer not null check (line_no > 0),
  product_id     uuid not null references public.products(id),
  qty            numeric(18,3) not null check (qty > 0),
  notes          text,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles(id),
  unique (goods_issue_id, line_no)
);
create index on public.goods_issue_lines(product_id);
select public.attach_standard_triggers('public.goods_issue_lines');

-- ---------------------------------------------------------------------------
-- Stock transfers (two steps: dispatch → in transit → receive)
-- ---------------------------------------------------------------------------
create table public.stock_transfers (
  id                uuid primary key default gen_random_uuid(),
  doc_no            text not null unique,
  from_warehouse_id uuid not null references public.warehouses(id),
  to_warehouse_id   uuid not null references public.warehouses(id),
  transfer_date     date not null default current_date,
  status            text not null default 'draft' check (status in ('draft', 'in_transit', 'received', 'cancelled')),
  notes             text,
  dispatched_at     timestamptz,
  dispatched_by     uuid references public.profiles(id),
  received_at       timestamptz,
  received_by       uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id),
  constraint transfer_distinct_wh check (from_warehouse_id <> to_warehouse_id)
);
create index stock_transfers_status_idx on public.stock_transfers(status, to_warehouse_id);
select public.attach_standard_triggers('public.stock_transfers');

create table public.stock_transfer_lines (
  id                uuid primary key default gen_random_uuid(),
  stock_transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
  line_no           integer not null check (line_no > 0),
  product_id        uuid not null references public.products(id),
  qty               numeric(18,3) not null check (qty > 0),
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id),
  unique (stock_transfer_id, line_no)
);
create index on public.stock_transfer_lines(product_id);
select public.attach_standard_triggers('public.stock_transfer_lines');

-- ---------------------------------------------------------------------------
-- Stock adjustments (the ONLY way to correct a balance) — approval required.
-- ---------------------------------------------------------------------------
create table public.stock_adjustments (
  id              uuid primary key default gen_random_uuid(),
  doc_no          text not null unique,
  warehouse_id    uuid not null references public.warehouses(id),
  reason          text not null check (reason in ('physical_count', 'damaged', 'expired', 'lost_or_stolen', 'found',
                                                  'data_correction', 'opening_balance', 'other')),
  adjustment_date date not null default current_date,
  allow_negative  boolean not null default false,
  status          text not null default 'draft'
                  check (status in ('draft', 'submitted', 'posted', 'rejected', 'cancelled')),
  notes           text,
  submitted_at    timestamptz,
  submitted_by    uuid references public.profiles(id),
  approved_at     timestamptz,
  approved_by     uuid references public.profiles(id),
  rejection_reason text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id),
  constraint adj_notes_required check (reason <> 'other' or coalesce(trim(notes), '') <> '')
);
create index stock_adjustments_status_idx on public.stock_adjustments(status, warehouse_id);
select public.attach_standard_triggers('public.stock_adjustments');

create table public.stock_adjustment_lines (
  id                  uuid primary key default gen_random_uuid(),
  stock_adjustment_id uuid not null references public.stock_adjustments(id) on delete cascade,
  line_no             integer not null check (line_no > 0),
  product_id          uuid not null references public.products(id),
  mode                text not null default 'change' check (mode in ('change', 'count')),
  qty_change          numeric(18,3),          -- signed, for mode = change
  counted_qty         numeric(18,3),          -- for mode = count
  unit_cost_base      numeric(18,4) check (unit_cost_base >= 0),   -- cost for increases (base currency)
  system_qty          numeric(18,3),          -- on hand when posted
  posted_change       numeric(18,3),          -- change actually posted
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id),
  unique (stock_adjustment_id, line_no),
  constraint adj_line_mode check (
    (mode = 'change' and qty_change is not null and qty_change <> 0 and counted_qty is null)
    or (mode = 'count' and counted_qty is not null and counted_qty >= 0 and qty_change is null))
);
create unique index stock_adjustment_lines_one_product on public.stock_adjustment_lines(stock_adjustment_id, product_id);
select public.attach_standard_triggers('public.stock_adjustment_lines');

-- Lines of posted/cancelled documents can never change.
create or replace function public.inventory_doc_lines_guard()
returns trigger language plpgsql as $$
declare
  v_status text;
  v_row    jsonb := to_jsonb(coalesce(new, old));
  v_parent_table text := tg_argv[0];
  v_parent_col   text := tg_argv[1];
begin
  execute format('select status from public.%I where id = $1', v_parent_table)
    into v_status using (v_row->>v_parent_col)::uuid;
  if v_status <> 'draft' and coalesce(current_setting('smp.stock_posting', true), '') <> 'on' then
    raise exception using errcode = 'P0001', hint = 'locked',
      message = 'This document has been submitted or posted and can no longer be changed.';
  end if;
  return coalesce(new, old);
end $$;
create trigger goods_receipt_lines_guard before insert or update or delete on public.goods_receipt_lines
  for each row execute function public.inventory_doc_lines_guard('goods_receipts', 'goods_receipt_id');
create trigger goods_issue_lines_guard before insert or update or delete on public.goods_issue_lines
  for each row execute function public.inventory_doc_lines_guard('goods_issues', 'goods_issue_id');
create trigger stock_transfer_lines_guard before insert or update or delete on public.stock_transfer_lines
  for each row execute function public.inventory_doc_lines_guard('stock_transfers', 'stock_transfer_id');
create trigger stock_adjustment_lines_guard before insert or update or delete on public.stock_adjustment_lines
  for each row execute function public.inventory_doc_lines_guard('stock_adjustments', 'stock_adjustment_id');

-- Common line validation for stock documents.
create or replace function public.inv_validate_stock_product(p_product_id uuid, p_line_no integer)
returns public.products language plpgsql stable security definer set search_path = public as $$
declare v public.products;
begin
  select * into v from public.products where id = p_product_id;
  if not found then
    perform public.raise_business_error('validation', format('Line %s: select a product.', p_line_no));
  end if;
  if v.item_type <> 'stock' then
    perform public.raise_business_error('validation', format('Line %s: %s is not a stock item.', p_line_no, v.name));
  end if;
  return v;
end $$;

create or replace function public.inv_require_active_warehouse(p_id uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.warehouses where id = p_id and is_active) then
    perform public.raise_business_error('validation', 'Select an active warehouse.');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- GRN: save draft / post
-- ---------------------------------------------------------------------------
create or replace function public.save_goods_receipt(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := nullif(p->>'id', '')::uuid;
  v_old  public.goods_receipts;
  v_ccy  char(3) := coalesce(nullif(p->>'currency_code', ''), public.base_currency());
  v_rate numeric;
  v_date date := coalesce(nullif(p->>'receipt_date', '')::date, current_date);
  v_line jsonb;
  v_n    integer := 0;
  v_sol  public.sales_order_lines;
begin
  perform public.require_permission('inventory.receive');
  if v_id is not null then
    select * into v_old from public.goods_receipts where id = v_id for update;
    if not found then perform public.raise_business_error('not_found', 'Goods receipt not found.'); end if;
    if v_old.status <> 'draft' then perform public.raise_business_error('locked', 'Only draft receipts can be edited.'); end if;
  end if;
  perform public.inv_require_active_warehouse(nullif(p->>'warehouse_id', '')::uuid);
  if v_date > current_date then
    perform public.raise_business_error('validation', 'The receipt date cannot be in the future.');
  end if;
  v_rate := case when v_ccy = public.base_currency() then 1
                 else coalesce(nullif(p->>'exchange_rate', '')::numeric, public.rate_to_base(v_ccy, v_date)) end;
  if v_rate is null or v_rate <= 0 then
    perform public.raise_business_error('validation', format('Enter the exchange rate for %s.', v_ccy));
  end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then
    perform public.raise_business_error('validation', 'Add at least one item.');
  end if;

  if v_id is null then
    insert into public.goods_receipts(doc_no, warehouse_id, supplier_id, receipt_date, supplier_reference,
      currency_code, exchange_rate, notes)
    values (public.next_document_number('goods_receipt', v_date), (p->>'warehouse_id')::uuid,
      nullif(p->>'supplier_id', '')::uuid, v_date, nullif(trim(p->>'supplier_reference'), ''), v_ccy, v_rate,
      nullif(trim(p->>'notes'), ''))
    returning id into v_id;
  else
    update public.goods_receipts set warehouse_id = (p->>'warehouse_id')::uuid,
      supplier_id = nullif(p->>'supplier_id', '')::uuid, receipt_date = v_date,
      supplier_reference = nullif(trim(p->>'supplier_reference'), ''), currency_code = v_ccy, exchange_rate = v_rate,
      notes = nullif(trim(p->>'notes'), '')
    where id = v_id;
    delete from public.goods_receipt_lines where goods_receipt_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_n := v_n + 1;
    perform public.inv_validate_stock_product(nullif(v_line->>'product_id', '')::uuid, v_n);
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 then
      perform public.raise_business_error('validation', format('Line %s: quantity must be greater than zero.', v_n));
    end if;
    if coalesce(nullif(v_line->>'unit_cost', '')::numeric, -1) < 0 then
      perform public.raise_business_error('validation', format('Line %s: enter the unit cost.', v_n));
    end if;
    if nullif(v_line->>'sales_order_line_id', '') is not null then
      select * into v_sol from public.sales_order_lines where id = (v_line->>'sales_order_line_id')::uuid;
      if not found or v_sol.product_id <> (v_line->>'product_id')::uuid or v_sol.fulfilment_mode <> 'procure' then
        perform public.raise_business_error('validation',
          format('Line %s: the linked order line must be a direct-procurement line for the same product.', v_n));
      end if;
    end if;
    insert into public.goods_receipt_lines(goods_receipt_id, line_no, product_id, qty, unit_cost, sales_order_line_id, notes)
    values (v_id, v_n, (v_line->>'product_id')::uuid, (v_line->>'qty')::numeric, (v_line->>'unit_cost')::numeric,
      nullif(v_line->>'sales_order_line_id', '')::uuid, nullif(trim(v_line->>'notes'), ''));
  end loop;
  return v_id;
end $$;

create or replace function public.post_goods_receipt(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  g    public.goods_receipts;
  l    public.goods_receipt_lines;
  v_sol public.sales_order_lines;
  v_cost numeric;
  v_for_order numeric;
  v_prev_lock text;
begin
  perform public.require_permission('inventory.receive');
  select * into g from public.goods_receipts where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Goods receipt not found.'); end if;
  if g.status <> 'draft' then perform public.raise_business_error('invalid_state', 'This receipt is already posted or cancelled.'); end if;
  perform public.inv_require_active_warehouse(g.warehouse_id);

  for l in select * from public.goods_receipt_lines where goods_receipt_id = p_id order by product_id, line_no loop
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
        v_prev_lock := coalesce(current_setting('smp.allow_locked_edit', true), '');
        perform set_config('smp.allow_locked_edit', 'on', true);
        update public.sales_order_lines set qty_received = qty_received + v_for_order, warehouse_id = g.warehouse_id
         where id = v_sol.id;
        perform set_config('smp.allow_locked_edit', v_prev_lock, true);
        if v_sol.is_cancelled = false then
          perform public.stock_reserve(v_sol.id, g.warehouse_id, v_for_order, 'Reserved on receipt ' || g.doc_no);
        end if;
      end if;
    end if;
  end loop;

  update public.goods_receipts set status = 'posted', posted_at = now(), posted_by = auth.uid() where id = p_id;
  perform public.notify_permission_holders('sales_order.view_all', 'Goods received', g.doc_no || ' posted', '/inventory/receipts/' || p_id);
end $$;

-- ---------------------------------------------------------------------------
-- Goods issue: save draft / post
-- ---------------------------------------------------------------------------
create or replace function public.save_goods_issue(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := nullif(p->>'id', '')::uuid;
  v_old  public.goods_issues;
  v_date date := coalesce(nullif(p->>'issue_date', '')::date, current_date);
  v_line jsonb;
  v_n    integer := 0;
begin
  perform public.require_permission('inventory.issue');
  if v_id is not null then
    select * into v_old from public.goods_issues where id = v_id for update;
    if not found then perform public.raise_business_error('not_found', 'Goods issue not found.'); end if;
    if v_old.status <> 'draft' then perform public.raise_business_error('locked', 'Only draft issues can be edited.'); end if;
  end if;
  perform public.inv_require_active_warehouse(nullif(p->>'warehouse_id', '')::uuid);
  if v_date > current_date then perform public.raise_business_error('validation', 'The issue date cannot be in the future.'); end if;
  if coalesce((p->>'allow_negative')::boolean, false) and not public.has_permission('inventory.allow_negative') then
    perform public.raise_business_error('forbidden', 'Only management can authorise negative stock.');
  end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then
    perform public.raise_business_error('validation', 'Add at least one item.');
  end if;

  if v_id is null then
    insert into public.goods_issues(doc_no, warehouse_id, issue_type, supplier_id, issued_to, reference, issue_date,
      allow_negative, negative_reason, notes)
    values (public.next_document_number('goods_issue', v_date), (p->>'warehouse_id')::uuid, p->>'issue_type',
      nullif(p->>'supplier_id', '')::uuid, nullif(trim(p->>'issued_to'), ''), nullif(trim(p->>'reference'), ''), v_date,
      coalesce((p->>'allow_negative')::boolean, false), nullif(trim(p->>'negative_reason'), ''), nullif(trim(p->>'notes'), ''))
    returning id into v_id;
  else
    update public.goods_issues set warehouse_id = (p->>'warehouse_id')::uuid, issue_type = p->>'issue_type',
      supplier_id = nullif(p->>'supplier_id', '')::uuid, issued_to = nullif(trim(p->>'issued_to'), ''),
      reference = nullif(trim(p->>'reference'), ''), issue_date = v_date,
      allow_negative = coalesce((p->>'allow_negative')::boolean, false),
      negative_reason = nullif(trim(p->>'negative_reason'), ''), notes = nullif(trim(p->>'notes'), '')
    where id = v_id;
    delete from public.goods_issue_lines where goods_issue_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_n := v_n + 1;
    perform public.inv_validate_stock_product(nullif(v_line->>'product_id', '')::uuid, v_n);
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 then
      perform public.raise_business_error('validation', format('Line %s: quantity must be greater than zero.', v_n));
    end if;
    insert into public.goods_issue_lines(goods_issue_id, line_no, product_id, qty, notes)
    values (v_id, v_n, (v_line->>'product_id')::uuid, (v_line->>'qty')::numeric, nullif(trim(v_line->>'notes'), ''));
  end loop;
  return v_id;
end $$;

create or replace function public.post_goods_issue(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  g public.goods_issues;
  l public.goods_issue_lines;
begin
  perform public.require_permission('inventory.issue');
  select * into g from public.goods_issues where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Goods issue not found.'); end if;
  if g.status <> 'draft' then perform public.raise_business_error('invalid_state', 'This issue is already posted or cancelled.'); end if;
  -- Negative stock needs the poster to hold the authority, not just the preparer.
  if g.allow_negative and not public.has_permission('inventory.allow_negative') then
    perform public.raise_business_error('forbidden', 'This issue allows negative stock and must be posted by management.');
  end if;
  for l in select * from public.goods_issue_lines where goods_issue_id = p_id order by product_id, line_no loop
    perform public.stock_post_movement(l.product_id, g.warehouse_id,
      case when g.issue_type = 'return_to_supplier' then 'return_out' else 'issue' end::public.movement_type,
      l.qty, null, 'goods_issue', g.id, l.id, g.doc_no,
      coalesce(g.negative_reason, g.notes), 0, g.allow_negative, null);
  end loop;
  update public.goods_issues set status = 'posted', posted_at = now(), posted_by = auth.uid() where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Stock transfer: save draft / dispatch / receive
-- ---------------------------------------------------------------------------
create or replace function public.save_stock_transfer(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := nullif(p->>'id', '')::uuid;
  v_old  public.stock_transfers;
  v_date date := coalesce(nullif(p->>'transfer_date', '')::date, current_date);
  v_line jsonb;
  v_n    integer := 0;
begin
  perform public.require_permission('inventory.transfer');
  if v_id is not null then
    select * into v_old from public.stock_transfers where id = v_id for update;
    if not found then perform public.raise_business_error('not_found', 'Transfer not found.'); end if;
    if v_old.status <> 'draft' then perform public.raise_business_error('locked', 'Only draft transfers can be edited.'); end if;
  end if;
  perform public.inv_require_active_warehouse(nullif(p->>'from_warehouse_id', '')::uuid);
  perform public.inv_require_active_warehouse(nullif(p->>'to_warehouse_id', '')::uuid);
  if p->>'from_warehouse_id' = p->>'to_warehouse_id' then
    perform public.raise_business_error('validation', 'Choose two different warehouses.');
  end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then
    perform public.raise_business_error('validation', 'Add at least one item.');
  end if;
  if v_id is null then
    insert into public.stock_transfers(doc_no, from_warehouse_id, to_warehouse_id, transfer_date, notes)
    values (public.next_document_number('stock_transfer', v_date), (p->>'from_warehouse_id')::uuid,
      (p->>'to_warehouse_id')::uuid, v_date, nullif(trim(p->>'notes'), ''))
    returning id into v_id;
  else
    update public.stock_transfers set from_warehouse_id = (p->>'from_warehouse_id')::uuid,
      to_warehouse_id = (p->>'to_warehouse_id')::uuid, transfer_date = v_date, notes = nullif(trim(p->>'notes'), '')
    where id = v_id;
    delete from public.stock_transfer_lines where stock_transfer_id = v_id;
  end if;
  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_n := v_n + 1;
    perform public.inv_validate_stock_product(nullif(v_line->>'product_id', '')::uuid, v_n);
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 then
      perform public.raise_business_error('validation', format('Line %s: quantity must be greater than zero.', v_n));
    end if;
    insert into public.stock_transfer_lines(stock_transfer_id, line_no, product_id, qty, notes)
    values (v_id, v_n, (v_line->>'product_id')::uuid, (v_line->>'qty')::numeric, nullif(trim(v_line->>'notes'), ''));
  end loop;
  return v_id;
end $$;

-- Dispatch: stock leaves the source warehouse (only AVAILABLE stock — never
-- stock reserved for customers, never negative) and is in transit.
create or replace function public.dispatch_stock_transfer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.stock_transfers;
  l public.stock_transfer_lines;
begin
  perform public.require_permission('inventory.transfer');
  select * into t from public.stock_transfers where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Transfer not found.'); end if;
  if t.status <> 'draft' then perform public.raise_business_error('invalid_state', 'Only draft transfers can be dispatched.'); end if;
  perform public.inv_require_active_warehouse(t.from_warehouse_id);
  perform public.inv_require_active_warehouse(t.to_warehouse_id);
  for l in select * from public.stock_transfer_lines where stock_transfer_id = p_id order by product_id, line_no loop
    perform public.stock_post_movement(l.product_id, t.from_warehouse_id, 'transfer_out', l.qty, null,
      'stock_transfer', t.id, l.id, t.doc_no, null, 0, false, null);
  end loop;
  update public.stock_transfers set status = 'in_transit', dispatched_at = now(), dispatched_by = auth.uid() where id = p_id;
  perform public.notify_permission_holders('inventory.transfer', 'Stock transfer in transit',
    t.doc_no || ' has been dispatched', '/inventory/transfers/' || p_id);
end $$;

-- Receive: stock enters the destination at the cost it left the source.
create or replace function public.receive_stock_transfer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.stock_transfers;
  l public.stock_transfer_lines;
  v_cost numeric;
begin
  perform public.require_permission('inventory.transfer');
  select * into t from public.stock_transfers where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Transfer not found.'); end if;
  if t.status <> 'in_transit' then perform public.raise_business_error('invalid_state', 'Only transfers in transit can be received.'); end if;
  for l in select * from public.stock_transfer_lines where stock_transfer_id = p_id order by product_id, line_no loop
    select unit_cost into v_cost from public.stock_movements
     where source_type = 'stock_transfer' and source_line_id = l.id and movement_type = 'transfer_out';
    perform public.stock_post_movement(l.product_id, t.to_warehouse_id, 'transfer_in', l.qty, coalesce(v_cost, 0),
      'stock_transfer', t.id, l.id, t.doc_no, null, 0, false, null);
  end loop;
  update public.stock_transfers set status = 'received', received_at = now(), received_by = auth.uid() where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Stock adjustment: save draft / submit / approve (posts) / reject
-- ---------------------------------------------------------------------------
create or replace function public.save_stock_adjustment(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := nullif(p->>'id', '')::uuid;
  v_old  public.stock_adjustments;
  v_date date := coalesce(nullif(p->>'adjustment_date', '')::date, current_date);
  v_line jsonb;
  v_n    integer := 0;
  v_mode text;
begin
  perform public.require_permission('inventory.adjust');
  if v_id is not null then
    select * into v_old from public.stock_adjustments where id = v_id for update;
    if not found then perform public.raise_business_error('not_found', 'Adjustment not found.'); end if;
    if v_old.status not in ('draft', 'rejected') then
      perform public.raise_business_error('locked', 'Only draft or rejected adjustments can be edited.');
    end if;
  end if;
  perform public.inv_require_active_warehouse(nullif(p->>'warehouse_id', '')::uuid);
  if v_date > current_date then perform public.raise_business_error('validation', 'The date cannot be in the future.'); end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then
    perform public.raise_business_error('validation', 'Add at least one item.');
  end if;
  if (p->>'reason') = 'other' and coalesce(trim(p->>'notes'), '') = '' then
    perform public.raise_business_error('validation', 'Explain the adjustment in the notes.');
  end if;

  if v_id is null then
    insert into public.stock_adjustments(doc_no, warehouse_id, reason, adjustment_date, allow_negative, notes)
    values (public.next_document_number('stock_adjustment', v_date), (p->>'warehouse_id')::uuid, p->>'reason', v_date,
      coalesce((p->>'allow_negative')::boolean, false), nullif(trim(p->>'notes'), ''))
    returning id into v_id;
  else
    update public.stock_adjustments set warehouse_id = (p->>'warehouse_id')::uuid, reason = p->>'reason',
      adjustment_date = v_date, allow_negative = coalesce((p->>'allow_negative')::boolean, false),
      notes = nullif(trim(p->>'notes'), ''), status = 'draft', rejection_reason = null
    where id = v_id;
    delete from public.stock_adjustment_lines where stock_adjustment_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_n := v_n + 1;
    perform public.inv_validate_stock_product(nullif(v_line->>'product_id', '')::uuid, v_n);
    v_mode := coalesce(nullif(v_line->>'mode', ''), 'change');
    if v_mode = 'change' and coalesce(nullif(v_line->>'qty_change', '')::numeric, 0) = 0 then
      perform public.raise_business_error('validation', format('Line %s: enter a quantity to add or remove.', v_n));
    end if;
    if v_mode = 'count' and coalesce(nullif(v_line->>'counted_qty', '')::numeric, -1) < 0 then
      perform public.raise_business_error('validation', format('Line %s: enter the counted quantity.', v_n));
    end if;
    if exists (select 1 from public.stock_adjustment_lines
               where stock_adjustment_id = v_id and product_id = (v_line->>'product_id')::uuid) then
      perform public.raise_business_error('validation', format('Line %s: each product may appear only once.', v_n));
    end if;
    insert into public.stock_adjustment_lines(stock_adjustment_id, line_no, product_id, mode, qty_change, counted_qty,
      unit_cost_base, notes)
    values (v_id, v_n, (v_line->>'product_id')::uuid, v_mode,
      case when v_mode = 'change' then (v_line->>'qty_change')::numeric end,
      case when v_mode = 'count' then (v_line->>'counted_qty')::numeric end,
      case when public.has_permission('inventory.view_valuation') then nullif(v_line->>'unit_cost_base', '')::numeric end,
      nullif(trim(v_line->>'notes'), ''));
  end loop;
  return v_id;
end $$;

create or replace function public.submit_stock_adjustment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.stock_adjustments;
begin
  perform public.require_permission('inventory.adjust');
  select * into a from public.stock_adjustments where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Adjustment not found.'); end if;
  if a.status not in ('draft', 'rejected') then
    perform public.raise_business_error('invalid_state', 'Only draft adjustments can be submitted.');
  end if;
  update public.stock_adjustments set status = 'submitted', submitted_at = now(), submitted_by = auth.uid(),
         rejection_reason = null where id = p_id;
  insert into public.approval_requests(doc_type, doc_id, doc_no, reasons, approver_permission, requested_by)
  values ('stock_adjustment', p_id, a.doc_no,
          array['Stock adjustment (' || replace(a.reason, '_', ' ') || ')'
                || case when a.allow_negative then ' — allows negative stock' else '' end],
          case when a.allow_negative then 'inventory.allow_negative' else 'inventory.approve_adjustment' end,
          auth.uid());
  perform public.notify_permission_holders('inventory.approve_adjustment', 'Stock adjustment awaiting approval',
    a.doc_no, '/inventory/adjustments/' || p_id);
end $$;

-- Approval posts the adjustment in the same transaction.
-- Internal: reached through decide_approval().
create or replace function public.stock_adjustment_apply(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.stock_adjustments;
  l public.stock_adjustment_lines;
  v_level public.stock_levels;
  v_on_hand numeric;
  v_change numeric;
  v_cost numeric;
  v_prod public.products;
begin
  select * into a from public.stock_adjustments where id = p_id for update;
  if a.status <> 'submitted' then
    perform public.raise_business_error('invalid_state', 'Only submitted adjustments can be approved.');
  end if;
  if a.allow_negative and not public.has_permission('inventory.allow_negative') then
    perform public.raise_business_error('forbidden', 'Adjustments that allow negative stock must be approved by management.');
  end if;
  perform public.inv_require_active_warehouse(a.warehouse_id);

  for l in select * from public.stock_adjustment_lines where stock_adjustment_id = p_id order by product_id, line_no loop
    select * into v_level from public.stock_levels where product_id = l.product_id and warehouse_id = a.warehouse_id;
    v_on_hand := coalesce(v_level.qty_on_hand, 0);
    v_change := case when l.mode = 'count' then l.counted_qty - v_on_hand else l.qty_change end;

    perform set_config('smp.stock_posting', 'on', true);
    update public.stock_adjustment_lines set system_qty = v_on_hand, posted_change = v_change where id = l.id;
    perform set_config('smp.stock_posting', 'off', true);
    continue when v_change = 0;

    if v_change > 0 then
      select * into v_prod from public.products where id = l.product_id;
      -- Cost for added stock: as entered, else current average, else purchase price.
      v_cost := coalesce(l.unit_cost_base, nullif(v_level.avg_cost, 0),
                         round(v_prod.purchase_price * coalesce(public.rate_to_base(v_prod.currency_code), 1), 4), 0);
      perform public.stock_post_movement(l.product_id, a.warehouse_id,
        case when a.reason = 'opening_balance' then 'opening' else 'adjust_in' end::public.movement_type,
        v_change, v_cost, 'stock_adjustment', a.id, l.id, a.doc_no, coalesce(l.notes, a.notes), 0, false, null);
    else
      perform public.stock_post_movement(l.product_id, a.warehouse_id, 'adjust_out', -v_change, null,
        'stock_adjustment', a.id, l.id, a.doc_no, coalesce(l.notes, a.notes), 0, a.allow_negative, null);
    end if;
  end loop;
  update public.stock_adjustments set status = 'posted', approved_at = now(), approved_by = auth.uid() where id = p_id;
end $$;

-- Cancel a draft inventory document (posted documents are reversed, not cancelled).
create or replace function public.cancel_inventory_document(p_type text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  case p_type
    when 'goods_receipt' then perform public.require_permission('inventory.receive');
    when 'goods_issue' then perform public.require_permission('inventory.issue');
    when 'stock_transfer' then perform public.require_permission('inventory.transfer');
    when 'stock_adjustment' then perform public.require_permission('inventory.adjust');
    else perform public.raise_business_error('validation', 'Unknown document type.');
  end case;
  execute format('select status from public.%I where id = $1 for update',
    case p_type when 'goods_receipt' then 'goods_receipts' when 'goods_issue' then 'goods_issues'
                when 'stock_transfer' then 'stock_transfers' else 'stock_adjustments' end)
    into v_status using p_id;
  if v_status is null then perform public.raise_business_error('not_found', 'Document not found.'); end if;
  if v_status not in ('draft', 'rejected', 'submitted') then
    perform public.raise_business_error('invalid_state', 'Only unposted documents can be cancelled.');
  end if;
  if p_type = 'stock_adjustment' then
    update public.approval_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
     where doc_type = 'stock_adjustment' and doc_id = p_id and status = 'pending';
  end if;
  execute format('update public.%I set status = ''cancelled'' where id = $1',
    case p_type when 'goods_receipt' then 'goods_receipts' when 'goods_issue' then 'goods_issues'
                when 'stock_transfer' then 'stock_transfers' else 'stock_adjustments' end) using p_id;
end $$;

-- =============================================================================
-- INVENTORY VIEWS
-- Quantities are visible to anyone with inventory.view (or product.view for
-- the product-level summary); cost and valuation only with
-- inventory.view_valuation.
-- =============================================================================

-- Incoming stock = transfers in transit to the warehouse (+ open purchase
-- order quantities once the procurement module extends this view).
create or replace view public.v_stock_incoming as
select tl.product_id, t.to_warehouse_id as warehouse_id, sum(tl.qty) as qty_incoming
from public.stock_transfers t
join public.stock_transfer_lines tl on tl.stock_transfer_id = t.id
where t.status = 'in_transit'
group by tl.product_id, t.to_warehouse_id;
revoke all on public.v_stock_incoming from anon, authenticated;

create or replace view public.v_inventory_position as
with keys as (
  select product_id, warehouse_id from public.stock_levels
  union
  select product_id, warehouse_id from public.v_stock_incoming
)
select p.id as product_id, p.sku, p.name as product_name, p.category_id, p.brand_id, p.is_active,
       u.code as uom_code,
       w.id as warehouse_id, w.code as warehouse_code, w.name as warehouse_name,
       coalesce(sl.qty_on_hand, 0)   as physical_qty,
       coalesce(sl.qty_reserved, 0)  as reserved_qty,
       coalesce(sl.qty_available, 0) as available_qty,
       coalesce(i.qty_incoming, 0)   as incoming_qty,
       sl.last_movement_at,
       case when public.has_permission('inventory.view_valuation') then sl.avg_cost end   as avg_cost,
       case when public.has_permission('inventory.view_valuation') then sl.stock_value end as stock_value
from keys k
join public.products p on p.id = k.product_id
join public.warehouses w on w.id = k.warehouse_id
join public.units_of_measure u on u.id = p.uom_id
left join public.stock_levels sl on sl.product_id = k.product_id and sl.warehouse_id = k.warehouse_id
left join public.v_stock_incoming i on i.product_id = k.product_id and i.warehouse_id = k.warehouse_id
where public.has_permission('inventory.view');
revoke all on public.v_inventory_position from anon;
grant select on public.v_inventory_position to authenticated;

create or replace view public.v_product_inventory as
select p.id as product_id, p.sku, p.name as product_name, p.category_id, p.brand_id, p.item_type, p.is_active,
       p.min_stock_level, u.code as uom_code,
       coalesce(s.physical, 0)  as physical_qty,
       coalesce(s.reserved, 0)  as reserved_qty,
       coalesce(s.physical, 0) - coalesce(s.reserved, 0) as available_qty,
       coalesce(i.incoming, 0)  as incoming_qty,
       p.item_type = 'stock' and p.min_stock_level > 0
         and coalesce(s.physical, 0) - coalesce(s.reserved, 0) < p.min_stock_level as below_min,
       case when public.has_permission('inventory.view_valuation') then s.value end as stock_value,
       case when public.has_permission('inventory.view_valuation') and coalesce(s.physical, 0) > 0
            then round(s.value / s.physical, 4) end as avg_cost
from public.products p
join public.units_of_measure u on u.id = p.uom_id
left join (select product_id, sum(qty_on_hand) physical, sum(qty_reserved) reserved, sum(stock_value) value
             from public.stock_levels group by product_id) s on s.product_id = p.id
left join (select product_id, sum(qty_incoming) incoming from public.v_stock_incoming group by product_id) i
       on i.product_id = p.id
where public.has_permission('product.view');
revoke all on public.v_product_inventory from anon;
grant select on public.v_product_inventory to authenticated;

-- Movement history; cost columns only with valuation permission.
create or replace view public.v_stock_movements as
select m.id, m.seq, m.moved_at, m.product_id, p.sku, p.name as product_name, m.warehouse_id, w.code as warehouse_code,
       m.movement_type, m.qty, m.on_hand_change, m.reserved_change, m.on_hand_after, m.reserved_after,
       m.on_hand_after - m.reserved_after as available_after,
       m.source_type, m.source_id, m.source_doc_no, m.sales_order_line_id, m.notes,
       m.negative_authorised_by, m.created_by, pr.full_name as created_by_name,
       case when public.has_permission('inventory.view_valuation') then m.unit_cost end as unit_cost,
       case when public.has_permission('inventory.view_valuation') then m.value_change end as value_change,
       case when public.has_permission('inventory.view_valuation') then m.avg_cost_after end as avg_cost_after
from public.stock_movements m
join public.products p on p.id = m.product_id
join public.warehouses w on w.id = m.warehouse_id
left join public.profiles pr on pr.id = m.created_by
where public.has_permission('inventory.view');
revoke all on public.v_stock_movements from anon;
grant select on public.v_stock_movements to authenticated;

-- Warehouse valuation summary.
create or replace function public.inventory_valuation(p_warehouse_id uuid default null)
returns table (warehouse_id uuid, warehouse_code text, warehouse_name text, products bigint,
               physical_qty numeric, stock_value numeric)
language sql stable security definer set search_path = public as $$
  select w.id, w.code, w.name, count(sl.product_id) filter (where sl.qty_on_hand <> 0),
         coalesce(sum(sl.qty_on_hand), 0), coalesce(sum(sl.stock_value), 0)
  from public.warehouses w
  left join public.stock_levels sl on sl.warehouse_id = w.id
  where public.has_permission('inventory.view_valuation')
    and (p_warehouse_id is null or w.id = p_warehouse_id)
  group by w.id order by w.code;
$$;

-- Daily job: alert procurement about products below minimum (once per day each).
create or replace function public.notify_low_stock()
returns integer language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select p.id, p.sku, p.name, p.min_stock_level,
           coalesce(sum(sl.qty_on_hand - sl.qty_reserved), 0) as available
    from public.products p
    left join public.stock_levels sl on sl.product_id = p.id
    where p.is_active and p.item_type = 'stock' and p.min_stock_level > 0
      and (p.low_stock_alerted_at is null or p.low_stock_alerted_at < now() - interval '20 hours')
    group by p.id
    having coalesce(sum(sl.qty_on_hand - sl.qty_reserved), 0) < p.min_stock_level
  loop
    perform public.notify_permission_holders('purchase_requisition.manage', 'Low stock: ' || r.sku,
      format('%s — available %s, minimum %s', r.name, r.available, r.min_stock_level), '/products/' || r.id);
    update public.products set low_stock_alerted_at = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- =============================================================================
-- ROW LEVEL SECURITY for this module
-- =============================================================================
alter table public.product_attachments enable row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipt_lines enable row level security;
alter table public.goods_issues enable row level security;
alter table public.goods_issue_lines enable row level security;
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_lines enable row level security;
alter table public.stock_adjustments enable row level security;
alter table public.stock_adjustment_lines enable row level security;

revoke insert, update, delete, truncate on
  public.goods_receipts, public.goods_receipt_lines, public.goods_issues, public.goods_issue_lines,
  public.stock_transfers, public.stock_transfer_lines, public.stock_adjustments, public.stock_adjustment_lines
from anon, authenticated;
revoke update on public.product_attachments from anon, authenticated;

create policy product_attachments_read on public.product_attachments for select to authenticated
  using (public.has_permission('product.view'));
create policy product_attachments_insert on public.product_attachments for insert to authenticated
  with check (public.has_permission('product.edit') and created_by = auth.uid());
create policy product_attachments_delete on public.product_attachments for delete to authenticated
  using (public.has_permission('product.edit'));

create policy goods_receipts_read on public.goods_receipts for select to authenticated
  using (public.has_permission('inventory.view'));
-- Receipt lines carry purchase costs.
create policy goods_receipt_lines_read on public.goods_receipt_lines for select to authenticated
  using (public.has_permission('inventory.receive') or public.has_permission('inventory.view_valuation'));
create policy goods_issues_read on public.goods_issues for select to authenticated
  using (public.has_permission('inventory.view'));
create policy goods_issue_lines_read on public.goods_issue_lines for select to authenticated
  using (public.has_permission('inventory.view'));
create policy stock_transfers_read on public.stock_transfers for select to authenticated
  using (public.has_permission('inventory.view'));
create policy stock_transfer_lines_read on public.stock_transfer_lines for select to authenticated
  using (public.has_permission('inventory.view'));
create policy stock_adjustments_read on public.stock_adjustments for select to authenticated
  using (public.has_permission('inventory.view'));
create policy stock_adjustment_lines_read on public.stock_adjustment_lines for select to authenticated
  using (public.has_permission('inventory.adjust') or public.has_permission('inventory.approve_adjustment')
         or public.has_permission('inventory.view_valuation'));

-- Internal helpers must not be callable through the API.
revoke execute on function public.stock_post_movement(uuid, uuid, public.movement_type, numeric, numeric, text, uuid, uuid, text, text, numeric, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.stock_reserve(uuid, uuid, numeric, text) from public, anon, authenticated;
revoke execute on function public.stock_release(uuid, numeric, text, boolean) from public, anon, authenticated;
revoke execute on function public.stock_adjustment_apply(uuid) from public, anon, authenticated;
revoke execute on function public.notify_low_stock() from public, anon, authenticated;

-- =============================================================================
-- STORAGE: private bucket for product images and attachments.
-- Paths: products/<product_id>/<file>. Skipped when Storage is not installed
-- (plain-Postgres test runs).
-- =============================================================================
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('product-media', 'product-media', false, 26214400,
            array['image/jpeg','image/png','image/webp','application/pdf',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  'application/msword','application/vnd.ms-excel','application/zip','image/vnd.dwg'])
    on conflict (id) do nothing;

    execute $p$create policy product_media_read on storage.objects for select to authenticated
      using (bucket_id = 'product-media' and public.has_permission('product.view'))$p$;
    execute $p$create policy product_media_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'product-media' and public.has_permission('product.edit')
                  and (storage.foldername(name))[1] = 'products')$p$;
    execute $p$create policy product_media_update on storage.objects for update to authenticated
      using (bucket_id = 'product-media' and public.has_permission('product.edit'))$p$;
    execute $p$create policy product_media_delete on storage.objects for delete to authenticated
      using (bucket_id = 'product-media' and public.has_permission('product.edit'))$p$;
  end if;
end $$;
