-- =============================================================================
-- 0023 Pending payments on the sales dashboard
--   How much customers still owe (posted, unpaid invoices), from how many
--   customers, how much is overdue, and the customers owing the most.
--   Scope follows the sales dashboard: a sales representative sees the
--   customers they manage; managers with team-wide access see everyone (or the
--   selected representative). Sales users do not need finance permissions:
--   only these totals are returned, never the invoices themselves.
--   Returns null when the Finance module is switched off.
-- =============================================================================
create or replace function public.sales_receivables(p_rep uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_all boolean := public.has_permission('customer.view_all') and public.has_permission('sales_order.view_all');
  v_rep uuid;
  v_result jsonb;
begin
  perform public.require_permission('dashboard.sales');
  if not public.module_enabled('finance') then return null; end if;
  v_rep := case when v_all then p_rep else auth.uid() end;

  with r as (
    select i.customer_id, round(i.balance * i.exchange_rate, 2) as bal, i.due_date,
           greatest(current_date - i.due_date, 0) as days_overdue
    from public.customer_invoices i
    join public.customers c on c.id = i.customer_id
    where i.kind = 'invoice' and i.status in ('posted', 'partially_paid') and i.balance > 0
      and (v_rep is null or c.account_manager_id = v_rep)
  ),
  per_customer as (
    select customer_id, sum(bal) as balance, sum(bal) filter (where due_date < current_date) as overdue,
           count(*) as invoices, max(days_overdue) as oldest_days
    from r group by customer_id
  )
  select jsonb_build_object(
    'outstanding', coalesce((select sum(bal) from r), 0),
    'customers', (select count(*) from per_customer),
    'invoices', (select count(*) from r),
    'overdue', coalesce((select sum(bal) from r where due_date < current_date), 0),
    'overdue_customers', (select count(*) from per_customer where overdue > 0),
    'aging', jsonb_build_object(
      'current', coalesce((select sum(bal) from r where due_date is null or due_date >= current_date), 0),
      '1-30',    coalesce((select sum(bal) from r where days_overdue between 1 and 30), 0),
      '31-60',   coalesce((select sum(bal) from r where days_overdue between 31 and 60), 0),
      '61-90',   coalesce((select sum(bal) from r where days_overdue between 61 and 90), 0),
      '90+',     coalesce((select sum(bal) from r where days_overdue > 90), 0)),
    'top', (select coalesce(jsonb_agg(jsonb_build_object('customer_id', c.id, 'code', c.code, 'name', c.name,
                     'balance', p.balance, 'overdue', coalesce(p.overdue, 0), 'invoices', p.invoices, 'oldest_days', p.oldest_days)
                     order by p.balance desc), '[]')
            from (select * from per_customer order by balance desc limit 8) p join public.customers c on c.id = p.customer_id)
  ) into v_result;
  return v_result;
end $$;
revoke execute on function public.sales_receivables(uuid) from public, anon;
grant execute on function public.sales_receivables(uuid) to authenticated;
