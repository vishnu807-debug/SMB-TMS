-- =============================================================================
-- 0006 Sales dashboard — one call returns every figure the dashboard needs,
-- scoped to the caller (own records unless they hold the view_all permissions).
-- All money is in base currency (AED).
-- =============================================================================
create or replace function public.sales_dashboard(p_from date, p_to date, p_rep uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_all_q   boolean := public.has_permission('quotation.view_all');
  v_all_so  boolean := public.has_permission('sales_order.view_all');
  v_all_l   boolean := public.has_permission('lead.view_all');
  v_cost    boolean := public.has_permission('sales_order.view_cost');
  v_rep     uuid;
  v_result  jsonb;
begin
  perform public.require_permission('dashboard.sales');
  if p_from is null or p_to is null or p_to < p_from then
    perform public.raise_business_error('validation', 'Invalid date range.');
  end if;
  -- A rep filter is honoured only for users who can see everyone's figures.
  v_rep := case when v_all_so and v_all_q then p_rep else auth.uid() end;

  with
  q as (
    select * from public.quotations
    where (v_rep is null or sales_rep_id = v_rep)
      and status <> 'superseded'
  ),
  so as (
    select * from public.sales_orders
    where (v_rep is null or sales_rep_id = v_rep)
  ),
  so_period as (
    select * from so where order_date between p_from and p_to
      and status not in ('draft', 'cancelled', 'pending_approval')
  ),
  margins as (
    select so_period.id, m.gross_profit_base
    from so_period cross join lateral public.sales_order_margin(so_period.id) m
    where v_cost
  )
  select jsonb_build_object(
    'scope', case when v_rep is null then 'all' else 'own' end,
    'can_view_cost', v_cost,
    'kpis', jsonb_build_object(
      'sales_value', (select coalesce(sum(total_base), 0) from so_period),
      'net_sales_value', (select coalesce(sum(round(net_total * exchange_rate, 2)), 0) from so_period),
      'orders_count', (select count(*) from so_period),
      'gross_profit', case when v_cost then (select coalesce(sum(gross_profit_base), 0) from margins) end,
      'gross_margin_pct', case when v_cost then
         (select case when sum(round(net_total * exchange_rate, 2)) > 0
                      then round((select coalesce(sum(gross_profit_base), 0) from margins)
                                 / sum(round(net_total * exchange_rate, 2)) * 100, 1) end from so_period) end,
      'quotes_count', (select count(*) from q where quotation_date between p_from and p_to),
      'quotes_value', (select coalesce(sum(total_base), 0) from q where quotation_date between p_from and p_to),
      'quote_win_rate', (select case when count(*) filter (where status in ('converted', 'accepted', 'lost', 'expired')) > 0
                              then round(count(*) filter (where status in ('converted', 'accepted'))::numeric
                                         / count(*) filter (where status in ('converted', 'accepted', 'lost', 'expired')) * 100, 1) end
                         from q where quotation_date between p_from and p_to),
      'open_quotes_value', (select coalesce(sum(total_base), 0) from q where status in ('draft', 'pending_approval', 'approved', 'sent', 'accepted')),
      'open_orders_count', (select count(*) from so where status in ('confirmed', 'partially_fulfilled', 'on_hold', 'pending_approval')),
      'open_orders_value', (select coalesce(sum(total_base), 0) from so where status in ('confirmed', 'partially_fulfilled', 'on_hold', 'pending_approval')),
      'pipeline_value', (select coalesce(sum(round(coalesce(estimated_value, 0) * public.rate_to_base(currency_code), 2)), 0)
                           from public.leads where stage in ('new', 'contacted', 'qualified', 'quoted')
                            and (case when v_all_l then (v_rep is null or owner_id = v_rep) else owner_id = auth.uid() end)),
      'weighted_pipeline', (select coalesce(sum(round(coalesce(estimated_value, 0) * public.rate_to_base(currency_code) * probability / 100, 2)), 0)
                           from public.leads where stage in ('new', 'contacted', 'qualified', 'quoted')
                            and (case when v_all_l then (v_rep is null or owner_id = v_rep) else owner_id = auth.uid() end)),
      'overdue_followups', (select count(*) from public.activities
                             where completed_at is null and due_at < now()
                               and (case when public.has_permission('activity.view_all') then (v_rep is null or owner_id = v_rep) else owner_id = auth.uid() end)),
      'due_today_followups', (select count(*) from public.activities
                             where completed_at is null and due_at::date = current_date and due_at >= now()
                               and (case when public.has_permission('activity.view_all') then (v_rep is null or owner_id = v_rep) else owner_id = auth.uid() end)),
      'pending_approvals', (select count(*) from public.approval_requests a where a.status = 'pending' and public.has_permission(a.approver_permission))
    ),
    'monthly_sales', (
      select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'label', to_char(m, 'Mon YY'),
                                                   'sales', coalesce(s.v, 0), 'orders', coalesce(s.n, 0)) order by m), '[]')
      from generate_series(date_trunc('month', p_to) - interval '11 months', date_trunc('month', p_to), interval '1 month') m
      left join (select date_trunc('month', order_date) mo, sum(total_base) v, count(*) n from so
                  where status not in ('draft', 'cancelled', 'pending_approval') group by 1) s on s.mo = m
    ),
    'quotes_by_status', (
      select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', n, 'value', v) order by n desc), '[]')
      from (select status, count(*) n, sum(total_base) v from q where quotation_date between p_from and p_to group by status) x
    ),
    'leads_by_stage', (
      select coalesce(jsonb_agg(jsonb_build_object('stage', stage, 'count', n, 'value', v) order by stage), '[]')
      from (select stage, count(*) n, sum(round(coalesce(estimated_value, 0) * public.rate_to_base(currency_code), 2)) v
              from public.leads
             where (case when v_all_l then (v_rep is null or owner_id = v_rep) else owner_id = auth.uid() end)
               and (stage not in ('won', 'lost') or updated_at::date between p_from and p_to)
             group by stage) x
    ),
    'top_customers', (
      select coalesce(jsonb_agg(jsonb_build_object('customer_id', id, 'name', name, 'code', code, 'value', v, 'orders', n) order by v desc), '[]')
      from (select c.id, c.name, c.code, sum(s.total_base) v, count(*) n
              from so_period s join public.customers c on c.id = s.customer_id
             group by c.id order by v desc limit 8) x
    ),
    'by_rep', case when v_rep is null then (
      select coalesce(jsonb_agg(jsonb_build_object('rep_id', id, 'name', full_name, 'sales', sales, 'orders', orders,
                                                   'quotes', quotes) order by sales desc), '[]')
      from (select p.id, p.full_name,
                   coalesce((select sum(total_base) from so_period where sales_rep_id = p.id), 0) sales,
                   coalesce((select count(*) from so_period where sales_rep_id = p.id), 0) orders,
                   coalesce((select count(*) from q where sales_rep_id = p.id and quotation_date between p_from and p_to), 0) quotes
              from public.profiles p
             where p.is_active and (exists (select 1 from so_period where sales_rep_id = p.id)
                                    or exists (select 1 from q where sales_rep_id = p.id and quotation_date between p_from and p_to))) x
    ) end
  ) into v_result;
  return v_result;
end $$;
