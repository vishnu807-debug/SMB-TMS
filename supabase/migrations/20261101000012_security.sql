-- =============================================================================
-- 0005 Row Level Security & grants.
-- Rule of thumb: clients may READ what RLS allows; business records are
-- WRITTEN only through the security-definer functions in 0004.
-- =============================================================================

-- Enable RLS on every table in public.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Function-managed tables: no direct writes from the API.
revoke insert, update, delete, truncate on
  public.customers, public.customer_contacts, public.customer_addresses,
  public.leads, public.lead_items,
  public.quotations, public.quotation_lines, public.quotation_line_costs,
  public.sales_orders, public.sales_order_lines, public.sales_order_line_costs,
  public.approval_requests, public.products, public.stock_levels, public.stock_movements, public.stock_reservations,
  public.purchase_requisitions, public.purchase_requisition_lines,
  public.audit_log, public.document_sequences, public.document_sequence_templates
from anon, authenticated;
revoke all on all tables in schema public from anon;
revoke all on public.document_sequences, public.document_sequence_templates from authenticated;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.has_permission('user.manage'))
  with check (id = auth.uid() or public.has_permission('user.manage'));

-- Users may not elevate themselves: only user.manage can change is_active / department.
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('user.manage')
     and (new.is_active is distinct from old.is_active or new.email is distinct from old.email
          or new.department_id is distinct from old.department_id) then
    raise exception using errcode = 'P0001', hint = 'forbidden', message = 'Only administrators can change this field.';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

create policy departments_read on public.departments for select to authenticated using (true);
create policy departments_write on public.departments for all to authenticated
  using (public.has_permission('user.manage')) with check (public.has_permission('user.manage'));
create policy roles_read on public.roles for select to authenticated using (true);
create policy permissions_read on public.permissions for select to authenticated using (true);
create policy role_permissions_read on public.role_permissions for select to authenticated using (true);
create policy role_permissions_write on public.role_permissions for all to authenticated
  using (public.has_permission('user.manage')) with check (public.has_permission('user.manage'));
create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_permission('user.manage'));
create policy user_roles_write on public.user_roles for insert to authenticated
  with check (public.has_permission('user.manage')
              and (not exists (select 1 from public.roles where id = role_id and code = 'super_admin')
                   or exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                              where ur.user_id = auth.uid() and r.code = 'super_admin')));
create policy user_roles_delete on public.user_roles for delete to authenticated
  using (public.has_permission('user.manage') and user_id <> auth.uid());

-- ---------------------------------------------------------------------------
-- Reference data & settings: everyone reads, settings.manage writes.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['currencies','exchange_rates','tax_codes','payment_terms','delivery_terms',
                           'units_of_measure','company_settings','approval_rules'] loop
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.has_permission(''settings.manage'')) with check (public.has_permission(''settings.manage''))', t || '_write', t);
  end loop;
end $$;

create policy warehouses_read on public.warehouses for select to authenticated using (true);
create policy warehouses_write on public.warehouses for all to authenticated
  using (public.has_permission('warehouse.manage')) with check (public.has_permission('warehouse.manage'));

create policy audit_read on public.audit_log for select to authenticated using (public.has_permission('audit.view'));

create policy notifications_own on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, delete on public.notifications from authenticated;

-- ---------------------------------------------------------------------------
-- Customers — sales reps see their own; view_all sees everyone's.
-- ---------------------------------------------------------------------------
create policy customers_read on public.customers for select to authenticated
  using (public.has_permission('customer.view') and public.can_view_owned(account_manager_id, 'customer.view_all'));
create policy customer_contacts_read on public.customer_contacts for select to authenticated
  using (exists (select 1 from public.customers c where c.id = customer_id));
create policy customer_addresses_read on public.customer_addresses for select to authenticated
  using (exists (select 1 from public.customers c where c.id = customer_id));

-- ---------------------------------------------------------------------------
-- Suppliers, products, stock
-- ---------------------------------------------------------------------------
create policy suppliers_read on public.suppliers for select to authenticated using (public.has_permission('supplier.view'));
create policy suppliers_write on public.suppliers for all to authenticated
  using (public.has_permission('supplier.edit')) with check (public.has_permission('supplier.edit'));

create policy categories_read on public.product_categories for select to authenticated using (true);
create policy categories_write on public.product_categories for all to authenticated
  using (public.has_permission('category.manage')) with check (public.has_permission('category.manage'));
create policy brands_read on public.brands for select to authenticated using (true);
create policy brands_write on public.brands for all to authenticated
  using (public.has_permission('product.edit')) with check (public.has_permission('product.edit'));
create policy products_read on public.products for select to authenticated using (public.has_permission('product.view'));
-- Products are written only through save_product() / set_product_active() (0005).
-- Supplier pricing is cost information.
create policy supplier_products_read on public.supplier_products for select to authenticated
  using (public.has_permission('product.view_cost'));
create policy supplier_products_write on public.supplier_products for all to authenticated
  using (public.has_permission('product.edit') and public.has_permission('product.view_cost'))
  with check (public.has_permission('product.edit') and public.has_permission('product.view_cost'));

-- stock_levels carries avg_cost → restricted. Availability (no cost) is
-- exposed through v_product_stock below.
create policy stock_levels_read on public.stock_levels for select to authenticated
  using (public.has_permission('inventory.view') and public.has_permission('inventory.view_valuation'));
-- Raw movements carry costs; the cost-free history is public.v_stock_movements (0005).
create policy stock_movements_read on public.stock_movements for select to authenticated
  using (public.has_permission('inventory.view') and public.has_permission('inventory.view_valuation'));

-- Quantity-only availability for anyone allowed to see products (sales need this
-- while quoting). Deliberately not security_invoker; filtered explicitly.
create or replace view public.v_product_stock as
select p.id as product_id,
       coalesce(sum(sl.qty_on_hand), 0)   as qty_on_hand,
       coalesce(sum(sl.qty_reserved), 0)  as qty_reserved,
       coalesce(sum(sl.qty_available), 0) as qty_available
from public.products p
left join public.stock_levels sl on sl.product_id = p.id
where public.has_permission('product.view')
group by p.id;
revoke all on public.v_product_stock from anon;
grant select on public.v_product_stock to authenticated;

-- ---------------------------------------------------------------------------
-- Leads & activities
-- ---------------------------------------------------------------------------
create policy leads_read on public.leads for select to authenticated
  using (public.has_permission('lead.view') and public.can_view_owned(owner_id, 'lead.view_all'));
create policy lead_items_read on public.lead_items for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_id));

create policy activities_read on public.activities for select to authenticated
  using (owner_id = auth.uid() or public.has_permission('activity.view_all')
         or (lead_id is not null and exists (select 1 from public.leads l where l.id = lead_id))
         or (customer_id is not null and exists (select 1 from public.customers c where c.id = customer_id))
         or (quotation_id is not null and exists (select 1 from public.quotations q where q.id = quotation_id))
         or (sales_order_id is not null and exists (select 1 from public.sales_orders s where s.id = sales_order_id)));
create policy activities_insert on public.activities for insert to authenticated
  with check (public.has_permission('activity.manage')
              and (owner_id = auth.uid() or public.has_permission('activity.view_all'))
              and (lead_id is null or exists (select 1 from public.leads l where l.id = lead_id))
              and (customer_id is null or exists (select 1 from public.customers c where c.id = customer_id))
              and (quotation_id is null or exists (select 1 from public.quotations q where q.id = quotation_id))
              and (sales_order_id is null or exists (select 1 from public.sales_orders s where s.id = sales_order_id)));
create policy activities_update on public.activities for update to authenticated
  using (public.has_permission('activity.manage') and (owner_id = auth.uid() or public.has_permission('activity.view_all')))
  with check (public.has_permission('activity.manage') and (owner_id = auth.uid() or public.has_permission('activity.view_all')));
create policy activities_delete on public.activities for delete to authenticated
  using (owner_id = auth.uid() and completed_at is null);

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------
create policy approval_requests_read on public.approval_requests for select to authenticated
  using (requested_by = auth.uid() or public.has_permission(approver_permission) or public.has_permission('approval.view'));

-- ---------------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------------
create policy quotations_read on public.quotations for select to authenticated
  using (public.has_permission('quotation.view') and public.can_view_owned(sales_rep_id, 'quotation.view_all'));
create policy quotation_lines_read on public.quotation_lines for select to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id));
create policy quotation_line_costs_read on public.quotation_line_costs for select to authenticated
  using (public.has_permission('quotation.view_cost') and exists (select 1 from public.quotations q where q.id = quotation_id));

-- ---------------------------------------------------------------------------
-- Sales orders, reservations, requisitions
-- ---------------------------------------------------------------------------
create policy sales_orders_read on public.sales_orders for select to authenticated
  using (public.has_permission('sales_order.view') and public.can_view_owned(sales_rep_id, 'sales_order.view_all'));
create policy sales_order_lines_read on public.sales_order_lines for select to authenticated
  using (exists (select 1 from public.sales_orders s where s.id = sales_order_id));
create policy sales_order_line_costs_read on public.sales_order_line_costs for select to authenticated
  using (public.has_permission('sales_order.view_cost') and exists (select 1 from public.sales_orders s where s.id = sales_order_id));
create policy stock_reservations_read on public.stock_reservations for select to authenticated
  using (public.has_permission('inventory.view')
         or exists (select 1 from public.sales_order_lines l where l.id = sales_order_line_id));
create policy purchase_requisitions_read on public.purchase_requisitions for select to authenticated
  using (public.has_permission('purchase_requisition.manage')
         or (sales_order_id is not null and exists (select 1 from public.sales_orders s where s.id = sales_order_id)));
create policy purchase_requisition_lines_read on public.purchase_requisition_lines for select to authenticated
  using (exists (select 1 from public.purchase_requisitions r where r.id = requisition_id));

-- ---------------------------------------------------------------------------
-- Function execution: business functions are callable by signed-in users
-- (each checks its own permission); nothing is callable anonymously.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from anon;
