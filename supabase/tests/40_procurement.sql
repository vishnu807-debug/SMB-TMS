-- =============================================================================
-- Procurement — behaviour tests (after 10, 20, 30).
-- Story: EBS ordered 250 m of CBL-4C-16; 100 came from stock, 150 were sent to
-- procurement. We quote, order, receive in two parts and end fully reserved.
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
reset role;

insert into auth.users (email, raw_user_meta_data) values ('buyer@smp.test', '{"full_name":"Procurement Executive"}');
insert into public.user_roles (user_id, role_id)
select p.id, r.id from public.profiles p, public.roles r where p.email = 'buyer@smp.test' and r.code = 'procurement_executive';

select set_config('test.rl', (select rl.id::text from public.purchase_requisition_lines rl
  join public.sales_order_lines sol on sol.id = rl.sales_order_line_id
  where sol.sales_order_id = (select id from public.sales_orders where customer_po_ref = 'EBS-PO-1001')), false);
select set_config('test.sol', (select sales_order_line_id::text from public.purchase_requisition_lines where id = current_setting('test.rl')::uuid), false);
select set_config('test.main', (select id::text from public.warehouses where code = 'MAIN'), false);
select set_config('test.gcs', (select id::text from public.suppliers where name = 'Gulf Cable Supplies LLC'), false);

-- =============================================================================
-- 1. Suppliers
-- =============================================================================
select test_as('buyer@smp.test');
select expect_error($$select public.save_supplier('{"name":"Bad TRN Co","trn":"123"}')$$, '15 digits');
select expect_error($$select public.save_supplier('{"name":"gulf cable supplies llc"}')$$, 'already exists');
select set_config('test.alt', public.save_supplier(jsonb_build_object('name', 'Emirates Wire Industries', 'trn', '100234567800003',
  'currency_code', 'AED', 'city', 'Sharjah', 'contacts', jsonb_build_array(
    jsonb_build_object('name', 'Ravi Kumar', 'email', 'ravi@ewi.test', 'is_primary', true),
    jsonb_build_object('name', 'Sara Ali')))) ::text, false);
select assert_eq((select code like 'SUP-%' from public.suppliers where id = current_setting('test.alt')::uuid), true, 'supplier code assigned');
select assert_eq((select count(*) from public.supplier_contacts where supplier_id = current_setting('test.alt')::uuid)::int, 2, 'two contacts');
select test_as('sales@smp.test');
select expect_error($$select public.save_supplier('{"name":"Sneaky Co"}')$$, 'supplier.edit');

-- =============================================================================
-- 2. Open requisition lines and supplier quotations
-- =============================================================================
select test_as('buyer@smp.test');
select assert_eq((select qty_open from public.v_open_requisition_lines where id = current_setting('test.rl')::uuid), 150.000, '150 still to buy');
select assert_eq((select customer_name is not null from public.v_open_requisition_lines where id = current_setting('test.rl')::uuid), true, 'customer shown');
select set_config('test.sq1', public.save_supplier_quotation(jsonb_build_object('supplier_id', current_setting('test.gcs'),
  'requisition_id', (select requisition_id from public.purchase_requisition_lines where id = current_setting('test.rl')::uuid),
  'lines', jsonb_build_array(jsonb_build_object('requisition_line_id', current_setting('test.rl'),
     'product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 150, 'unit_price', 36))))::text, false);
select set_config('test.sq2', public.save_supplier_quotation(jsonb_build_object('supplier_id', current_setting('test.alt'),
  'requisition_id', (select requisition_id from public.purchase_requisition_lines where id = current_setting('test.rl')::uuid),
  'lines', jsonb_build_array(jsonb_build_object('requisition_line_id', current_setting('test.rl'),
     'product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 150, 'unit_price', 34.5, 'lead_time_days', 3))))::text, false);
select public.select_supplier_quotation(current_setting('test.sq2')::uuid);
select assert_eq((select string_agg(status, ',' order by doc_no) from public.supplier_quotations
                   where id in (current_setting('test.sq1')::uuid, current_setting('test.sq2')::uuid)), 'rejected,selected', 'best quote selected, other rejected');
select assert_eq((select last_cost from public.supplier_products where supplier_id = current_setting('test.alt')::uuid
                   and product_id = (select id from public.products where sku = 'CBL-4C-16')), 34.5000, 'supplier price list updated');

-- =============================================================================
-- 3. Purchase order from the requisition
-- =============================================================================
select expect_error(format($$select public.save_purchase_order(jsonb_build_object('supplier_id', %L, 'warehouse_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'),
   'qty', 200, 'unit_cost', 34.5, 'requisition_line_id', %L))))$$, current_setting('test.alt'), current_setting('test.main'), current_setting('test.rl')),
  'only 150.000 left');
select set_config('test.po', public.save_purchase_order(jsonb_build_object('supplier_id', current_setting('test.alt'),
  'warehouse_id', current_setting('test.main'), 'supplier_quotation_id', current_setting('test.sq2'), 'expected_date', current_date + 3,
  'lines', jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'),
     'qty', 150, 'unit_cost', 34.5, 'requisition_line_id', current_setting('test.rl')))))::text, false);
select assert_eq((select total from public.purchase_orders where id = current_setting('test.po')::uuid), 5433.75, '150 × 34.5 + 5% VAT');
select assert_eq((select sales_order_line_id::text from public.purchase_order_lines where purchase_order_id = current_setting('test.po')::uuid),
                 current_setting('test.sol'), 'PO line linked to customer order line');
-- A second PO for the same requisition line can't exceed what is left.
select expect_error(format($$select public.save_purchase_order(jsonb_build_object('supplier_id', %L, 'warehouse_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'),
   'qty', 1, 'unit_cost', 34.5, 'requisition_line_id', %L))))$$, current_setting('test.gcs'), current_setting('test.main'), current_setting('test.rl')),
  'only 0');
select assert_eq(public.submit_purchase_order(current_setting('test.po')::uuid)::text, 'approved', 'under AED 25k → approved directly');
select assert_eq((select qty_ordered from public.purchase_requisition_lines where id = current_setting('test.rl')::uuid), 150.000, 'requisition ordered');
select assert_eq((select status from public.purchase_requisitions r join public.purchase_requisition_lines l on l.requisition_id = r.id
                   where l.id = current_setting('test.rl')::uuid), 'ordered', 'requisition status ordered');
select assert_eq((select procurement_status from public.sales_order_lines where id = current_setting('test.sol')::uuid), 'ordered', 'SO line shows ordered');
select assert_eq((select incoming_qty from public.v_product_inventory where sku = 'CBL-4C-16'), 150.000, 'incoming includes open PO');
select expect_error($$update public.purchase_order_lines set unit_cost = 1$$, 'permission denied');
select public.mark_purchase_order_sent(current_setting('test.po')::uuid);

-- =============================================================================
-- 4. Receiving against the PO (partial, over-receipt blocked, final)
-- =============================================================================
select test_as('wh1@smp.test');
select expect_error(format($$select public.save_goods_receipt(jsonb_build_object('warehouse_id', %L, 'purchase_order_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 160,
   'purchase_order_line_id', (select id from public.purchase_order_lines where purchase_order_id = %L::uuid)))))$$,
  current_setting('test.main'), current_setting('test.po'), current_setting('test.po')), 'only 150.000 still');
select set_config('test.grn1', public.save_goods_receipt(jsonb_build_object('warehouse_id', current_setting('test.main'),
  'purchase_order_id', current_setting('test.po'), 'supplier_reference', 'EWI-DN-77',
  'lines', jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 100,
     'unit_cost', 1, 'purchase_order_line_id', (select id from public.purchase_order_lines where purchase_order_id = current_setting('test.po')::uuid)))))::text, false);
select assert_eq((select unit_cost from public.goods_receipt_lines where goods_receipt_id = current_setting('test.grn1')::uuid), 34.5000, 'PO cost used, not typed cost');
-- A second draft can't take more than the 50 left after the first draft.
select expect_error(format($$select public.save_goods_receipt(jsonb_build_object('warehouse_id', %L, 'purchase_order_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 60,
   'purchase_order_line_id', (select id from public.purchase_order_lines where purchase_order_id = %L::uuid)))))$$,
  current_setting('test.main'), current_setting('test.po'), current_setting('test.po')), 'only 50.000 still');
select public.post_goods_receipt(current_setting('test.grn1')::uuid);
select assert_eq((select status::text from public.purchase_orders where id = current_setting('test.po')::uuid), 'partially_received', 'PO partially received');
select assert_eq((select qty_received || '/' || stock_status from public.sales_order_lines where id = current_setting('test.sol')::uuid),
                 '100.000/partially_reserved', 'SO line: 100 received and reserved');
select assert_eq((select incoming_qty from public.v_product_inventory where sku = 'CBL-4C-16'), 50.000, 'incoming reduced');

select test_as('proc@smp.test');
select expect_error(format('select public.cancel_purchase_order(%L, %L)', current_setting('test.po'), 'changed mind'), 'already been received');

select test_as('wh1@smp.test');
select set_config('test.grn2', public.save_goods_receipt(jsonb_build_object('warehouse_id', current_setting('test.main'),
  'purchase_order_id', current_setting('test.po'),
  'lines', jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 50,
     'purchase_order_line_id', (select id from public.purchase_order_lines where purchase_order_id = current_setting('test.po')::uuid)))))::text, false);
select public.post_goods_receipt(current_setting('test.grn2')::uuid);
select assert_eq((select status::text from public.purchase_orders where id = current_setting('test.po')::uuid), 'received', 'PO fully received');
select assert_eq((select stock_status from public.sales_order_lines where id = current_setting('test.sol')::uuid), 'reserved', 'SO line fully reserved');
select assert_eq((select coalesce(incoming_qty, 0) from public.v_product_inventory where sku = 'CBL-4C-16'), 0.000, 'nothing incoming');

-- =============================================================================
-- 5. Large PO needs approval by someone else; cancel before receipt
-- =============================================================================
select test_as('buyer@smp.test');
select set_config('test.po2', public.save_purchase_order(jsonb_build_object('supplier_id', current_setting('test.gcs'),
  'warehouse_id', current_setting('test.main'),
  'lines', jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 1000, 'unit_cost', 35))))::text, false);
select assert_eq(public.submit_purchase_order(current_setting('test.po2')::uuid)::text, 'pending_approval', 'AED 36,750 → approval');
select expect_error($$select public.decide_approval((select id from public.approval_requests where doc_id = current_setting('test.po2')::uuid and status = 'pending'), true)$$,
                    'do not have permission');
select assert_eq((select coalesce(incoming_qty, 0) from public.v_product_inventory where sku = 'CBL-4C-16'), 0.000, 'pending PO not incoming');
select test_as('proc@smp.test');
select public.decide_approval((select id from public.approval_requests where doc_id = current_setting('test.po2')::uuid and status = 'pending'), true, 'Stock up for Q1');
select assert_eq((select status::text || ':' || (approved_by is not null)::text from public.purchase_orders where id = current_setting('test.po2')::uuid),
                 'approved:true', 'approved by manager');
select assert_eq((select incoming_qty from public.v_product_inventory where sku = 'CBL-4C-16'), 1000.000, 'approved PO incoming');
select expect_error(format('select public.cancel_purchase_order(%L, %L)', current_setting('test.po2'), ''), 'reason');
select public.cancel_purchase_order(current_setting('test.po2')::uuid, 'Supplier price increased');
select assert_eq((select coalesce(incoming_qty, 0) from public.v_product_inventory where sku = 'CBL-4C-16'), 0.000, 'cancelled PO not incoming');

-- Close a PO short: the remaining quantity goes back to the requisition.
select test_as('buyer@smp.test');
select set_config('test.req3', public.create_requisition(jsonb_build_object('lines', jsonb_build_array(
  jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 20))))::text, false);
select set_config('test.po3', public.save_purchase_order(jsonb_build_object('supplier_id', current_setting('test.gcs'),
  'warehouse_id', current_setting('test.main'), 'lines', jsonb_build_array(jsonb_build_object(
    'product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 20, 'unit_cost', 35,
    'requisition_line_id', (select id from public.purchase_requisition_lines where requisition_id = current_setting('test.req3')::uuid)))))::text, false);
select public.submit_purchase_order(current_setting('test.po3')::uuid);
select test_as('wh1@smp.test');
select public.post_goods_receipt(public.save_goods_receipt(jsonb_build_object('warehouse_id', current_setting('test.main'),
  'purchase_order_id', current_setting('test.po3'), 'lines', jsonb_build_array(jsonb_build_object(
    'product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 12,
    'purchase_order_line_id', (select id from public.purchase_order_lines where purchase_order_id = current_setting('test.po3')::uuid))))));
select test_as('proc@smp.test');
select public.close_purchase_order(current_setting('test.po3')::uuid, 'Supplier out of stock');
select assert_eq((select status from public.purchase_requisitions where id = current_setting('test.req3')::uuid), 'partially_ordered', 'requisition reopened for 8');
select assert_eq((select qty_open from public.v_open_requisition_lines where requisition_id = current_setting('test.req3')::uuid), 8.000, '8 left to buy');

-- Visibility: sales cannot see purchase orders; warehouse can.
select test_as('sales@smp.test');
select assert_eq((select count(*) from public.purchase_orders)::int, 0, 'sales sees no POs');
select test_as('wh1@smp.test');
select assert_eq((select count(*) from public.purchase_orders)::int >= 3, true, 'warehouse sees POs');

reset role;
select assert_eq((select count(*) from public.stock_levels sl
                   where sl.qty_reserved <> (select coalesce(sum(qty), 0) from public.stock_reservations r
                                             where r.product_id = sl.product_id and r.warehouse_id = sl.warehouse_id and r.status = 'active'))::int,
                 0, 'reserved = active reservations');
select 'ALL PROCUREMENT TESTS PASSED' as result;
