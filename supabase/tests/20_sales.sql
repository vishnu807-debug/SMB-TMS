-- =============================================================================
-- Sales & CRM — behaviour tests. Runs after 10_products_inventory.sql
-- (reuses its helpers, users, products and stock).
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
reset role;

insert into auth.users (email, raw_user_meta_data) values
  ('sales2@smp.test', '{"full_name":"Second Sales Executive"}'),
  ('acct@smp.test',   '{"full_name":"Accounts Manager"}');
insert into public.user_roles (user_id, role_id)
select p.id, r.id from public.profiles p join public.roles r on r.code = case p.email
  when 'sales2@smp.test' then 'sales_executive' when 'acct@smp.test' then 'accounts_manager' end
where p.email in ('sales2@smp.test', 'acct@smp.test');

-- =============================================================================
-- 1. Customer master
-- =============================================================================
select test_as('sales@smp.test');
do $$
declare v uuid; v_c record;
begin
  v := public.save_customer(jsonb_build_object(
    'name', 'Emirates Building Systems LLC', 'customer_type', 'company', 'trn', '100123456700003',
    'trade_license_no', 'DED-778812', 'email', 'purchasing@ebs.ae', 'phone', '+971 4 555 0101',
    'currency_code', 'AED', 'payment_term_id', (select id from public.payment_terms where name = 'Net 30'),
    'delivery_term_id', (select id from public.delivery_terms where code = 'LOCAL'),
    'contacts', jsonb_build_array(
      jsonb_build_object('name', 'Rashid Al Marri', 'designation', 'Procurement Manager', 'email', 'rashid@ebs.ae', 'is_primary', true),
      jsonb_build_object('name', 'Priya Nair', 'designation', 'Site Engineer', 'mobile', '+971 50 111 2222')),
    'addresses', jsonb_build_array(
      jsonb_build_object('kind', 'billing', 'line1', 'Office 1204, Al Quoz Tower', 'city', 'Dubai', 'emirate', 'Dubai', 'is_default', true),
      jsonb_build_object('kind', 'shipping', 'label', 'Site A', 'line1', 'Plot 55, DIP 2', 'city', 'Dubai', 'is_default', true))));
  select * into v_c from public.customers where id = v;
  perform assert_eq(v_c.code ~ '^CUS-\d{5}$', true, 'customer code generated');
  perform assert_eq(v_c.vat_registered, true, 'TRN implies VAT registered');
  perform assert_eq(v_c.account_manager_id, auth.uid(), 'creator is sales rep');
  perform assert_eq((select count(*) from public.customer_contacts where customer_id = v)::int, 2, 'contacts saved');
  perform assert_eq((select count(*) from public.customer_addresses where customer_id = v)::int, 2, 'addresses saved');
  perform set_config('test.ebs', v::text, false);
end $$;
-- Duplicates: same TRN blocked; similar name reported.
select expect_error($$select public.save_customer('{"name":"Another Co","trn":"100123456700003"}'::jsonb)$$, 'already has this TRN');
select assert_eq((select count(*) from public.find_customer_duplicates('Emirates Building Systems L.L.C.'))::int, 1, 'similar name found');
select expect_error($$select public.save_customer('{"name":"Bad TRN Co","trn":"12345"}'::jsonb)$$, '15 digits');
-- Sales exec cannot set credit limits or assign to someone else.
select expect_error(format($$select public.save_customer(jsonb_build_object('id', %L, 'name', 'Emirates Building Systems LLC', 'credit_limit', 50000))$$,
                    current_setting('test.ebs')), 'credit limit');
select expect_error($$select public.save_customer(jsonb_build_object('name', 'Assign Test LLC',
                     'account_manager_id', (select id from public.profiles where email = 'sales2@smp.test')))$$, 'cannot assign');
-- Another sales exec cannot see this customer at all.
select test_as('sales2@smp.test');
select assert_eq((select count(*) from public.customers where id = current_setting('test.ebs')::uuid)::int, 0, 'other rep cannot see customer');
select expect_error(format($$select * from public.customer_credit_summary(%L)$$, current_setting('test.ebs')), 'not found');
-- Accounts manager sets the credit limit.
select test_as('acct@smp.test');
select public.save_customer((select jsonb_build_object('id', id, 'name', name, 'trn', trn, 'credit_limit', 10000,
  'account_manager_id', account_manager_id, 'payment_term_id', payment_term_id, 'currency_code', currency_code,
  'contacts', (select jsonb_agg(to_jsonb(c)) from public.customer_contacts c where c.customer_id = customers.id),
  'addresses', (select jsonb_agg(to_jsonb(a)) from public.customer_addresses a where a.customer_id = customers.id))
  from public.customers where id = current_setting('test.ebs')::uuid));
select assert_eq((select credit_limit from public.customers where id = current_setting('test.ebs')::uuid), 10000.00, 'credit limit set');
select assert_eq((select count(*) from public.customer_contacts where customer_id = current_setting('test.ebs')::uuid)::int, 2, 'contacts kept on edit');

-- =============================================================================
-- 2. Enquiries & follow-ups
-- =============================================================================
select test_as('sales@smp.test');
do $$
declare v uuid; v_act uuid;
begin
  v := public.save_lead(jsonb_build_object(
    'title', 'Cabling for warehouse fit-out', 'source', 'phone', 'company_name', 'Falcon Logistics FZE',
    'contact_name', 'Omar Haddad', 'contact_email', 'omar@falconlog.ae', 'requirement', 'Power and data cabling, 3 halls',
    'estimated_value', 45000, 'probability', 40, 'expected_close_date', (current_date + 30)::text, 'priority', 'high',
    'items', jsonb_build_array(
      jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'description', 'Power cable 4C x 16', 'qty', 300),
      jsonb_build_object('description', 'Cat6 cable', 'qty', 12, 'target_price', 280))));
  perform assert_eq((select doc_no ~ '^ENQ-\d{4}-\d{5}$' from public.leads where id = v), true, 'enquiry number');
  perform assert_eq((select count(*) from public.lead_items where lead_id = v)::int, 2, 'requirement lines');
  insert into public.activities (activity_type, subject, due_at, owner_id, lead_id)
  values ('follow_up', 'Call Omar re site visit', now() - interval '1 hour', auth.uid(), v) returning id into v_act;
  perform public.complete_activity(v_act, 'Site visit booked for Tuesday');
  perform assert_eq((select completed_at is not null from public.activities where id = v_act), true, 'follow-up completed');
  perform expect_error(format('select public.set_lead_stage(%L, ''lost'')', v), 'reason');
  perform set_config('test.lead', v::text, false);
end $$;
-- A follow-up must have a due date; a sales exec cannot log activities for someone else.
select expect_error(format($$insert into public.activities (activity_type, subject, owner_id, lead_id) values ('follow_up', 'x', auth.uid(), %L)$$,
                    current_setting('test.lead')), 'activities_followup_due');
select expect_error(format($$insert into public.activities (activity_type, subject, due_at, owner_id, lead_id)
                    values ('call', 'x', now(), (select id from public.profiles where email = 'sales2@smp.test'), %L)$$,
                    current_setting('test.lead')), 'row-level security');
-- Convert the enquiry's company into a customer.
select public.convert_lead_to_customer(current_setting('test.lead')::uuid);
select assert_eq((select l.stage::text || '/' || c.name from public.leads l join public.customers c on c.id = l.customer_id
                   where l.id = current_setting('test.lead')::uuid), 'qualified/Falcon Logistics FZE', 'lead converted');
select assert_eq((select count(*) from public.customer_contacts cc join public.leads l on l.customer_id = cc.customer_id
                   where l.id = current_setting('test.lead')::uuid and cc.is_primary)::int, 1, 'contact copied');

-- =============================================================================
-- 3. Quotations: approval, margin, revision, conversion
-- =============================================================================
do $$
declare v_q uuid; v_status public.quotation_status; v_cust uuid;
begin
  select customer_id into v_cust from public.leads where id = current_setting('test.lead')::uuid;
  v_q := public.save_quotation(jsonb_build_object(
    'customer_id', v_cust, 'lead_id', current_setting('test.lead'), 'subject', 'Warehouse cabling',
    'delivery_time', '2 weeks from PO', 'valid_until', (current_date + 14)::text,
    'lines', jsonb_build_array(
      jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 100, 'unit_price', 52, 'discount_pct', 15),
      jsonb_build_object('product_id', (select id from public.products where sku = 'ITM-000001'), 'qty', 2, 'unit_price', 295,
                         'fulfilment_mode', 'procure', 'unit_cost', 1))));   -- exec's cost is ignored
  -- 100 × 52 = 5,200 − 15% = 4,420; 2 × 295 = 590 → net 5,010; VAT 5% = 250.50 → 5,260.50
  perform assert_eq((select net_total from public.quotations where id = v_q), 5010.00, 'net total');
  perform assert_eq((select tax_total from public.quotations where id = v_q), 250.50, 'VAT');
  perform assert_eq((select total from public.quotations where id = v_q), 5260.50, 'grand total');
  perform assert_eq((select stage::text from public.leads where id = current_setting('test.lead')::uuid), 'quoted', 'lead → quoted');
  perform assert_eq((select count(*) from public.quotation_margin(v_q))::int, 0, 'exec cannot see margin');
  perform assert_eq((select count(*) from public.quotation_line_costs where quotation_id = v_q)::int, 0, 'exec cannot read costs');
  v_status := public.submit_quotation(v_q);
  perform assert_eq(v_status::text, 'pending_approval', 'discount 15% needs approval');
  perform expect_error(format('select public.save_quotation(jsonb_build_object(''id'', %L))', v_q), 'Only draft');
  perform expect_error(format('select public.convert_quotation_to_order(%L)', v_q), 'Only approved');
  perform set_config('test.q', v_q::text, false);
end $$;
select expect_error($$select public.decide_approval((select id from public.approval_requests where doc_id = current_setting('test.q')::uuid and status = 'pending'), true)$$,
                    'do not have permission');

select test_as('salesmgr@smp.test');
do $$
declare m record;
begin
  select * into m from public.quotation_margin(current_setting('test.q')::uuid);
  -- Cost: 100 × 40.00 (stock avg) + 2 × system default (the exec's "1" was ignored) → margin well above 15%
  perform assert_eq(m.total_cost > 4000, true, 'manager sees cost');
  perform assert_eq(m.gross_margin_pct between 0 and 100, true, 'margin %');
  perform assert_eq((select min(unit_cost) > 1 from public.quotation_line_costs where quotation_id = current_setting('test.q')::uuid), true,
                    'exec-entered cost ignored');
  perform public.decide_approval((select id from public.approval_requests where doc_id = current_setting('test.q')::uuid and status = 'pending'),
                                 true, 'Volume deal, OK');
  perform assert_eq((select status::text from public.quotations where id = current_setting('test.q')::uuid), 'approved', 'approved');
end $$;
-- Quote line defaults: price converted, cost only for managers.
select assert_eq((select unit_cost is not null from public.quote_line_defaults((select id from public.products where sku = 'CBL-4C-16'), 'AED')), true, 'manager gets default cost');
select test_as('sales@smp.test');
select assert_eq((select unit_cost from public.quote_line_defaults((select id from public.products where sku = 'CBL-4C-16'), 'AED')), null::numeric, 'exec gets no cost');
select assert_eq((select unit_price from public.quote_line_defaults((select id from public.products where sku = 'HLM-3M-H700'), 'AED')), round(14 * 3.6725, 2), 'USD price converted');

-- Sent → customer asks for changes → revision R1 (old one superseded).
select public.set_quotation_status(current_setting('test.q')::uuid, 'sent');
do $$
declare v_r1 uuid;
begin
  v_r1 := public.revise_quotation(current_setting('test.q')::uuid);
  perform assert_eq((select doc_no from public.quotations where id = v_r1), (select base_doc_no || '-R1' from public.quotations where id = v_r1), 'revision number');
  perform assert_eq((select status::text from public.quotations where id = current_setting('test.q')::uuid), 'superseded', 'old revision superseded');
  perform assert_eq((select count(*) from public.quotation_lines where quotation_id = v_r1)::int, 2, 'lines copied');
  -- Customer agreed at 8% discount → no approval needed. Price also changes, so new totals.
  perform public.save_quotation((select jsonb_build_object('id', q.id, 'customer_id', q.customer_id, 'lead_id', q.lead_id,
      'valid_until', (current_date + 14)::text, 'lines', jsonb_build_array(
        jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 300, 'unit_price', 52, 'discount_pct', 8),
        jsonb_build_object('product_id', (select id from public.products where sku = 'ITM-000001'), 'qty', 12, 'unit_price', 280, 'fulfilment_mode', 'procure')))
    from public.quotations q where q.id = v_r1));
  perform assert_eq(public.submit_quotation(v_r1)::text, 'approved', 'R1 approved automatically');
  perform set_config('test.q1', v_r1::text, false);
end $$;

-- =============================================================================
-- 4. Sales order: credit limit approval, confirmation, hold, cancel
-- =============================================================================
-- Falcon has no credit limit (0 = not checked). Use EBS (limit 10,000) for the credit test.
do $$
declare v_q uuid; v_so uuid;
begin
  v_q := public.save_quotation(jsonb_build_object('customer_id', current_setting('test.ebs'),
    'lines', jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 250, 'unit_price', 52))));
  perform public.submit_quotation(v_q);     -- 13,650 incl. VAT → approved (under AED 250k, no discount)
  v_so := public.convert_quotation_to_order(v_q, 'EBS-PO-1001', current_date + 10);
  perform expect_error(format('select public.convert_quotation_to_order(%L)', v_q), 'Only approved');   -- now converted
  perform assert_eq(public.confirm_sales_order(v_so)::text, 'pending_approval', 'credit limit exceeded → approval');
  perform assert_eq((select reserved_qty from public.v_product_inventory where sku = 'CBL-4C-16'), 40.000, 'nothing reserved while pending');
  perform set_config('test.so_ebs', v_so::text, false);
end $$;
select expect_error($$select public.decide_approval((select id from public.approval_requests where doc_id = current_setting('test.so_ebs')::uuid and status = 'pending'), true)$$,
                    'do not have permission');
select test_as('acct@smp.test');
select public.decide_approval((select id from public.approval_requests where doc_id = current_setting('test.so_ebs')::uuid and status = 'pending'), true, 'Customer paid previous invoices');
select assert_eq((select status::text from public.sales_orders where id = current_setting('test.so_ebs')::uuid), 'confirmed', 'confirmed after credit approval');
select assert_eq((select string_agg(fulfilment_mode || ':' || qty::int || ':' || stock_status, ',' order by line_no)
                   from public.sales_order_lines where sales_order_id = current_setting('test.so_ebs')::uuid),
                 'stock:100:reserved,procure:150:awaiting_receipt', 'free stock (100 in MAIN) reserved, 150 split to procurement');
-- Hold and release (Accounts holds sales_order.approve).
select public.set_sales_order_hold(current_setting('test.so_ebs')::uuid, true, 'Awaiting LC');
select assert_eq((select status::text from public.sales_orders where id = current_setting('test.so_ebs')::uuid), 'on_hold', 'on hold');
select public.set_sales_order_hold(current_setting('test.so_ebs')::uuid, false);
select assert_eq((select status::text from public.sales_orders where id = current_setting('test.so_ebs')::uuid), 'confirmed', 'released');

-- Convert Falcon R1, confirm, then cancel → reservations and requisitions released.
select test_as('sales@smp.test');
do $$
declare v_so uuid; v_before numeric;
begin
  v_so := public.convert_quotation_to_order(current_setting('test.q1')::uuid, 'FAL-7781');
  perform assert_eq((select stage::text from public.leads where id = current_setting('test.lead')::uuid), 'won', 'lead won on conversion');
  perform public.update_sales_order_draft(jsonb_build_object('id', v_so, 'customer_po_ref', 'FAL-7781-A', 'required_date', (current_date + 7)::text,
    'lines', jsonb_build_array(jsonb_build_object('id', (select id from public.sales_order_lines where sales_order_id = v_so and line_no = 2), 'fulfilment_mode', 'stock'))));
  perform assert_eq(public.confirm_sales_order(v_so)::text, 'confirmed', 'no credit check without a limit');
  perform assert_eq((select count(*) from public.purchase_requisitions where sales_order_id = v_so)::int, 1, 'requisition for shortfalls');
  perform expect_error(format('select public.cancel_sales_order(%L, ''x'')', v_so), 'sales_order.cancel');   -- executives cannot cancel
  perform set_config('test.so_fal', v_so::text, false);
end $$;
select test_as('salesmgr@smp.test');
do $$
declare v_so uuid := current_setting('test.so_fal')::uuid;
begin
  perform expect_error(format('select public.cancel_sales_order(%L, '''')', v_so), 'reason');
  perform public.cancel_sales_order(v_so, 'Customer postponed the project');
  perform assert_eq((select count(*) from public.stock_reservations r join public.sales_order_lines l on l.id = r.sales_order_line_id
                      where l.sales_order_id = v_so and r.status = 'active')::int, 0, 'reservations released');
  perform assert_eq((select status from public.purchase_requisitions where sales_order_id = v_so), 'cancelled', 'requisition cancelled');
end $$;

-- =============================================================================
-- 5. Dashboard scope
-- =============================================================================
select test_as('sales@smp.test');
do $$
declare d jsonb;
begin
  d := public.sales_dashboard(date_trunc('year', current_date)::date, current_date);
  perform assert_eq(d->>'scope', 'own', 'exec sees own figures');
  perform assert_eq(d->>'can_view_cost', 'false', 'exec has no cost view');
  perform assert_eq((d->'kpis'->>'gross_profit') is null, true, 'no profit figure for exec');
  perform assert_eq(jsonb_array_length(d->'monthly_sales'), 12, '12 months');
  perform assert_eq((d->'kpis'->>'quotes_count')::int >= 3, true, 'exec quotes counted');
end $$;
select test_as('salesmgr@smp.test');
do $$
declare d jsonb;
begin
  d := public.sales_dashboard(date_trunc('year', current_date)::date, current_date);
  perform assert_eq(d->>'scope', 'all', 'manager sees all');
  perform assert_eq((d->'kpis'->>'sales_value')::numeric > 0, true, 'sales value');
  perform assert_eq((d->'kpis'->>'gross_profit') is not null, true, 'manager sees profit');
  perform assert_eq(jsonb_array_length(d->'by_rep') >= 1, true, 'by rep breakdown');
  perform assert_eq(jsonb_array_length(d->'top_customers') >= 1, true, 'top customers');
end $$;

-- Ledger still consistent after all sales activity.
reset role;
select assert_eq((select count(*) from public.stock_levels sl
                   where sl.qty_reserved <> (select coalesce(sum(qty), 0) from public.stock_reservations r
                                             where r.product_id = sl.product_id and r.warehouse_id = sl.warehouse_id and r.status = 'active'))::int,
                 0, 'reserved = active reservations');
select 'ALL SALES & CRM TESTS PASSED' as result;
