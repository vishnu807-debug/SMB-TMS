-- =============================================================================
-- 0018 Licensed modules
--   Each functional module can be switched on or off per installation from the
--   backend (Supabase SQL editor / service role) — not from inside the app, so a
--   client cannot enable modules they have not taken.
--
--   How it is enforced: every permission is tagged with the module(s) it belongs
--   to. has_permission() returns false for permissions whose modules are all off,
--   so menus, pages, database functions and Row Level Security all follow the
--   switch automatically. Switching a module off hides it; its data is kept and
--   reappears when it is switched on again.
-- =============================================================================

create table public.system_modules (
  code        text primary key,
  name        text not null,
  description text not null,
  is_core     boolean not null default false,      -- core cannot be switched off
  is_enabled  boolean not null default true,
  requires    text[] not null default '{}',        -- modules that must be on first
  sort_order  integer not null default 0,
  changed_at  timestamptz,
  changed_by  text,                                -- database role / note of who changed it
  constraint system_modules_core_on check (not is_core or is_enabled)
);
select public.attach_standard_triggers('public.system_modules', false);

insert into public.system_modules(code, name, description, is_core, is_enabled, requires, sort_order) values
  ('core',        'Core',                 'Users, roles, approvals, product catalogue, notifications, audit log and settings.', true, true, '{}', 0),
  ('sales',       'Sales & CRM',          'Customers, enquiries, follow-ups, quotations, sales orders and the sales dashboard.', false, true, '{}', 10),
  ('inventory',   'Inventory',            'Stock by warehouse, goods issues, transfers, adjustments, reservations, movement history and valuation.', false, true, '{}', 20),
  ('procurement', 'Procurement',          'Suppliers, purchase requisitions, supplier quotations, purchase orders and receiving against them.', false, true, '{}', 30),
  ('logistics',   'Logistics',            'Delivery notes, shipments, dispatch and proof of delivery.', false, true, '{sales}', 40),
  ('finance',     'Finance',              'Invoices, credit notes, receipts, supplier bills and payments, expenses, bank accounts and VAT summary.', false, true, '{}', 50),
  ('einvoicing',  'UAE e-invoicing',      'Sends invoices and credit notes as PINT AE e-invoices through an FTA-accredited service provider.', false,
     coalesce((select einvoicing_enabled from public.company_settings), false), '{finance}', 60);

-- ---------------------------------------------------------------------------
-- Which module(s) each permission belongs to (null = core, always available).
-- A permission listed under several modules is available when any of them is on.
-- ---------------------------------------------------------------------------
alter table public.permissions add column modules text[];

update public.permissions set modules = '{sales}' where code in (
  'dashboard.sales', 'report.sales', 'customer.view', 'customer.view_all', 'customer.create', 'customer.edit', 'customer.assign',
  'customer.set_credit', 'lead.view', 'lead.view_all', 'lead.create', 'lead.edit', 'lead.assign', 'activity.manage', 'activity.view_all',
  'quotation.view', 'quotation.view_all', 'quotation.create', 'quotation.edit', 'quotation.approve', 'quotation.view_cost',
  'sales_order.view', 'sales_order.view_all', 'sales_order.create', 'sales_order.edit', 'sales_order.confirm', 'sales_order.approve',
  'sales_order.cancel', 'sales_order.view_cost');
-- Finance needs to see customers to invoice them even without the Sales module.
update public.permissions set modules = '{sales,finance}' where code in ('customer.view', 'customer.view_all', 'customer.create', 'customer.edit', 'customer.set_credit');
update public.permissions set modules = '{inventory}' where code in (
  'dashboard.operations', 'report.inventory', 'inventory.view_valuation', 'inventory.issue', 'inventory.transfer', 'inventory.adjust',
  'inventory.approve_adjustment', 'inventory.allow_negative', 'inventory.reserve');
-- Stock figures are shown on quotations and purchase orders; receiving and warehouses are needed for purchasing.
update public.permissions set modules = '{inventory,sales,procurement}' where code = 'inventory.view';
update public.permissions set modules = '{inventory,procurement}' where code in ('inventory.receive', 'goods_receipt.post', 'warehouse.manage');
update public.permissions set modules = '{procurement}' where code in (
  'report.procurement', 'purchase_requisition.manage', 'purchase_order.view', 'purchase_order.create', 'purchase_order.approve');
-- Supplier bills need the supplier list even without Procurement.
update public.permissions set modules = '{procurement,finance}' where code in ('supplier.view', 'supplier.edit');
update public.permissions set modules = '{logistics}' where code in ('delivery.view', 'delivery.manage', 'shipment.manage');
update public.permissions set modules = '{finance}' where code in (
  'dashboard.finance', 'report.finance', 'invoice.view', 'invoice.create', 'invoice.post', 'invoice.void', 'payment.view', 'payment.record',
  'payment.void', 'payable.view', 'payable.manage', 'payable.approve', 'expense.submit', 'expense.view_all', 'expense.approve', 'expense.pay');

-- Every module referenced must exist (catches typos in the map above).
do $$
begin
  if exists (select 1 from public.permissions p, unnest(p.modules) m where m not in (select code from public.system_modules)) then
    raise exception 'permissions.modules refers to an unknown module';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------
create or replace function public.module_enabled(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_enabled from public.system_modules where code = p_code), false);
$$;

create or replace function public.permission_module_enabled(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.modules is null or exists (select 1 from public.system_modules m where m.code = any (p.modules) and m.is_enabled)
                     from public.permissions p where p.code = p_code), true);
$$;

create or replace function public.require_module(p_code text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.module_enabled(p_code) then
    perform public.raise_business_error('module_disabled',
      format('The %s module is not enabled for this installation.', coalesce((select name from public.system_modules where code = p_code), p_code)));
  end if;
end $$;

-- Permissions of switched-off modules are never granted — not even to the Super Administrator.
create or replace function public.has_permission(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.session_is_valid() and public.permission_module_enabled(p_code) and (
    exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
             where ur.user_id = auth.uid() and r.code = 'super_admin')
    or (
      not exists (select 1 from public.user_permissions up join public.permissions pm on pm.id = up.permission_id
                   where up.user_id = auth.uid() and pm.code = p_code and up.effect = 'deny'
                     and (up.expires_at is null or up.expires_at > now()))
      and (
        exists (select 1 from public.user_roles ur
                  join public.roles r on r.id = ur.role_id and r.is_active
                  join public.role_permissions rp on rp.role_id = r.id
                  join public.permissions pm on pm.id = rp.permission_id
                 where ur.user_id = auth.uid() and pm.code = p_code)
        or exists (select 1 from public.user_permissions up join public.permissions pm on pm.id = up.permission_id
                    where up.user_id = auth.uid() and pm.code = p_code and up.effect = 'grant'
                      and (up.expires_at is null or up.expires_at > now()))
      )
    )
  );
$$;

-- The user-management screen shows switched-off permissions as unavailable.
alter function public.user_effective_permissions(uuid) rename to user_effective_permissions_base;
revoke execute on function public.user_effective_permissions_base(uuid) from public, anon, authenticated;
create or replace function public.user_effective_permissions(p_user uuid)
returns table (code text, module text, description text, granted boolean, source text)
language sql stable security definer set search_path = public as $$
  select b.code, b.module, b.description,
         b.granted and public.permission_module_enabled(b.code),
         case when not public.permission_module_enabled(b.code) then 'Module not enabled' else b.source end
  from public.user_effective_permissions_base(p_user) b;
$$;

-- What the app needs to know (any signed-in user).
create or replace function public.enabled_modules()
returns setof text language sql stable security definer set search_path = public as $$
  select code from public.system_modules where is_enabled and auth.uid() is not null order by sort_order;
$$;

-- ---------------------------------------------------------------------------
-- Switching modules — backend only.
--   select public.set_module_enabled('procurement', false);
-- Run in the Supabase SQL editor (or with the service-role key). Calls made by
-- signed-in app users are refused, including the Super Administrator's.
-- ---------------------------------------------------------------------------
create or replace function public.set_module_enabled(p_code text, p_enabled boolean, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare m public.system_modules; v_missing text; v_dependants text;
begin
  if auth.uid() is not null then
    raise exception using errcode = 'P0001', hint = 'forbidden',
      message = 'Modules are configured by the system provider in the backend, not from the application.';
  end if;
  select * into m from public.system_modules where code = p_code for update;
  if not found then raise exception 'Unknown module %. Valid: %', p_code, (select string_agg(code, ', ' order by sort_order) from public.system_modules); end if;
  if m.is_core then raise exception 'The core module is always on.'; end if;
  if m.is_enabled = p_enabled then return format('%s is already %s.', m.name, case when p_enabled then 'on' else 'off' end); end if;
  if p_enabled then
    select string_agg(s.name, ', ') into v_missing from public.system_modules s where s.code = any (m.requires) and not s.is_enabled;
    if v_missing is not null then raise exception '% needs % to be switched on first.', m.name, v_missing; end if;
  else
    select string_agg(s.name, ', ') into v_dependants from public.system_modules s where p_code = any (s.requires) and s.is_enabled;
    if v_dependants is not null then raise exception '% is used by % — switch that off first.', m.name, v_dependants; end if;
  end if;
  update public.system_modules set is_enabled = p_enabled, changed_at = now(),
    changed_by = coalesce(nullif(trim(p_note), ''), current_user) where code = p_code;
  return format('%s switched %s.', m.name, case when p_enabled then 'ON' else 'OFF' end);
end $$;
revoke execute on function public.set_module_enabled(text, boolean, text) from public, anon, authenticated;
grant execute on function public.set_module_enabled(text, boolean, text) to service_role;

-- Direct edits from the app are impossible too.
alter table public.system_modules enable row level security;
create policy system_modules_read on public.system_modules for select to authenticated using (true);
revoke insert, update, delete, truncate on public.system_modules from anon, authenticated;

-- ---------------------------------------------------------------------------
-- E-invoicing is now governed by its module (replaces the company setting).
-- ---------------------------------------------------------------------------
create or replace function public.einvoice_enqueue(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.company_settings;
begin
  if not public.module_enabled('einvoicing') then
    update public.customer_invoices set einvoice_status = 'not_enabled' where id = p_invoice_id;
    return;
  end if;
  select * into s from public.company_settings;
  insert into public.einvoice_transmissions(invoice_id, provider) values (p_invoice_id, s.einvoice_provider);
  update public.customer_invoices set einvoice_status = 'queued', einvoice_updated_at = now(), einvoice_message = null where id = p_invoice_id;
end $$;
revoke execute on function public.einvoice_enqueue(uuid) from public, anon, authenticated;

create or replace function public.retry_einvoice(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.require_permission('invoice.post');
  perform public.require_module('einvoicing');
  if not exists (select 1 from public.customer_invoices where id = p_invoice_id and status not in ('void', 'draft') and einvoice_status in ('failed', 'rejected', 'not_enabled')) then
    perform public.raise_business_error('invalid_state', 'Only failed, rejected or unsent posted invoices can be sent again.');
  end if;
  perform public.einvoice_enqueue(p_invoice_id);
end $$;

alter table public.company_settings drop column einvoicing_enabled;
