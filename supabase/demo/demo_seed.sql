-- =============================================================================
-- DEMO DATA — for a demonstration database only. NEVER run on a client system.
-- Prerequisite: the behaviour tests (supabase/tests/10–60) have been applied,
-- which create the demo users and the first documents. Every document below is
-- created through the same database functions the app uses, acting as the
-- appropriate user, so all rules (approvals, stock, credit, VAT) apply.
-- All companies and people are fictional.
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
reset role;
select public.test_backend();
select set_config('smp.user_admin', 'on', false);

-- People and company -----------------------------------------------------------
update public.profiles p set full_name = v.n, job_title = v.t from (values
  ('admin@smp.test', 'Vishnu C.', 'System Administrator'), ('md@smp.test', 'Khalid Al Mansoori', 'Managing Director'),
  ('salesmgr@smp.test', 'Sara Haddad', 'Sales Manager'), ('sales@smp.test', 'Rahul Menon', 'Sales Executive'),
  ('sales2@smp.test', 'Fatima Zahra', 'Sales Executive'), ('newhire@smp.test', 'Aisha Rahman', 'Sales Executive'),
  ('acct@smp.test', 'Joseph Mathew', 'Accounts Manager'), ('acct2@smp.test', 'Neha Kapoor', 'Accounts Executive'),
  ('proc@smp.test', 'Imran Qureshi', 'Procurement Manager'), ('buyer@smp.test', 'Daniel Fernandes', 'Procurement Executive'),
  ('wh1@smp.test', 'Suresh Kumar', 'Warehouse Manager'), ('wh2@smp.test', 'Ali Raza', 'Warehouse Supervisor'),
  ('logi@smp.test', 'Hamid Yousef', 'Logistics Executive')) v(e, n, t)
where p.email = v.e;
update public.user_roles set role_id = (select id from public.roles where code = 'warehouse_manager')
 where user_id = (select id from public.profiles where email = 'wh2@smp.test');

update public.company_settings set legal_name = 'SMP General Trading LLC', trade_name = 'SMP Trading', trn = '100234567800003',
  address = 'Warehouse 14, Street 7, Al Quoz Industrial Area 3', city = 'Dubai', phone = '+971 4 000 0000', email = 'sales@smp-demo.ae',
  website = 'www.smp-demo.ae', bank_details = 'Emirates NBD · SMP General Trading LLC · IBAN AE07 0331 2345 6789 0123 456 · SWIFT EBILAEAD',
  quotation_terms = E'1. Prices are in AED and exclude VAT unless stated.\n2. Delivery within Dubai included for orders above AED 5,000.\n3. Validity as stated above.',
  invoice_terms = 'Payment by bank transfer to the account below, quoting the invoice number.';

-- Passwords so the demo users can sign in (demo only).
update auth.users set encrypted_password = crypt('Demo@2026', gen_salt('bf')), email_confirmed_at = coalesce(email_confirmed_at, now()),
  created_at = coalesce(created_at, now() - interval '200 days'), updated_at = coalesce(updated_at, now()),
  confirmation_token = '', recovery_token = '', email_change_token_new = '', email_change = '', email_change_token_current = '',
  phone_change = '', phone_change_token = '', reauthentication_token = '', raw_app_meta_data = '{"provider":"email","providers":["email"]}'
where email like '%@smp.test';
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
  from auth.users u where u.email like '%@smp.test'
   and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- Catalogue ------------------------------------------------------------------
insert into public.brands (name) values ('Schneider Electric'), ('ABB'), ('Legrand'), ('Honeywell') on conflict do nothing;
select test_as('proc@smp.test');
do $$
declare
  u_m uuid := (select id from public.units_of_measure where code = 'MTR');
  u_p uuid := (select id from public.units_of_measure where code = 'PCS');
  u_r uuid := (select id from public.units_of_measure where code = 'ROLL');
  r record;
begin
  for r in select * from (values
    ('CBL-3C-25',  'Power cable 3C x 25mm² XLPE/SWA', 'Power Cables', 'Ducab', u_m, 62.0, 84.0, 200, 'Gulf Cable Supplies LLC'),
    ('CBL-4C-35',  'Power cable 4C x 35mm² XLPE/SWA', 'Power Cables', 'Ducab', u_m, 98.0, 132.0, 150, 'Gulf Cable Supplies LLC'),
    ('CBL-1C-240', 'Single core cable 1C x 240mm²',   'Power Cables', 'Ducab', u_m, 145.0, 190.0, 100, 'Emirates Wire Industries'),
    ('DAT-C6A-305','Cat6A U/FTP data cable, 305 m',   'Data Cables',  'Legrand', u_r, 420.0, 565.0, 6, 'Emirates Wire Industries'),
    ('DAT-OM3-12', 'Fibre optic OM3 12-core, armoured','Data Cables', 'Legrand', u_m, 9.5, 14.0, 500, 'Emirates Wire Industries'),
    ('ELE-DB-24',  'Distribution board 24-way TPN',   'Electrical',   'Schneider Electric', u_p, 680.0, 920.0, 4, 'Emirates Wire Industries'),
    ('ELE-MCB-32', 'MCB 32A C-curve 10kA',            'Electrical',   'ABB', u_p, 18.0, 27.0, 50, 'Emirates Wire Industries'),
    ('ELE-ISO-63', 'Rotary isolator 63A 4P',          'Electrical',   'ABB', u_p, 75.0, 108.0, 10, 'Emirates Wire Industries'),
    ('SAF-VEST-HV','Hi-vis safety vest, class 2',     'Safety Equipment', null, u_p, 6.0, 11.0, 100, null),
    ('SAF-GLV-C5', 'Cut-resistant gloves, level C',    'Safety Equipment', 'Honeywell', u_p, 8.0, 14.0, 100, null),
    ('SAF-GOG-3M', 'Safety goggles, anti-fog',         'Safety Equipment', '3M', u_p, 12.0, 19.0, 50, null)
  ) v(sku, name, cat, brand, uom, cost, sell, minq, sup) loop
    perform public.save_product(jsonb_build_object('sku', r.sku, 'name', r.name, 'item_type', 'stock', 'uom_id', r.uom, 'currency_code', 'AED',
      'category_id', (select id from public.product_categories where name = r.cat), 'brand_id', (select id from public.brands where name = r.brand),
      'purchase_price', r.cost, 'default_sell_price', r.sell, 'min_stock_level', r.minq,
      'default_supplier_id', (select id from public.suppliers where name = r.sup)));
  end loop;
end $$;

-- Opening stock (prepared by one person, approved by another)
select test_as('wh1@smp.test');
do $$
declare v uuid;
begin
  v := public.save_stock_adjustment(jsonb_build_object('warehouse_id', (select id from public.warehouses where code = 'MAIN'), 'reason', 'opening_balance',
    'notes', 'Opening stock count', 'lines', (select jsonb_agg(jsonb_build_object('product_id', p.id, 'mode', 'change', 'qty_change', q.qty, 'unit_cost_base', p.purchase_price))
      from (values ('CBL-3C-25', 900), ('CBL-4C-35', 600), ('CBL-1C-240', 120), ('DAT-C6A-305', 40), ('DAT-OM3-12', 2500), ('ELE-DB-24', 12),
                   ('ELE-MCB-32', 600), ('ELE-ISO-63', 8), ('SAF-VEST-HV', 1200), ('SAF-GLV-C5', 70), ('SAF-GOG-3M', 300), ('CBL-4C-16', 400), ('HLM-3M-H700', 250)) q(sku, qty)
      join public.products p on p.sku = q.sku)));
  perform public.submit_stock_adjustment(v);
end $$;
select test_as('wh2@smp.test');
select public.decide_approval((select id from public.approval_requests where doc_type = 'stock_adjustment' and status = 'pending'), true, 'Count sheets signed');

-- Customers ------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    ('sales@smp.test',   'Gulf Horizon Contracting LLC',   '100345678900003', 'Net 30', 'Dubai',     'Mohammed Saleh', 'Procurement Manager'),
    ('sales@smp.test',   'Desert Peak Facilities Management','100456789000003', 'Net 45', 'Abu Dhabi', 'Anil Varma', 'Purchasing Officer'),
    ('sales2@smp.test',  'Blue Lagoon Hotels & Resorts',   '100567890100003', 'Net 30', 'Ras Al Khaimah', 'Elena Petrova', 'Chief Engineer'),
    ('sales2@smp.test',  'Al Waha MEP Services LLC',       '100678901200003', 'Net 60', 'Sharjah',   'Yousef Darwish', 'Project Manager'),
    ('newhire@smp.test', 'Pearl Coast Marine Services',    null,              'Cash on delivery', 'Ajman', 'Thomas George', 'Owner'),
    ('sales@smp.test',   'Skyline Data Centres FZ-LLC',    '100789012300003', 'Net 30', 'Dubai',     'Grace Lim', 'Infrastructure Lead')
  ) v(rep, name, trn, terms, city, contact, designation) loop
    perform test_as(r.rep);
    perform public.save_customer(jsonb_build_object('name', r.name, 'customer_type', 'company', 'trn', r.trn, 'currency_code', 'AED',
      'payment_term_id', (select id from public.payment_terms where name = r.terms), 'delivery_term_id', (select id from public.delivery_terms where code = 'LOCAL'),
      'email', 'procurement@' || lower(regexp_replace(split_part(r.name, ' ', 1) || split_part(r.name, ' ', 2), '[^A-Za-z]', '', 'g')) || '.example',
      'phone', '+971 4 ' || (300 + length(r.name))::text || ' ' || (1000 + length(r.contact) * 37)::text,
      'contacts', jsonb_build_array(jsonb_build_object('name', r.contact, 'designation', r.designation, 'is_primary', true)),
      'addresses', jsonb_build_array(
        jsonb_build_object('kind', 'billing', 'line1', 'Office ' || (100 + length(r.name) * 7)::text || ', Business Tower', 'city', r.city, 'emirate', r.city, 'is_default', true),
        jsonb_build_object('kind', 'shipping', 'label', 'Main site', 'line1', 'Plot ' || length(r.contact)::text || ', Industrial Area', 'city', r.city, 'is_default', true))));
  end loop;
end $$;
select test_as('acct@smp.test');
do $$
declare r record;
begin
  for r in select c.*, v.lim from public.customers c join (values ('Gulf Horizon Contracting LLC', 250000), ('Desert Peak Facilities Management', 150000),
     ('Blue Lagoon Hotels & Resorts', 200000), ('Al Waha MEP Services LLC', 120000), ('Skyline Data Centres FZ-LLC', 400000)) v(n, lim) on v.n = c.name loop
    perform public.save_customer((select to_jsonb(c2) - 'code' - 'name_normalized' from public.customers c2 where c2.id = r.id)
      || jsonb_build_object('credit_limit', r.lim,
           'contacts', (select coalesce(jsonb_agg(to_jsonb(cc)), '[]') from public.customer_contacts cc where cc.customer_id = r.id),
           'addresses', (select coalesce(jsonb_agg(to_jsonb(ca)), '[]') from public.customer_addresses ca where ca.customer_id = r.id)));
  end loop;
end $$;

-- Deals: enquiry → quotation → order → delivery → invoice → payment ---------------
create temp table demo_shift (kind text, id uuid, months int);
grant all on demo_shift to authenticated;

create or replace function pg_temp.deal(p_rep text, p_customer text, p_lines jsonb, p_stage text, p_months int, p_lead_source text default 'existing_customer')
returns uuid language plpgsql as $$
declare v_c uuid; v_lead uuid; v_q uuid; v_so uuid; v_dn uuid; v_inv uuid;
  v_lines jsonb; v_wh uuid := (select id from public.warehouses where code = 'MAIN');
begin
  perform test_as(p_rep);
  v_c := (select id from public.customers where name = p_customer);
  v_lines := (select jsonb_agg(jsonb_build_object('product_id', p.id, 'qty', (l->>'qty')::numeric, 'unit_price', coalesce((l->>'price')::numeric, p.default_sell_price),
      'discount_pct', coalesce((l->>'disc')::numeric, 0)))
    from jsonb_array_elements(p_lines) l join public.products p on p.sku = l->>'sku');
  v_lead := public.save_lead(jsonb_build_object('title', 'Supply for ' || p_customer, 'source', p_lead_source, 'customer_id', v_c, 'company_name', p_customer,
     'estimated_value', (select sum((x->>'qty')::numeric * (x->>'unit_price')::numeric) from jsonb_array_elements(v_lines) x), 'probability', 50,
     'expected_close_date', (current_date + 20)::text));
  insert into demo_shift values ('lead', v_lead, p_months);
  if p_stage = 'lead' then return null; end if;
  v_q := public.save_quotation(jsonb_build_object('customer_id', v_c, 'lead_id', v_lead, 'subject', 'Electrical & safety supplies', 'delivery_time', '3–5 working days',
     'valid_until', (current_date + 30)::text, 'lines', v_lines));
  insert into demo_shift values ('quotation', v_q, p_months);
  if p_stage = 'draft' then return v_q; end if;
  perform public.submit_quotation(v_q);
  if (select status from public.quotations where id = v_q) = 'pending_approval' then
    perform test_as('salesmgr@smp.test');
    perform public.decide_approval((select id from public.approval_requests where doc_id = v_q and status = 'pending'), true, 'Strategic account — approved');
    perform test_as(p_rep);
  end if;
  if p_stage = 'approved' then return v_q; end if;
  perform public.set_quotation_status(v_q, 'sent');
  if p_stage = 'sent' then return v_q; end if;
  if p_stage = 'lost' then perform public.set_quotation_status(v_q, 'lost', 'Competitor quoted 8% lower'); return v_q; end if;
  perform public.set_quotation_status(v_q, 'accepted');
  v_so := public.convert_quotation_to_order(v_q, 'PO-' || upper(left(regexp_replace(p_customer, '[^A-Za-z]', '', 'g'), 4)) || '-' || (2000 + p_months * 37 + length(p_lines::text))::text, current_date + 7);
  perform public.confirm_sales_order(v_so);
  if (select status from public.sales_orders where id = v_so) = 'pending_approval' then
    perform test_as('acct@smp.test');
    perform public.decide_approval((select id from public.approval_requests where doc_id = v_so and status = 'pending'), true, 'Payment history good');
  end if;
  insert into demo_shift values ('order', v_so, p_months);
  if p_stage = 'order' then return v_so; end if;
  perform test_as('logi@smp.test');
  v_dn := public.save_delivery_note(jsonb_build_object('sales_order_id', v_so, 'warehouse_id', v_wh, 'contact_name', 'Site store keeper',
     'delivery_address_id', (select id from public.customer_addresses where customer_id = v_c and kind = 'shipping' limit 1),
     'lines', (select jsonb_agg(jsonb_build_object('sales_order_line_id', l.id, 'qty', r.qty)) from public.sales_order_lines l
                join public.stock_reservations r on r.sales_order_line_id = l.id and r.status = 'active' and r.warehouse_id = v_wh where l.sales_order_id = v_so)));
  perform public.dispatch_delivery_note(v_dn);
  insert into demo_shift values ('delivery', v_dn, p_months);
  if p_stage = 'dispatched' then return v_so; end if;
  perform public.confirm_delivery(v_dn, '{"received_by_name":"Site store keeper","pod_notes":"Received in good condition"}');
  if p_stage = 'delivered' then return v_so; end if;
  perform test_as('acct@smp.test');
  v_inv := public.create_invoice_from_deliveries(v_so);
  perform public.post_invoice(v_inv);
  insert into demo_shift values ('invoice', v_inv, p_months);
  if p_stage = 'invoiced' then return v_so; end if;
  perform public.record_customer_payment(jsonb_build_object('customer_id', v_c, 'method', 'bank_transfer',
     'bank_account_id', (select id from public.bank_accounts limit 1), 'reference', 'TT ' || (80000 + p_months * 113)::text,
     'amount', (select total from public.customer_invoices where id = v_inv), 'allocations', jsonb_build_array(jsonb_build_object('invoice_id', v_inv,
       'amount', (select total from public.customer_invoices where id = v_inv)))));
  insert into demo_shift select 'payment', id, p_months from public.customer_payments order by created_at desc limit 1;
  return v_so;
end $$;

select pg_temp.deal('sales@smp.test',   'Gulf Horizon Contracting LLC', '[{"sku":"CBL-3C-25","qty":300},{"sku":"ELE-DB-24","qty":2},{"sku":"ELE-MCB-32","qty":48}]', 'paid', 5);
select pg_temp.deal('sales2@smp.test',  'Blue Lagoon Hotels & Resorts', '[{"sku":"SAF-VEST-HV","qty":250},{"sku":"SAF-GOG-3M","qty":80}]', 'paid', 5, 'exhibition');
select pg_temp.deal('sales@smp.test',   'Skyline Data Centres FZ-LLC', '[{"sku":"DAT-C6A-305","qty":12},{"sku":"DAT-OM3-12","qty":800}]', 'paid', 4, 'tender');
select pg_temp.deal('sales2@smp.test',  'Al Waha MEP Services LLC', '[{"sku":"CBL-4C-35","qty":180},{"sku":"ELE-ISO-63","qty":4}]', 'paid', 4);
select pg_temp.deal('sales@smp.test',   'Desert Peak Facilities Management', '[{"sku":"SAF-GLV-C5","qty":40},{"sku":"SAF-VEST-HV","qty":200}]', 'invoiced', 3);
select pg_temp.deal('sales@smp.test',   'Gulf Horizon Contracting LLC', '[{"sku":"CBL-1C-240","qty":60,"disc":5},{"sku":"ELE-MCB-32","qty":120}]', 'paid', 3);
select pg_temp.deal('newhire@smp.test', 'Pearl Coast Marine Services', '[{"sku":"SAF-VEST-HV","qty":60},{"sku":"SAF-GOG-3M","qty":30}]', 'paid', 2, 'walk_in');
select pg_temp.deal('sales2@smp.test',  'Blue Lagoon Hotels & Resorts', '[{"sku":"ELE-DB-24","qty":3},{"sku":"ELE-MCB-32","qty":72}]', 'invoiced', 2);
select pg_temp.deal('sales@smp.test',   'Skyline Data Centres FZ-LLC', '[{"sku":"DAT-OM3-12","qty":1200},{"sku":"DAT-C6A-305","qty":10}]', 'invoiced', 1, 'tender');
select pg_temp.deal('sales2@smp.test',  'Al Waha MEP Services LLC', '[{"sku":"CBL-3C-25","qty":220},{"sku":"CBL-4C-35","qty":120}]', 'delivered', 1);
select pg_temp.deal('sales@smp.test',   'Gulf Horizon Contracting LLC', '[{"sku":"ELE-ISO-63","qty":3},{"sku":"CBL-4C-35","qty":90}]', 'dispatched', 0);
select pg_temp.deal('sales@smp.test',   'Desert Peak Facilities Management', '[{"sku":"SAF-GOG-3M","qty":60},{"sku":"SAF-GLV-C5","qty":25}]', 'order', 0);
select pg_temp.deal('newhire@smp.test', 'Pearl Coast Marine Services', '[{"sku":"SAF-GLV-C5","qty":40},{"sku":"SAF-VEST-HV","qty":40}]', 'order', 0, 'walk_in');
select pg_temp.deal('sales2@smp.test',  'Blue Lagoon Hotels & Resorts', '[{"sku":"CBL-1C-240","qty":90},{"sku":"ELE-DB-24","qty":2}]', 'sent', 0, 'referral');
select pg_temp.deal('sales@smp.test',   'Skyline Data Centres FZ-LLC', '[{"sku":"DAT-C6A-305","qty":30,"disc":12}]', 'approved', 0, 'tender');
select pg_temp.deal('sales2@smp.test',  'Al Waha MEP Services LLC', '[{"sku":"CBL-3C-25","qty":400}]', 'lost', 1);
select pg_temp.deal('newhire@smp.test', 'Pearl Coast Marine Services', '[{"sku":"SAF-GOG-3M","qty":20}]', 'draft', 0, 'phone');
select pg_temp.deal('sales@smp.test',   'Desert Peak Facilities Management', '[{"sku":"ELE-MCB-32","qty":200}]', 'lead', 0, 'website');
select pg_temp.deal('sales2@smp.test',  'Blue Lagoon Hotels & Resorts', '[{"sku":"SAF-VEST-HV","qty":500}]', 'lead', 0, 'referral');

-- A few follow-ups for this week
select test_as('sales@smp.test');
insert into public.activities (activity_type, subject, due_at, owner_id, customer_id)
select 'follow_up', s, now() + d, auth.uid(), (select id from public.customers where name = c) from (values
  ('Chase PO for Cat6A data cable (tender)', interval '1 day', 'Skyline Data Centres FZ-LLC'),
  ('Site visit — panel room measurements', interval '3 days', 'Gulf Horizon Contracting LLC'),
  ('Call about overdue invoice', interval '-1 day', 'Desert Peak Facilities Management')) v(s, d, c);
select test_as('sales2@smp.test');
insert into public.activities (activity_type, subject, due_at, owner_id, customer_id)
values ('meeting', 'Quarterly review with chief engineer', now() + interval '2 days', auth.uid(), (select id from public.customers where name = 'Blue Lagoon Hotels & Resorts'));

-- Spread the history over the last six months (demo only: bypasses the posting locks).
reset role;
set session_replication_role = replica;
update public.leads l set created_at = l.created_at - make_interval(months => s.months, days => 3) from demo_shift s where s.kind = 'lead' and s.id = l.id;
update public.quotations q set quotation_date = (q.quotation_date - make_interval(months => s.months, days => 3))::date, valid_until = (q.valid_until - make_interval(months => s.months, days => 3))::date,
  created_at = q.created_at - make_interval(months => s.months, days => 3) from demo_shift s where s.kind = 'quotation' and s.id = q.id;
update public.sales_orders o set order_date = (o.order_date - make_interval(months => s.months))::date, required_date = (o.required_date - make_interval(months => s.months))::date,
  created_at = o.created_at - make_interval(months => s.months) from demo_shift s where s.kind = 'order' and s.id = o.id;
update public.delivery_notes d set delivery_date = (d.delivery_date - make_interval(months => s.months))::date + 2, dispatched_at = d.dispatched_at - make_interval(months => s.months) + interval '2 days',
  delivered_at = d.delivered_at - make_interval(months => s.months) + interval '2 days' from demo_shift s where s.kind = 'delivery' and s.id = d.id;
update public.customer_invoices i set invoice_date = (i.invoice_date - make_interval(months => s.months))::date + 3, supply_date = (i.supply_date - make_interval(months => s.months))::date + 2,
  due_date = (i.due_date - make_interval(months => s.months))::date + 3, posted_at = i.posted_at - make_interval(months => s.months) + interval '3 days'
  from demo_shift s where s.kind = 'invoice' and s.id = i.id;
update public.customer_payments p set payment_date = least((p.payment_date - make_interval(months => s.months))::date + 25, current_date)
  from demo_shift s where s.kind = 'payment' and s.id = p.id;
set session_replication_role = origin;

select 'DEMO DATA LOADED' as result;
