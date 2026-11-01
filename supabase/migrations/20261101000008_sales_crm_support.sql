-- =============================================================================
-- 0008 Sales & CRM — support functions for the screens, and tightening of
-- helpers that would otherwise reveal costs or credit data.
-- =============================================================================

-- These helpers expose purchase cost, margins or credit positions without
-- their own permission checks: internal use only.
revoke execute on function public.default_unit_cost(uuid, public.fulfilment_mode, numeric) from public, anon, authenticated;
revoke execute on function public.evaluate_quotation_rules(uuid) from public, anon, authenticated;
revoke execute on function public.customer_credit_position(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Defaults for a quotation line: price in the quotation currency, stock
-- availability, suggested fulfilment, and cost only for quotation.view_cost.
-- ---------------------------------------------------------------------------
create or replace function public.quote_line_defaults(p_product_id uuid, p_currency char(3), p_rate numeric default null)
returns table (product_id uuid, sku text, name text, description text, uom_code text, item_type public.item_type,
               unit_price numeric, tax_code_id uuid, available_qty numeric, unit_cost numeric, cost_source text)
language plpgsql stable security definer set search_path = public as $$
declare
  p public.products;
  v_rate numeric := coalesce(p_rate, public.rate_to_base(p_currency));
  v_prod_rate numeric;
  v_cost record;
  v_avail numeric;
begin
  perform public.require_permission('quotation.create');
  select * into p from public.products pr where pr.id = p_product_id and pr.is_active;
  if not found then perform public.raise_business_error('not_found', 'Product not found or inactive.'); end if;
  if v_rate is null or v_rate <= 0 then
    perform public.raise_business_error('validation', format('No exchange rate for %s.', p_currency));
  end if;
  v_prod_rate := public.rate_to_base(p.currency_code);
  select coalesce(sum(qty_available), 0) into v_avail from public.stock_levels where stock_levels.product_id = p.id;
  select * into v_cost from public.default_unit_cost(p.id,
    case when p.item_type = 'stock' and v_avail > 0 then 'stock' else 'procure' end::public.fulfilment_mode, v_rate);

  return query select p.id, p.sku, p.name, coalesce(p.description, p.name), u.code, p.item_type,
    case when v_prod_rate is null then null else round(p.default_sell_price * v_prod_rate / v_rate, 2) end,
    p.tax_code_id,
    case when p.item_type = 'stock' then v_avail end,
    case when public.has_permission('quotation.view_cost') then v_cost.unit_cost end,
    case when public.has_permission('quotation.view_cost') then v_cost.cost_source end
  from public.units_of_measure u where u.id = p.uom_id;
end $$;

-- ---------------------------------------------------------------------------
-- Credit summary for a customer the caller is allowed to see.
-- ---------------------------------------------------------------------------
create or replace function public.customer_credit_summary(p_customer_id uuid,
  out credit_limit numeric, out open_orders numeric, out available numeric, out open_quotes numeric,
  out orders_ytd numeric, out last_order_date date)
language plpgsql stable security definer set search_path = public as $$
declare c public.customers;
begin
  select * into c from public.customers where id = p_customer_id;
  if not found or not (public.has_permission('customer.view')
     and public.can_view_owned(c.account_manager_id, 'customer.view_all')) then
    perform public.raise_business_error('forbidden', 'Customer not found.');
  end if;
  select pos.credit_limit, pos.open_orders_base, pos.available
    into credit_limit, open_orders, available
    from public.customer_credit_position(p_customer_id) pos;
  select coalesce(sum(total_base), 0) into open_quotes from public.quotations
   where customer_id = p_customer_id and status in ('draft', 'pending_approval', 'approved', 'sent', 'accepted');
  select coalesce(sum(total_base), 0), max(order_date) into orders_ytd, last_order_date from public.sales_orders
   where customer_id = p_customer_id and status not in ('draft', 'cancelled', 'pending_approval')
     and order_date >= date_trunc('year', current_date);
end $$;

-- ---------------------------------------------------------------------------
-- Reopen a closed enquiry (won/lost) for further work.
-- ---------------------------------------------------------------------------
create or replace function public.reopen_lead(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v public.leads;
begin
  perform public.require_permission('lead.edit');
  select * into v from public.leads where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Enquiry not found.'); end if;
  if not public.can_view_owned(v.owner_id, 'lead.view_all') then
    perform public.raise_business_error('forbidden', 'You can only reopen your own enquiries.');
  end if;
  if v.stage not in ('won', 'lost') then
    perform public.raise_business_error('invalid_state', 'Only closed enquiries can be reopened.');
  end if;
  update public.leads set stage = case when exists (select 1 from public.quotations where lead_id = p_id) then 'quoted' else 'qualified' end::public.lead_stage,
         lost_reason = null, won_at = null, probability = 50
   where id = p_id;
end $$;
