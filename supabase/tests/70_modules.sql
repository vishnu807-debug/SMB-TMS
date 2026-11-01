-- =============================================================================
-- Licensed modules — behaviour tests (after 10–60).
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
reset role;

-- Only the backend can switch modules.
select test_as('admin@smp.test');
select expect_error($$select public.set_module_enabled('finance', false)$$, 'permission denied');
select expect_error($$update public.system_modules set is_enabled = false where code = 'finance'$$, 'permission denied');
select assert_eq((select count(*) from public.enabled_modules())::int, 6, 'six modules on (e-invoicing off)');
select public.test_backend();

-- Dependencies.
select expect_error($$select public.set_module_enabled('sales', false)$$, 'switch that off first');
select expect_error($$select public.set_module_enabled('core', false)$$, 'always on');
select expect_error($$select public.set_module_enabled('nonsense', true)$$, 'Unknown module');
select public.test_backend(); select public.set_module_enabled('finance', false);
select expect_error($$select public.set_module_enabled('einvoicing', true)$$, 'switched on first');

-- A client with Sales and Procurement only.
select public.test_backend(); select public.set_module_enabled('logistics', false);
select public.test_backend(); select public.set_module_enabled('inventory', false);
select assert_eq((select string_agg(m, ',' order by m) from public.enabled_modules() m), null::text, 'not visible without a session');

select test_as('admin@smp.test');
select assert_eq((select string_agg(m, ',') from public.enabled_modules() m), 'core,sales,procurement', 'sales + procurement only');
-- Even the Super Administrator loses the switched-off permissions.
select assert_eq(public.has_permission('invoice.view'), false, 'finance off for super admin');
select assert_eq(public.has_permission('delivery.manage'), false, 'logistics off');
select assert_eq(public.has_permission('inventory.adjust'), false, 'stock adjustments off');
select assert_eq(public.has_permission('quotation.create'), true, 'sales on');
select assert_eq(public.has_permission('purchase_order.create'), true, 'procurement on');
select assert_eq(public.has_permission('inventory.receive'), true, 'receiving against POs still possible');
select assert_eq(public.has_permission('user.manage'), true, 'core always on');
select assert_eq((select count(*) from public.customer_invoices)::int, 0, 'invoice data hidden');
select assert_eq((select count(*) from public.delivery_notes)::int, 0, 'delivery data hidden');
select assert_eq((select granted::text || ':' || source from public.user_effective_permissions((select id from public.profiles where email = 'acct@smp.test'))
                   where code = 'invoice.post'), 'false:Module not enabled', 'admin screen explains');
select test_as('acct@smp.test');
select expect_error($$select public.create_invoice_from_deliveries(gen_random_uuid())$$, 'invoice.create');
select test_as('logi@smp.test');
select expect_error($$select public.save_shipment('{"mode":"courier"}')$$, 'shipment.manage');
select test_as('wh1@smp.test');
select expect_error($$select public.save_stock_adjustment('{}'::jsonb)$$, 'inventory.adjust');

-- Switching back on restores everything; the data was never deleted.
reset role;
select public.test_backend(); select public.set_module_enabled('inventory', true);
select public.test_backend(); select public.set_module_enabled('logistics', true);
select public.test_backend(); select public.set_module_enabled('finance', true, 'Client upgraded to Finance');
select assert_eq((select changed_by from public.system_modules where code = 'finance'), 'Client upgraded to Finance', 'change note recorded');
select test_as('acct@smp.test');
select assert_eq((select count(*) from public.customer_invoices)::int > 0, true, 'invoices visible again');
select test_as('logi@smp.test');
select assert_eq((select count(*) from public.delivery_notes)::int > 0, true, 'deliveries visible again');

-- E-invoicing follows its module.
reset role;
select assert_eq(public.module_enabled('einvoicing'), false, 'e-invoicing off');
select test_as('acct@smp.test');
select set_config('test.inv', public.save_invoice_draft(jsonb_build_object('customer_id', (select customer_id from public.sales_orders where customer_po_ref = 'EBS-PO-1001'),
  'lines', jsonb_build_array(jsonb_build_object('description', 'Consultancy', 'qty', 1, 'unit_price', 100))))::text, false);
select public.post_invoice(current_setting('test.inv')::uuid);
select assert_eq((select einvoice_status::text from public.customer_invoices where id = current_setting('test.inv')::uuid), 'not_enabled', 'not sent while module off');
select expect_error(format('select public.retry_einvoice(%L)', current_setting('test.inv')), 'not enabled for this installation');
reset role;
select public.test_backend(); select public.set_module_enabled('einvoicing', true);
select test_as('acct@smp.test');
select public.retry_einvoice(current_setting('test.inv')::uuid);
select assert_eq((select einvoice_status::text from public.customer_invoices where id = current_setting('test.inv')::uuid), 'queued', 'queued once the module is on');
reset role;
select public.test_backend(); select public.set_module_enabled('einvoicing', false);
select 'ALL MODULE TESTS PASSED' as result;
