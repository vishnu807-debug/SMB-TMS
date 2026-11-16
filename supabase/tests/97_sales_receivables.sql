-- Pending payments on the sales dashboard (after 10–95; 60_finance posts invoices).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
reset role;

-- Expected figures, computed directly.
create temp table exp as
select c.account_manager_id, i.customer_id, round(i.balance * i.exchange_rate, 2) bal, i.due_date
from public.customer_invoices i join public.customers c on c.id = i.customer_id
where i.kind = 'invoice' and i.status in ('posted', 'partially_paid') and i.balance > 0;
grant select on exp to authenticated;
select assert_eq((select count(*) from exp)::int > 0, true, 'fixture has unpaid invoices');
-- Make one overdue for the aging check.
select set_config('smp.allow_locked_edit', 'on', false);
update public.customer_invoices set invoice_date = current_date - 75, due_date = current_date - 45
 where id = (select id from public.customer_invoices where kind = 'invoice' and status in ('posted', 'partially_paid') and balance > 0 limit 1);
update exp set due_date = current_date - 45 where customer_id = (select customer_id from public.customer_invoices where due_date = current_date - 45 limit 1)
  and bal = (select round(balance * exchange_rate, 2) from public.customer_invoices where due_date = current_date - 45 limit 1);

select set_config('smp.allow_locked_edit', 'off', false);

-- Sales manager: whole team.
select test_as('salesmgr@smp.test');
select assert_eq((public.sales_receivables()->>'outstanding')::numeric, (select sum(bal) from exp), 'team outstanding');
select assert_eq((public.sales_receivables()->>'customers')::int, (select count(distinct customer_id) from exp)::int, 'team customer count');
select assert_eq((public.sales_receivables()->>'overdue')::numeric >= (select coalesce(sum(bal), 0) from exp where due_date < current_date - 30), true, 'overdue counted');
select assert_eq((public.sales_receivables()->'aging'->>'31-60')::numeric > 0, true, 'aging bucket');
select assert_eq(jsonb_array_length(public.sales_receivables()->'top') > 0, true, 'top customers');

-- Sales executive: only the customers they manage, even if they ask for another rep.
select test_as('sales@smp.test');
select assert_eq(coalesce((public.sales_receivables((select id from public.profiles where email = 'salesmgr@smp.test'))->>'outstanding')::numeric, 0),
                 coalesce((select sum(bal) from exp where account_manager_id = auth.uid()), 0), 'own customers only');
-- Matches what the executive can open (invoices of their own customers).
select assert_eq((public.sales_receivables()->>'invoices')::int,
                 (select count(*) from public.customer_invoices i where i.kind = 'invoice' and i.status in ('posted', 'partially_paid') and i.balance > 0
                    and exists (select 1 from public.customers c where c.id = i.customer_id and c.account_manager_id = auth.uid()))::int, 'invoice count');

-- Users without the sales dashboard are refused; finance off returns null.
select test_as('logi@smp.test');
select expect_error($$select public.sales_receivables()$$, 'permission');
select public.test_backend();
select public.set_module_enabled('einvoicing', false);
select public.set_module_enabled('finance', false);
select test_as('salesmgr@smp.test');
select assert_eq(public.sales_receivables() is null, true, 'finance module off');
select public.test_backend();
select public.set_module_enabled('finance', true);
select 'ALL RECEIVABLES TESTS PASSED' as result;
