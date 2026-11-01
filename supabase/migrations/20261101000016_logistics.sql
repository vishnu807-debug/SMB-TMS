-- =============================================================================
-- 0016 Logistics
--   shipments (vehicle / courier trips) · delivery notes (partial, from reserved
--   stock) · dispatch posts the stock issue and consumes the reservation ·
--   proof of delivery · sales order fulfilment roll-up.
-- =============================================================================

create type public.delivery_status as enum ('draft', 'dispatched', 'delivered', 'cancelled');
create type public.shipment_status as enum ('planned', 'in_transit', 'completed', 'cancelled');

-- ---------------------------------------------------------------------------
-- Shipments: one trip that carries one or more delivery notes.
-- ---------------------------------------------------------------------------
create table public.shipments (
  id            uuid primary key default gen_random_uuid(),
  doc_no        text not null unique,
  shipment_date date not null default current_date,
  mode          text not null default 'own_vehicle' check (mode in ('own_vehicle', 'courier', 'freight_forwarder', 'customer_collection')),
  carrier_name  text,
  vehicle_no    text,
  driver_name   text,
  driver_phone  text,
  tracking_no   text,
  status        public.shipment_status not null default 'planned',
  departed_at   timestamptz,
  completed_at  timestamptz,
  notes         text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id)
);
create index shipments_status_idx on public.shipments(status, shipment_date);
select public.attach_standard_triggers('public.shipments');

-- ---------------------------------------------------------------------------
-- Delivery notes
-- ---------------------------------------------------------------------------
create table public.delivery_notes (
  id                  uuid primary key default gen_random_uuid(),
  doc_no              text not null unique,
  sales_order_id      uuid not null references public.sales_orders(id),
  customer_id         uuid not null references public.customers(id),
  warehouse_id        uuid not null references public.warehouses(id),
  shipment_id         uuid references public.shipments(id),
  delivery_address_id uuid references public.customer_addresses(id),
  delivery_address    text,                 -- snapshot printed on the note
  contact_name        text,
  contact_phone       text,
  delivery_date       date not null default current_date,
  status              public.delivery_status not null default 'draft',
  notes               text,
  dispatched_at       timestamptz,
  dispatched_by       uuid references public.profiles(id),
  delivered_at        timestamptz,
  received_by_name    text,
  pod_notes           text,
  pod_path            text,                 -- signed delivery note / photo in the delivery-pod bucket
  pod_recorded_by     uuid references public.profiles(id),
  cancel_reason       text,
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id),
  constraint dn_pod check (status <> 'delivered' or (delivered_at is not null and coalesce(trim(received_by_name), '') <> '')),
  constraint dn_cancel_reason check (status <> 'cancelled' or coalesce(trim(cancel_reason), '') <> '')
);
create index delivery_notes_so_idx on public.delivery_notes(sales_order_id);
create index delivery_notes_status_idx on public.delivery_notes(status, delivery_date);
create index delivery_notes_shipment_idx on public.delivery_notes(shipment_id);
select public.attach_standard_triggers('public.delivery_notes');

create table public.delivery_note_lines (
  id                  uuid primary key default gen_random_uuid(),
  delivery_note_id    uuid not null references public.delivery_notes(id) on delete cascade,
  line_no             integer not null check (line_no > 0),
  sales_order_line_id uuid not null references public.sales_order_lines(id),
  product_id          uuid not null references public.products(id),
  description         text not null,
  qty                 numeric(18,3) not null check (qty > 0),
  qty_invoiced        numeric(18,3) not null default 0 check (qty_invoiced >= 0),
  notes               text,
  unique (delivery_note_id, line_no),
  constraint dnl_invoiced_le_qty check (qty_invoiced <= qty)
);
create index on public.delivery_note_lines(sales_order_line_id);
select public.attach_standard_triggers('public.delivery_note_lines', false);

-- Lines are frozen once the note leaves draft (qty_invoiced is maintained by finance with the lock flag).
create or replace function public.delivery_note_lines_guard()
returns trigger language plpgsql as $$
begin
  if (select status from public.delivery_notes where id = coalesce(new.delivery_note_id, old.delivery_note_id)) <> 'draft'
     and coalesce(current_setting('smp.allow_locked_edit', true), '') <> 'on' then
    raise exception using errcode = 'P0001', hint = 'locked', message = 'This delivery note has been dispatched and cannot be changed.';
  end if;
  return coalesce(new, old);
end $$;
create trigger delivery_note_lines_guard before insert or update or delete on public.delivery_note_lines
  for each row execute function public.delivery_note_lines_guard();

-- ---------------------------------------------------------------------------
-- Sales order fulfilment roll-up
-- ---------------------------------------------------------------------------
create or replace function public.sales_orders_refresh_fulfilment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.sales_orders so set status = case
      when not exists (select 1 from public.sales_order_lines l where l.sales_order_id = so.id and not l.is_cancelled and l.qty_delivered < l.qty)
        then 'fulfilled'
      when exists (select 1 from public.sales_order_lines l where l.sales_order_id = so.id and l.qty_delivered > 0)
        then 'partially_fulfilled'
      else 'confirmed' end::public.sales_order_status
  where so.id = p_id and so.status in ('confirmed', 'partially_fulfilled', 'fulfilled');
end $$;

-- Quantity of an order line that may still go on a new delivery note
-- (ordered − delivered − on other draft notes).
create or replace function public.order_line_deliverable_qty(p_line uuid, p_excluding_dn uuid default null)
returns numeric language sql stable security definer set search_path = public as $$
  select greatest(l.qty - l.qty_delivered - coalesce((select sum(dl.qty) from public.delivery_note_lines dl
            join public.delivery_notes d on d.id = dl.delivery_note_id
           where dl.sales_order_line_id = l.id and d.status = 'draft' and d.id is distinct from p_excluding_dn), 0), 0)
  from public.sales_order_lines l where l.id = p_line and not l.is_cancelled;
$$;

-- Delivery planner: what can go out now, per order line and warehouse.
create or replace view public.v_deliverable_lines as
select l.id as sales_order_line_id, l.sales_order_id, so.doc_no as sales_order_no, so.customer_id, c.name as customer_name,
       so.required_date, l.line_no, l.product_id, p.sku, p.item_type, l.description, u.code as uom_code,
       l.qty, l.qty_delivered, l.qty_reserved,
       public.order_line_deliverable_qty(l.id) as qty_open,
       r.warehouse_id, w.code as warehouse_code, coalesce(r.qty, 0) as qty_reserved_here,
       -- Ready = reserved stock (or a non-stock item) not already on a draft note.
       least(public.order_line_deliverable_qty(l.id), case when p.item_type = 'stock' then coalesce(r.qty, 0) else l.qty - l.qty_delivered end) as qty_ready
from public.sales_order_lines l
join public.sales_orders so on so.id = l.sales_order_id
join public.customers c on c.id = so.customer_id
join public.products p on p.id = l.product_id
join public.units_of_measure u on u.id = p.uom_id
left join public.stock_reservations r on r.sales_order_line_id = l.id and r.status = 'active'
left join public.warehouses w on w.id = r.warehouse_id
where so.status in ('confirmed', 'partially_fulfilled') and not l.is_cancelled and l.qty_delivered < l.qty
  and public.has_permission('delivery.view') and public.can_view_owned(so.sales_rep_id, 'sales_order.view_all');
revoke all on public.v_deliverable_lines from anon;
grant select on public.v_deliverable_lines to authenticated;

-- ---------------------------------------------------------------------------
-- Save a draft delivery note
-- ---------------------------------------------------------------------------
create or replace function public.save_delivery_note(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := nullif(p->>'id', '')::uuid;
  v_old  public.delivery_notes;
  so     public.sales_orders;
  v_addr public.customer_addresses;
  v_line jsonb;
  v_n    integer := 0;
  v_sol  public.sales_order_lines;
  v_prod public.products;
  v_open numeric;
  v_res  numeric;
  v_wh   uuid := nullif(p->>'warehouse_id', '')::uuid;
  v_date date := coalesce(nullif(p->>'delivery_date', '')::date, current_date);
begin
  perform public.require_permission('delivery.manage');
  if v_id is not null then
    select * into v_old from public.delivery_notes where id = v_id for update;
    if not found then perform public.raise_business_error('not_found', 'Delivery note not found.'); end if;
    if v_old.status <> 'draft' then perform public.raise_business_error('locked', 'Only draft delivery notes can be edited.'); end if;
  end if;
  select * into so from public.sales_orders where id = coalesce(nullif(p->>'sales_order_id', '')::uuid, v_old.sales_order_id);
  if not found then perform public.raise_business_error('validation', 'Select the sales order.'); end if;
  if so.status not in ('confirmed', 'partially_fulfilled') then
    perform public.raise_business_error('invalid_state', format('Sales order %s is %s; only confirmed orders can be delivered.', so.doc_no, replace(so.status::text, '_', ' ')));
  end if;
  perform public.inv_require_active_warehouse(v_wh);
  if nullif(p->>'delivery_address_id', '') is not null then
    select * into v_addr from public.customer_addresses where id = (p->>'delivery_address_id')::uuid and customer_id = so.customer_id;
    if not found then perform public.raise_business_error('validation', 'The delivery address does not belong to this customer.'); end if;
  end if;
  if nullif(p->>'shipment_id', '') is not null
     and not exists (select 1 from public.shipments where id = (p->>'shipment_id')::uuid and status = 'planned') then
    perform public.raise_business_error('validation', 'Only planned shipments can take more delivery notes.');
  end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then perform public.raise_business_error('validation', 'Add at least one item.'); end if;

  if v_id is null then
    insert into public.delivery_notes(doc_no, sales_order_id, customer_id, warehouse_id, shipment_id, delivery_address_id, delivery_address,
      contact_name, contact_phone, delivery_date, notes)
    values (public.next_document_number('delivery_note', v_date), so.id, so.customer_id, v_wh, nullif(p->>'shipment_id', '')::uuid, v_addr.id,
      coalesce(nullif(trim(p->>'delivery_address'), ''),
               case when v_addr.id is not null then concat_ws(', ', v_addr.line1, v_addr.line2, v_addr.city, v_addr.emirate, v_addr.country) end),
      nullif(trim(p->>'contact_name'), ''), nullif(trim(p->>'contact_phone'), ''), v_date, nullif(trim(p->>'notes'), ''))
    returning id into v_id;
  else
    update public.delivery_notes set warehouse_id = v_wh, shipment_id = nullif(p->>'shipment_id', '')::uuid, delivery_address_id = v_addr.id,
      delivery_address = coalesce(nullif(trim(p->>'delivery_address'), ''),
               case when v_addr.id is not null then concat_ws(', ', v_addr.line1, v_addr.line2, v_addr.city, v_addr.emirate, v_addr.country) end),
      contact_name = nullif(trim(p->>'contact_name'), ''), contact_phone = nullif(trim(p->>'contact_phone'), ''),
      delivery_date = v_date, notes = nullif(trim(p->>'notes'), '')
    where id = v_id;
    delete from public.delivery_note_lines where delivery_note_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p->'lines') loop
    continue when coalesce((v_line->>'qty')::numeric, 0) = 0;
    v_n := v_n + 1;
    select * into v_sol from public.sales_order_lines where id = nullif(v_line->>'sales_order_line_id', '')::uuid;
    if not found or v_sol.sales_order_id <> so.id then
      perform public.raise_business_error('validation', format('Line %s is not on sales order %s.', v_n, so.doc_no));
    end if;
    if (v_line->>'qty')::numeric < 0 then perform public.raise_business_error('validation', format('Line %s: quantity cannot be negative.', v_n)); end if;
    select * into v_prod from public.products where id = v_sol.product_id;
    v_open := public.order_line_deliverable_qty(v_sol.id, v_id);
    if (v_line->>'qty')::numeric > v_open then
      perform public.raise_business_error('validation', format('%s: only %s left to deliver (including other draft notes).', v_sol.description, v_open));
    end if;
    if v_prod.item_type = 'stock' then
      select coalesce(sum(qty), 0) into v_res from public.stock_reservations
       where sales_order_line_id = v_sol.id and warehouse_id = v_wh and status = 'active';
      if (v_line->>'qty')::numeric > v_res then
        perform public.raise_business_error('validation',
          format('%s: only %s is reserved for this order in the selected warehouse. Reserve stock (or receive the purchase) first.', v_sol.description, v_res));
      end if;
    end if;
    insert into public.delivery_note_lines(delivery_note_id, line_no, sales_order_line_id, product_id, description, qty, notes)
    values (v_id, v_n, v_sol.id, v_sol.product_id, v_sol.description, (v_line->>'qty')::numeric, nullif(trim(v_line->>'notes'), ''));
  end loop;
  if v_n = 0 then perform public.raise_business_error('validation', 'Enter a quantity for at least one item.'); end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Dispatch: stock leaves the warehouse from the order's reservation.
-- ---------------------------------------------------------------------------
create or replace function public.dispatch_delivery_note(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  d    public.delivery_notes;
  l    public.delivery_note_lines;
  so   public.sales_orders;
  r    public.stock_reservations;
  v_prod public.products;
  v_sol public.sales_order_lines;
  v_prev text := coalesce(current_setting('smp.allow_locked_edit', true), '');
begin
  perform public.require_permission('delivery.manage');
  select * into d from public.delivery_notes where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Delivery note not found.'); end if;
  if d.status <> 'draft' then perform public.raise_business_error('invalid_state', 'This delivery note has already been dispatched or cancelled.'); end if;
  select * into so from public.sales_orders where id = d.sales_order_id for update;
  if so.status not in ('confirmed', 'partially_fulfilled') then
    perform public.raise_business_error('invalid_state', format('Sales order %s is %s and cannot be delivered.', so.doc_no, replace(so.status::text, '_', ' ')));
  end if;
  if not exists (select 1 from public.delivery_note_lines where delivery_note_id = p_id) then
    perform public.raise_business_error('validation', 'The delivery note has no items.');
  end if;

  for l in select * from public.delivery_note_lines where delivery_note_id = p_id order by product_id, line_no loop
    select * into v_sol from public.sales_order_lines where id = l.sales_order_line_id for update;
    if v_sol.is_cancelled or l.qty > v_sol.qty - v_sol.qty_delivered then
      perform public.raise_business_error('validation', format('%s: only %s left to deliver.', l.description, greatest(v_sol.qty - v_sol.qty_delivered, 0)));
    end if;
    select * into v_prod from public.products where id = l.product_id;
    if v_prod.item_type = 'stock' then
      select * into r from public.stock_reservations
       where sales_order_line_id = l.sales_order_line_id and warehouse_id = d.warehouse_id and status = 'active' for update;
      if not found or r.qty < l.qty then
        perform public.raise_business_error('reserved_stock', format('%s: only %s reserved for this order in the warehouse.', l.description, coalesce(r.qty, 0)));
      end if;
      -- Reservation is consumed (not released) and the issue takes it off reserved and on-hand together.
      perform public.stock_release(r.id, l.qty, 'Delivered on ' || d.doc_no, true);
      perform public.stock_post_movement(l.product_id, d.warehouse_id, 'issue', l.qty, null,
        'delivery_note', d.id, l.id, d.doc_no, 'Delivery to ' || (select name from public.customers where id = d.customer_id), l.qty, false, l.sales_order_line_id);
    end if;
    perform set_config('smp.allow_locked_edit', 'on', true);
    update public.sales_order_lines set qty_delivered = qty_delivered + l.qty where id = l.sales_order_line_id;
    perform set_config('smp.allow_locked_edit', v_prev, true);
  end loop;

  update public.delivery_notes set status = 'dispatched', dispatched_at = now(), dispatched_by = auth.uid() where id = p_id;
  perform public.sales_orders_refresh_fulfilment(so.id);
  perform public.notify_user(so.sales_rep_id, 'Order ' || so.doc_no || ' dispatched', d.doc_no || ' is on its way', '/logistics/deliveries/' || p_id);
end $$;

-- Proof of delivery.
create or replace function public.confirm_delivery(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare d public.delivery_notes; v_at timestamptz := coalesce(nullif(p->>'delivered_at', '')::timestamptz, now());
begin
  perform public.require_permission('delivery.manage');
  select * into d from public.delivery_notes where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Delivery note not found.'); end if;
  if d.status <> 'dispatched' then perform public.raise_business_error('invalid_state', 'Only dispatched deliveries can be confirmed.'); end if;
  if coalesce(trim(p->>'received_by_name'), '') = '' then
    perform public.raise_business_error('validation', 'Enter the name of the person who received the goods.');
  end if;
  if v_at > now() + interval '5 minutes' or v_at < d.dispatched_at - interval '1 minute' then
    perform public.raise_business_error('validation', 'The delivery time must be between dispatch and now.');
  end if;
  if nullif(p->>'pod_path', '') is not null and (p->>'pod_path') not like 'delivery-notes/' || p_id || '/%' then
    perform public.raise_business_error('validation', 'Invalid proof-of-delivery file.');
  end if;
  update public.delivery_notes set status = 'delivered', delivered_at = v_at, received_by_name = trim(p->>'received_by_name'),
    pod_notes = nullif(trim(p->>'pod_notes'), ''), pod_path = coalesce(nullif(p->>'pod_path', ''), pod_path), pod_recorded_by = auth.uid()
  where id = p_id;
  if d.shipment_id is not null and not exists (select 1 from public.delivery_notes where shipment_id = d.shipment_id and status in ('draft', 'dispatched')) then
    update public.shipments set status = 'completed', completed_at = now() where id = d.shipment_id and status = 'in_transit';
  end if;
end $$;

create or replace function public.cancel_delivery_note(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('delivery.manage');
  if coalesce(trim(p_reason), '') = '' then perform public.raise_business_error('validation', 'Please give a reason for cancelling.'); end if;
  update public.delivery_notes set status = 'cancelled', cancel_reason = trim(p_reason), shipment_id = null where id = p_id and status = 'draft';
  if not found then
    perform public.raise_business_error('invalid_state', 'Only draft delivery notes can be cancelled. Dispatched goods must be returned through a customer return.');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Shipments
-- ---------------------------------------------------------------------------
create or replace function public.save_shipment(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_date date := coalesce(nullif(p->>'shipment_date', '')::date, current_date); v_dn uuid;
begin
  perform public.require_permission('shipment.manage');
  if coalesce(p->>'mode', 'own_vehicle') not in ('own_vehicle', 'courier', 'freight_forwarder', 'customer_collection') then
    perform public.raise_business_error('validation', 'Choose how the goods travel.');
  end if;
  if v_id is null then
    insert into public.shipments(doc_no, shipment_date, mode, carrier_name, vehicle_no, driver_name, driver_phone, tracking_no, notes)
    values (public.next_document_number('shipment', v_date), v_date, coalesce(nullif(p->>'mode', ''), 'own_vehicle'),
      nullif(trim(p->>'carrier_name'), ''), nullif(upper(trim(p->>'vehicle_no')), ''), nullif(trim(p->>'driver_name'), ''),
      nullif(trim(p->>'driver_phone'), ''), nullif(trim(p->>'tracking_no'), ''), nullif(trim(p->>'notes'), ''))
    returning id into v_id;
  else
    update public.shipments set shipment_date = v_date, mode = coalesce(nullif(p->>'mode', ''), mode),
      carrier_name = nullif(trim(p->>'carrier_name'), ''), vehicle_no = nullif(upper(trim(p->>'vehicle_no')), ''),
      driver_name = nullif(trim(p->>'driver_name'), ''), driver_phone = nullif(trim(p->>'driver_phone'), ''),
      tracking_no = nullif(trim(p->>'tracking_no'), ''), notes = nullif(trim(p->>'notes'), '')
    where id = v_id and status in ('planned', 'in_transit');
    if not found then perform public.raise_business_error('invalid_state', 'Completed or cancelled shipments cannot be changed.'); end if;
  end if;
  if p ? 'delivery_note_ids' then
    if (select status from public.shipments where id = v_id) <> 'planned' then
      perform public.raise_business_error('invalid_state', 'Delivery notes can only be added before the shipment leaves.');
    end if;
    update public.delivery_notes set shipment_id = null where shipment_id = v_id and status = 'draft'
       and not (id = any (array(select jsonb_array_elements_text(p->'delivery_note_ids'))::uuid[]));
    for v_dn in select jsonb_array_elements_text(p->'delivery_note_ids')::uuid loop
      update public.delivery_notes set shipment_id = v_id where id = v_dn and status = 'draft';
      if not found then perform public.raise_business_error('validation', 'Only draft delivery notes can be put on a shipment.'); end if;
    end loop;
  end if;
  return v_id;
end $$;

-- Departure dispatches every draft delivery note on the shipment.
create or replace function public.dispatch_shipment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.shipments; v_dn uuid;
begin
  perform public.require_permission('shipment.manage');
  select * into s from public.shipments where id = p_id for update;
  if not found or s.status <> 'planned' then perform public.raise_business_error('invalid_state', 'Only planned shipments can be dispatched.'); end if;
  if not exists (select 1 from public.delivery_notes where shipment_id = p_id and status in ('draft', 'dispatched')) then
    perform public.raise_business_error('validation', 'Add at least one delivery note to the shipment.');
  end if;
  for v_dn in select id from public.delivery_notes where shipment_id = p_id and status = 'draft' order by doc_no loop
    perform public.dispatch_delivery_note(v_dn);
  end loop;
  update public.shipments set status = 'in_transit', departed_at = now() where id = p_id;
end $$;

create or replace function public.cancel_shipment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('shipment.manage');
  update public.shipments set status = 'cancelled' where id = p_id and status = 'planned';
  if not found then perform public.raise_business_error('invalid_state', 'Only planned shipments can be cancelled.'); end if;
  update public.delivery_notes set shipment_id = null where shipment_id = p_id and status = 'draft';
end $$;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------
alter table public.shipments enable row level security;
alter table public.delivery_notes enable row level security;
alter table public.delivery_note_lines enable row level security;
revoke insert, update, delete, truncate on public.shipments, public.delivery_notes, public.delivery_note_lines from anon, authenticated;

create policy shipments_read on public.shipments for select to authenticated
  using (public.has_permission('delivery.manage') or public.has_permission('shipment.manage') or public.has_permission('delivery.view'));
-- Sales staff with delivery.view see deliveries for orders they may see.
create policy delivery_notes_read on public.delivery_notes for select to authenticated
  using (public.has_permission('delivery.view')
         and (public.has_permission('delivery.manage') or exists (select 1 from public.sales_orders so where so.id = sales_order_id)));
create policy delivery_note_lines_read on public.delivery_note_lines for select to authenticated
  using (exists (select 1 from public.delivery_notes d where d.id = delivery_note_id));

revoke execute on function public.sales_orders_refresh_fulfilment(uuid) from public, anon, authenticated;

-- Proof-of-delivery files: private bucket, paths delivery-notes/<delivery_note_id>/<file>.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('delivery-pod', 'delivery-pod', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do nothing;
    execute $p$create policy delivery_pod_read on storage.objects for select to authenticated
      using (bucket_id = 'delivery-pod' and public.has_permission('delivery.view'))$p$;
    execute $p$create policy delivery_pod_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'delivery-pod' and public.has_permission('delivery.manage')
                  and (storage.foldername(name))[1] = 'delivery-notes')$p$;
  end if;
end $$;
