-- =============================================================================
-- Finance — behaviour tests (after 10–50).
-- EBS order was delivered in two notes (DN1: 60 m, DN2: 40 + 150 m) at AED 52/m + 5% VAT.
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
reset role;
select set_config('test.so', (select id::text from public.sales_orders where customer_po_ref = 'EBS-PO-1001'), false);
select set_config('test.dn1', (select id::text from public.delivery_notes where sales_order_id = current_setting('test.so')::uuid and status = 'delivered'), false);
select set_config('test.cust', (select customer_id::text from public.sales_orders where id = current_setting('test.so')::uuid), false);
update public.customers set vat_registered = true, trn = coalesce(trn, '100555666700003') where id = current_setting('test.cust')::uuid;
insert into auth.users (email, raw_user_meta_data) values ('acct2@smp.test', '{"full_name":"Accounts Executive"}');
insert into public.user_roles (user_id, role_id) select p.id, r.id from public.profiles p, public.roles r where p.email = 'acct2@smp.test' and r.code = 'accounts_executive';

-- =============================================================================
-- 1. Invoices from delivered quantities
-- =============================================================================
select test_as('acct@smp.test');
insert into public.bank_accounts(name, bank_name, iban, currency_code) values ('ENBD Current AED', 'Emirates NBD', 'AE070331234567890123456', 'AED');
select set_config('test.bank', (select id::text from public.bank_accounts where name = 'ENBD Current AED'), false);
select set_config('test.inv1', public.create_invoice_from_deliveries(current_setting('test.so')::uuid, array[current_setting('test.dn1')::uuid])::text, false);
select assert_eq((select total from public.customer_invoices where id = current_setting('test.inv1')::uuid), 3276.00, '60 × 52 + VAT');
select assert_eq((select doc_no from public.customer_invoices where id = current_setting('test.inv1')::uuid), null::text, 'no number until posted');
select set_config('test.inv2', public.create_invoice_from_deliveries(current_setting('test.so')::uuid)::text, false);
select assert_eq((select total from public.customer_invoices where id = current_setting('test.inv2')::uuid), 10374.00, 'rest: 190 × 52 + VAT (DN1 already on a draft)');
select expect_error(format('select public.create_invoice_from_deliveries(%L)', current_setting('test.so')), 'Nothing has been delivered');
-- Edit draft 1: cannot invoice more than delivered; add a freight charge.
select expect_error(format($$select public.save_invoice_draft(jsonb_build_object('id', %L, 'lines', jsonb_build_array(
  jsonb_build_object('id', (select id from public.customer_invoice_lines where invoice_id = %L::uuid), 'qty', 70))))$$,
  current_setting('test.inv1'), current_setting('test.inv1')), 'only 60.000 delivered');
select public.save_invoice_draft(jsonb_build_object('id', current_setting('test.inv1'), 'lines', jsonb_build_array(
  jsonb_build_object('id', (select id from public.customer_invoice_lines where invoice_id = current_setting('test.inv1')::uuid), 'qty', 60),
  jsonb_build_object('description', 'Delivery charges', 'qty', 1, 'unit_price', 100))));
select assert_eq((select total || '/' || count(*) from public.customer_invoices i join public.customer_invoice_lines l on l.invoice_id = i.id
                   where i.id = current_setting('test.inv1')::uuid group by i.total), '3381.00/2', 'freight added');
-- Accounts executive can prepare but not post.
select test_as('acct2@smp.test');
select expect_error(format('select public.post_invoice(%L)', current_setting('test.inv1')), 'invoice.post');
select test_as('acct@smp.test');
select assert_eq(public.post_invoice(current_setting('test.inv1')::uuid) like 'INV-%', true, 'posted with number');
select assert_eq((select status::text || ':' || einvoice_status::text || ':' || (due_date >= invoice_date)::text from public.customer_invoices where id = current_setting('test.inv1')::uuid),
                 'posted:not_enabled:true', 'posted, e-invoicing off, due date set');
select expect_error($$update public.customer_invoices set total = 1$$, 'permission denied');
reset role;
select expect_error(format('update public.customer_invoices set total = 1 where id = %L', current_setting('test.inv1')), 'cannot be changed');
select test_as('acct@smp.test');
select public.post_invoice(current_setting('test.inv2')::uuid);
select assert_eq((select status::text from public.sales_orders where id = current_setting('test.so')::uuid), 'invoiced', 'order fully invoiced');
select assert_eq((select string_agg(qty_invoiced::text, ',' order by line_no) from public.sales_order_lines where sales_order_id = current_setting('test.so')::uuid), '100.000,150.000', 'lines invoiced');
reset role;
select assert_eq((select open_orders_base from public.customer_credit_position(current_setting('test.cust')::uuid)), 13755.00, 'exposure = unpaid invoices');

-- =============================================================================
-- 2. Receipts and allocation
-- =============================================================================
select test_as('acct@smp.test');
select expect_error(format($$select public.record_customer_payment(jsonb_build_object('customer_id', %L, 'method', 'bank_transfer', 'bank_account_id', %L, 'amount', 5000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', %L, 'amount', 4000))))$$, current_setting('test.cust'), current_setting('test.bank'), current_setting('test.inv1')),
  'only has 3381.00 outstanding');
select expect_error(format($$select public.record_customer_payment(jsonb_build_object('customer_id', %L, 'method', 'cheque', 'bank_account_id', %L, 'amount', 5000))$$,
  current_setting('test.cust'), current_setting('test.bank')), 'cheque number');
select set_config('test.pay1', public.record_customer_payment(jsonb_build_object('customer_id', current_setting('test.cust'), 'method', 'bank_transfer',
  'bank_account_id', current_setting('test.bank'), 'reference', 'TT 88231', 'amount', 5000,
  'allocations', jsonb_build_array(jsonb_build_object('invoice_id', current_setting('test.inv1'), 'amount', 3381),
                                   jsonb_build_object('invoice_id', current_setting('test.inv2'), 'amount', 1619))))::text, false);
select assert_eq((select string_agg(status::text || ':' || balance, ',' order by invoice_date, doc_no) from public.customer_invoices
                   where id in (current_setting('test.inv1')::uuid, current_setting('test.inv2')::uuid)), 'paid:0.00,partially_paid:8755.00', 'allocated');
select expect_error(format('select public.void_invoice(%L, %L)', current_setting('test.inv2'), 'mistake'), 'no payments');

-- Credit note: 10 m returned on invoice 2.
select set_config('test.cn', public.create_credit_note(current_setting('test.inv2')::uuid, jsonb_build_object('reason', '10 m damaged on delivery',
  'lines', jsonb_build_array(jsonb_build_object('invoice_line_id',
     (select id from public.customer_invoice_lines where invoice_id = current_setting('test.inv2')::uuid and qty = 150), 'qty', 10))))::text, false);
select assert_eq((select total from public.customer_invoices where id = current_setting('test.cn')::uuid), 546.00, 'credit 10 × 52 + VAT');
select assert_eq(public.post_invoice(current_setting('test.cn')::uuid) like 'CN-%', true, 'credit note numbered');
select assert_eq((select balance from public.customer_invoices where id = current_setting('test.inv2')::uuid), 8209.00, 'balance reduced by credit');

-- Bounced transfer: void the receipt, invoices open again.
select public.void_customer_payment(current_setting('test.pay1')::uuid, 'Transfer recalled by bank');
select assert_eq((select string_agg(status::text || ':' || balance, ',' order by invoice_date, doc_no) from public.customer_invoices
                   where id in (current_setting('test.inv1')::uuid, current_setting('test.inv2')::uuid)), 'posted:3381.00,partially_paid:9828.00', 'receipt reversed');
select assert_eq((select count(*) from public.v_receivables where customer_id = current_setting('test.cust')::uuid)::int, 2, 'two open items');

-- =============================================================================
-- 3. E-invoicing queue
-- =============================================================================
reset role;
update public.company_settings set einvoice_provider = 'Test ASP', trn = '100123456700003';
select public.test_backend(); select public.set_module_enabled('einvoicing', true);
select test_as('acct@smp.test');
select set_config('test.inv3', public.save_invoice_draft(jsonb_build_object('customer_id', current_setting('test.cust'),
  'lines', jsonb_build_array(jsonb_build_object('description', 'Cable termination service', 'qty', 1, 'unit_price', 500))))::text, false);
select public.post_invoice(current_setting('test.inv3')::uuid);
select assert_eq((select einvoice_status::text from public.customer_invoices where id = current_setting('test.inv3')::uuid), 'queued', 'queued for the ASP');
select expect_error('select public.einvoice_claim_batch(5)', 'permission denied');
reset role;
set role service_role;
select set_config('test.tx', (select transmission_id::text from public.einvoice_claim_batch(5) where invoice_id = current_setting('test.inv3')::uuid), false);
select assert_eq((select status from public.einvoice_transmissions where id = current_setting('test.tx')::uuid), 'sending', 'claimed');
select public.einvoice_record_result(current_setting('test.tx')::uuid, 'accepted', 'ASP-REF-1', '{}'::jsonb, '{"ok":true}'::jsonb, null);
reset role;
select assert_eq((select einvoice_status::text || ':' || einvoice_ref from public.customer_invoices where id = current_setting('test.inv3')::uuid), 'accepted:ASP-REF-1', 'accepted');
select assert_eq((select (public.einvoice_document(current_setting('test.inv3')::uuid)->'seller'->>'trn')), '100123456700003', 'document has seller TRN');
select test_as('acct@smp.test');
select expect_error(format('select public.void_invoice(%L, %L)', current_setting('test.inv3'), 'wrong'), 'Issue a credit note');
reset role;
select public.test_backend(); select public.set_module_enabled('einvoicing', false);

-- =============================================================================
-- 4. Supplier bills: three-way match and variance approval
-- =============================================================================
select set_config('test.po', (select po.id::text from public.purchase_orders po join public.suppliers s on s.id = po.supplier_id
  where s.name = 'Emirates Wire Industries' and po.status = 'received'), false);
select set_config('test.pol', (select id::text from public.purchase_order_lines where purchase_order_id = current_setting('test.po')::uuid), false);
select set_config('test.po3', (select id::text from public.purchase_orders where status = 'closed'), false);
select test_as('acct@smp.test');
select expect_error(format($$select public.save_supplier_bill(jsonb_build_object('supplier_id', (select supplier_id from public.purchase_orders where id = %L::uuid),
  'purchase_order_id', %L, 'supplier_invoice_no', 'EWI/INV/551', 'bill_date', current_date,
  'lines', jsonb_build_array(jsonb_build_object('purchase_order_line_id', %L, 'qty', 160, 'unit_cost', 34.5))))$$,
  current_setting('test.po'), current_setting('test.po'), current_setting('test.pol')), 'only 150.000 received');
select set_config('test.bill1', public.save_supplier_bill(jsonb_build_object('supplier_id', (select supplier_id from public.purchase_orders where id = current_setting('test.po')::uuid),
  'purchase_order_id', current_setting('test.po'), 'supplier_invoice_no', 'EWI/INV/551', 'bill_date', current_date,
  'lines', jsonb_build_array(jsonb_build_object('purchase_order_line_id', current_setting('test.pol'), 'qty', 150, 'unit_cost', 35))))::text, false);
select assert_eq((select max_variance_pct from public.supplier_bills where id = current_setting('test.bill1')::uuid), 1.45, '1.45% above PO');
select assert_eq(public.submit_supplier_bill(current_setting('test.bill1')::uuid)::text, 'approved', 'small variance auto-approved');
select assert_eq((select qty_billed from public.purchase_order_lines where id = current_setting('test.pol')::uuid), 150.000, 'PO line billed');
select expect_error(format($$select public.save_supplier_bill(jsonb_build_object('supplier_id', (select supplier_id from public.purchase_orders where id = %L::uuid),
  'supplier_invoice_no', 'ewi/inv/551', 'bill_date', current_date, 'lines', jsonb_build_array(jsonb_build_object('description', 'x', 'qty', 1, 'unit_cost', 1))))$$,
  current_setting('test.po')), 'already been entered');

select set_config('test.bill2', public.save_supplier_bill(jsonb_build_object('supplier_id', (select supplier_id from public.purchase_orders where id = current_setting('test.po3')::uuid),
  'purchase_order_id', current_setting('test.po3'), 'supplier_invoice_no', 'GCS-2026-118', 'bill_date', current_date,
  'lines', jsonb_build_array(jsonb_build_object('purchase_order_line_id', (select id from public.purchase_order_lines where purchase_order_id = current_setting('test.po3')::uuid),
     'qty', 12, 'unit_cost', 40))))::text, false);
select assert_eq(public.submit_supplier_bill(current_setting('test.bill2')::uuid)::text, 'pending_approval', '14% above PO → approval');
select expect_error($$select public.decide_approval((select id from public.approval_requests where doc_id = current_setting('test.bill2')::uuid and status = 'pending'), true)$$,
                    'your own request');
select test_as('md@smp.test');
select public.decide_approval((select id from public.approval_requests where doc_id = current_setting('test.bill2')::uuid and status = 'pending'), true, 'Copper price rise agreed');
select assert_eq((select status::text from public.supplier_bills where id = current_setting('test.bill2')::uuid), 'approved', 'approved by MD');

-- Supplier payment
select test_as('acct@smp.test');
select expect_error(format($$select public.record_supplier_payment(jsonb_build_object('supplier_id', (select supplier_id from public.supplier_bills where id = %L::uuid),
  'method', 'bank_transfer', 'bank_account_id', %L, 'amount', 10000, 'allocations', jsonb_build_array(jsonb_build_object('bill_id', %L, 'amount', 10000))))$$,
  current_setting('test.bill1'), current_setting('test.bank'), current_setting('test.bill1')), 'only has 5512.50 outstanding');
select public.record_supplier_payment(jsonb_build_object('supplier_id', (select supplier_id from public.supplier_bills where id = current_setting('test.bill1')::uuid),
  'method', 'bank_transfer', 'bank_account_id', current_setting('test.bank'), 'amount', 5512.50,
  'allocations', jsonb_build_array(jsonb_build_object('bill_id', current_setting('test.bill1'), 'amount', 5512.50))));
select assert_eq((select status::text || ':' || balance from public.supplier_bills where id = current_setting('test.bill1')::uuid), 'paid:0.00', 'bill paid');
select assert_eq((select count(*) from public.v_payables)::int, 1, 'one bill still payable');

-- =============================================================================
-- 5. Expenses
-- =============================================================================
select test_as('sales@smp.test');
select expect_error($$select public.save_expense(jsonb_build_object('expense_date', current_date, 'category_id', (select id from public.expense_categories where name = 'Fuel'),
  'description', 'Fuel', 'amount', 100, 'vat_amount', 5))$$, 'TRN');
select expect_error($$select public.save_expense(jsonb_build_object('expense_date', current_date, 'category_id', (select id from public.expense_categories where name = 'Fuel'),
  'description', 'Fuel', 'amount', 100, 'vat_amount', 20, 'vendor_trn', '100000000000003'))$$, 'more than 5%');
select set_config('test.exp', public.save_expense(jsonb_build_object('expense_date', current_date, 'category_id', (select id from public.expense_categories where name = 'Fuel'),
  'description', 'Fuel for site visits', 'vendor_name', 'ENOC', 'vendor_trn', '100000000000003', 'amount', 100, 'vat_amount', 5))::text, false);
select public.submit_expense(current_setting('test.exp')::uuid);
select assert_eq((select status::text from public.expenses where id = current_setting('test.exp')::uuid), 'submitted', 'submitted for approval');
select test_as('acct2@smp.test');
select expect_error(format('select public.mark_expense_paid(%L, %L)', current_setting('test.exp'), '{}'), 'expense.pay');
select assert_eq((select count(*) from public.expenses)::int, 1, 'accounts sees all claims');
select test_as('acct@smp.test');
select public.decide_approval((select id from public.approval_requests where doc_id = current_setting('test.exp')::uuid and status = 'pending'), true, null);
select public.mark_expense_paid(current_setting('test.exp')::uuid, jsonb_build_object('bank_account_id', current_setting('test.bank'), 'reference', 'Petty cash'));
select assert_eq((select status::text from public.expenses where id = current_setting('test.exp')::uuid), 'paid', 'expense paid');
select assert_eq((select vat from public.vat_summary(current_date - 1, current_date) where section = 'Expenses (input VAT)'), 5.00, 'input VAT on expenses');
select assert_eq((select vat from public.vat_summary(current_date - 1, current_date) where section = 'Sales (output VAT)' and tax_category = 'SR'),
                 156.00 + 5 + 494 - 26 + 25, 'output VAT net of credit note');

-- Visibility
select test_as('sales@smp.test');
select assert_eq((select count(*) from public.supplier_bills)::int, 0, 'sales sees no bills');
select assert_eq((select count(*) from public.expenses)::int, 1, 'sales sees own claim only');
select test_as('logi@smp.test');
select assert_eq((select count(*) from public.customer_invoices)::int, 0, 'logistics sees no invoices');

reset role;
select assert_eq((select count(*) from public.customer_invoices where status <> 'draft' and doc_no is null)::int, 0, 'every posted document numbered');
select 'ALL FINANCE TESTS PASSED' as result;
