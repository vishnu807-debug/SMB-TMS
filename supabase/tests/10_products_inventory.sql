-- =============================================================================
-- Product master & inventory — behaviour tests (run by tests/run.sh).
-- Each block runs as a specific user through RLS, the way the app does.
-- Any failed assertion raises and stops the run.
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- ---------- test helpers ----------------------------------------------------
create or replace function test_as(p_email text) returns void language plpgsql as $$
declare v uuid;
begin
  reset role;
  select id into v from auth.users where email = p_email;
  if v is null then raise exception 'no such test user %', p_email; end if;
  perform set_config('request.jwt.claim.sub', v::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'iat', extract(epoch from now())::bigint)::text, false);
  execute 'set role authenticated';
end $$;
grant execute on function test_as(text) to authenticated;

create or replace function expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not ilike '%' || p_like || '%' then
      raise exception 'expected error like "%" but got: %', p_like, sqlerrm;
    end if;
    return;
  end;
  raise exception 'expected error like "%" but statement succeeded: %', p_like, p_sql;
end $$;
grant execute on function expect_error(text, text) to authenticated;

create or replace function assert_eq(p_actual anyelement, p_expected anyelement, p_what text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERT % — expected %, got %', p_what, p_expected, p_actual;
  end if;
end $$;
grant execute on function assert_eq(anyelement, anyelement, text) to authenticated;

-- ---------- users -------------------------------------------------------------
insert into auth.users (email, raw_user_meta_data) values
  ('admin@smp.test',   '{"full_name":"Super Admin"}'),
  ('md@smp.test',      '{"full_name":"Managing Director"}'),
  ('proc@smp.test',    '{"full_name":"Procurement Manager"}'),
  ('wh1@smp.test',     '{"full_name":"Warehouse Manager One"}'),
  ('wh2@smp.test',     '{"full_name":"Warehouse Manager Two"}'),
  ('sales@smp.test',   '{"full_name":"Sales Executive"}'),
  ('salesmgr@smp.test','{"full_name":"Sales Manager"}'),
  ('logi@smp.test',    '{"full_name":"Logistics Executive"}');
insert into public.user_roles (user_id, role_id)
select p.id, r.id from public.profiles p join public.roles r on r.code = case p.email
  when 'admin@smp.test' then 'super_admin' when 'md@smp.test' then 'managing_director'
  when 'proc@smp.test' then 'procurement_manager' when 'wh1@smp.test' then 'warehouse_manager'
  when 'wh2@smp.test' then 'warehouse_manager' when 'sales@smp.test' then 'sales_executive'
  when 'salesmgr@smp.test' then 'sales_manager' when 'logi@smp.test' then 'logistics_executive' end;

-- Second warehouse for transfers.
insert into public.warehouses (code, name) values ('JAFZA', 'Jebel Ali Free Zone Store');

-- =============================================================================
-- 1. Categories: unlimited depth, no cycles, unique per parent
-- =============================================================================
select test_as('proc@smp.test');
insert into public.product_categories (name) values ('Electrical');
insert into public.product_categories (name, parent_id) select 'Cables', id from public.product_categories where name = 'Electrical';
insert into public.product_categories (name, parent_id) select 'Power Cables', id from public.product_categories where name = 'Cables';
insert into public.product_categories (name, parent_id) select 'Data Cables', id from public.product_categories where name = 'Cables';
insert into public.product_categories (name) values ('Safety Equipment');
select assert_eq((select full_path from public.v_product_categories where name = 'Power Cables'),
                 'Electrical › Cables › Power Cables', 'category full path');
select assert_eq((select depth from public.v_product_categories where name = 'Power Cables'), 2, 'category depth');
select expect_error($$update public.product_categories set parent_id = (select id from public.product_categories where name = 'Power Cables')
                      where name = 'Electrical'$$, 'cannot be moved under itself');
select expect_error($$insert into public.product_categories (name, parent_id) select 'cables', parent_id from public.product_categories where name = 'Cables'$$,
                    'duplicate key');
-- Sales cannot manage categories.
select test_as('sales@smp.test');
select expect_error($$insert into public.product_categories (name) values ('Rogue')$$, 'row-level security');

-- =============================================================================
-- 2. Product master
-- =============================================================================
select test_as('admin@smp.test');
insert into public.brands (name) values ('Ducab'), ('3M');
insert into public.suppliers (name, currency_code, lead_time_days) values ('Gulf Cable Supplies LLC', 'AED', 5), ('Global Safety Trading', 'USD', 21);

select test_as('proc@smp.test');
do $$
declare
  v_pcs uuid := (select id from public.units_of_measure where code = 'PCS');
  v_mtr uuid := (select id from public.units_of_measure where code = 'MTR');
  v_a uuid; v_b uuid; v_c uuid;
begin
  v_a := public.save_product(jsonb_build_object(
    'sku', 'CBL-4C-16', 'name', 'Power cable 4C x 16mm²', 'item_type', 'stock',
    'category_id', (select id from public.product_categories where name = 'Power Cables'),
    'brand_id', (select id from public.brands where name = 'Ducab'), 'uom_id', v_mtr,
    'description', 'Armoured copper power cable', 'currency_code', 'AED',
    'purchase_price', 38.50, 'default_sell_price', 52.00, 'min_stock_level', 20,
    'default_supplier_id', (select id from public.suppliers where name = 'Gulf Cable Supplies LLC'),
    'technical_specs', '[{"name":"Cores","value":"4"},{"name":"Size","value":"16 mm²"},{"name":"","value":"dropped"}]'::jsonb));
  v_b := public.save_product(jsonb_build_object(
    'sku', 'HLM-3M-H700', 'name', 'Safety helmet 3M H-700', 'item_type', 'stock', 'uom_id', v_pcs,
    'category_id', (select id from public.product_categories where name = 'Safety Equipment'),
    'brand_id', (select id from public.brands where name = '3M'), 'currency_code', 'USD',
    'purchase_price', 9.00, 'default_sell_price', 14.00, 'min_stock_level', 0,
    'default_supplier_id', (select id from public.suppliers where name = 'Global Safety Trading')));
  v_c := public.save_product(jsonb_build_object(
    'name', 'Cat6 data cable 305m', 'item_type', 'stock', 'uom_id', (select id from public.units_of_measure where code = 'ROLL'),
    'category_id', (select id from public.product_categories where name = 'Data Cables'),
    'currency_code', 'AED', 'purchase_price', 210, 'default_sell_price', 295, 'min_stock_level', 10));
  perform assert_eq((select jsonb_array_length(technical_specs) from public.products where id = v_a), 2, 'blank spec dropped');
  perform assert_eq((select sku from public.products where id = v_c), 'ITM-000001', 'automatic SKU');
  perform assert_eq((select is_preferred from public.supplier_products where product_id = v_a), true, 'default supplier price list');
end $$;
select expect_error($$select public.save_product(('{"sku":"CBL-4C-16","name":"Duplicate","uom_id":"' ||
                     (select id from public.units_of_measure where code='PCS') || '"}')::jsonb)$$, 'already used');
select expect_error($$select public.save_product(('{"sku":"bad sku!","name":"x y","uom_id":"' ||
                     (select id from public.units_of_measure where code='PCS') || '"}')::jsonb)$$, 'SKU may contain');
-- Direct writes are blocked; products change only through save_product.
select expect_error($$update public.products set default_sell_price = 1$$, 'permission denied');

-- Sales can read products but not purchase prices via the supplier list.
select test_as('sales@smp.test');
select assert_eq((select count(*) from public.products)::int, 3, 'sales sees products');
select assert_eq((select count(*) from public.supplier_products)::int, 0, 'sales cannot see supplier pricing');
select expect_error($$select public.save_product('{"name":"x y"}'::jsonb)$$, 'do not have permission');

-- =============================================================================
-- 3. Opening stock through an approved adjustment (no direct edits)
-- =============================================================================
select test_as('wh1@smp.test');
select expect_error($$update public.stock_levels set qty_on_hand = 999$$, 'permission denied');
select expect_error($$insert into public.stock_movements(product_id, warehouse_id, movement_type, qty, on_hand_change,
                      on_hand_after, reserved_after, avg_cost_after, source_type)
                      select id, (select id from public.warehouses where code='MAIN'), 'receipt', 1, 1, 1, 0, 0, 'x'
                      from public.products limit 1$$, 'permission denied');

do $$
declare v_adj uuid;
begin
  v_adj := public.save_stock_adjustment(jsonb_build_object(
    'warehouse_id', (select id from public.warehouses where code = 'MAIN'), 'reason', 'opening_balance',
    'lines', jsonb_build_array(
      jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'mode', 'count', 'counted_qty', 100, 'unit_cost_base', 38.50),
      jsonb_build_object('product_id', (select id from public.products where sku = 'ITM-000001'), 'mode', 'count', 'counted_qty', 8, 'unit_cost_base', 210))));
  perform public.submit_stock_adjustment(v_adj);
  perform assert_eq((select status from public.stock_adjustments where id = v_adj), 'submitted', 'adjustment submitted');
  perform assert_eq((select count(*) from public.stock_movements)::int, 0, 'nothing posted before approval');
end $$;
-- Preparer cannot approve their own adjustment.
select expect_error($$select public.decide_approval((select id from public.approval_requests where doc_type='stock_adjustment' and status='pending'), true)$$,
                    'cannot approve your own');

select test_as('wh2@smp.test');
select public.decide_approval((select id from public.approval_requests where doc_type = 'stock_adjustment' and status = 'pending'), true, 'Count sheet checked');
select assert_eq((select physical_qty from public.v_inventory_position where sku = 'CBL-4C-16' and warehouse_code = 'MAIN'), 100.000, 'opening stock A');
select assert_eq((select avg_cost from public.v_inventory_position where sku = 'CBL-4C-16' and warehouse_code = 'MAIN'), 38.5000, 'opening avg cost');
select assert_eq((select movement_type::text from public.v_stock_movements where sku = 'CBL-4C-16'), 'opening', 'opening movement');

-- =============================================================================
-- 4. Goods received (weighted average cost, foreign currency)
-- =============================================================================
select test_as('wh1@smp.test');
do $$
declare v_grn uuid;
begin
  v_grn := public.save_goods_receipt(jsonb_build_object(
    'warehouse_id', (select id from public.warehouses where code = 'MAIN'),
    'supplier_id', (select id from public.suppliers where name = 'Gulf Cable Supplies LLC'),
    'supplier_reference', 'DN-7781', 'currency_code', 'AED',
    'lines', jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'),
                                                  'qty', 100, 'unit_cost', 41.50))));
  perform public.post_goods_receipt(v_grn);
  perform expect_error(format('select public.post_goods_receipt(%L)', v_grn), 'already posted');
  -- (100 × 38.50 + 100 × 41.50) / 200 = 40.00
  perform assert_eq((select avg_cost from public.v_inventory_position where sku = 'CBL-4C-16' and warehouse_code = 'MAIN'), 40.0000, 'weighted average');
  perform assert_eq((select physical_qty from public.v_inventory_position where sku = 'CBL-4C-16' and warehouse_code = 'MAIN'), 200.000, 'qty after GRN');
  perform expect_error(format('update public.goods_receipt_lines set qty = 1 where goods_receipt_id = %L', v_grn), 'permission denied');
end $$;

-- =============================================================================
-- 5. Goods issue: never negative unless management authorises it
-- =============================================================================
do $$
declare v_gi uuid;
begin
  v_gi := public.save_goods_issue(jsonb_build_object(
    'warehouse_id', (select id from public.warehouses where code = 'MAIN'), 'issue_type', 'internal_use',
    'issued_to', 'Workshop', 'lines', jsonb_build_array(jsonb_build_object(
      'product_id', (select id from public.products where sku = 'ITM-000001'), 'qty', 10))));
  perform expect_error(format('select public.post_goods_issue(%L)', v_gi), 'insufficient stock');
  -- Warehouse manager cannot authorise negative stock.
  perform expect_error($q$select public.save_goods_issue(jsonb_build_object('warehouse_id',
      (select id from public.warehouses where code = 'MAIN'), 'issue_type', 'sample', 'allow_negative', true,
      'negative_reason', 'urgent', 'lines', '[{"product_id":"00000000-0000-0000-0000-000000000000","qty":1}]'::jsonb))$q$,
    'Only management');
end $$;

select test_as('admin@smp.test');
do $$
declare v_gi uuid;
begin
  v_gi := public.save_goods_issue(jsonb_build_object(
    'warehouse_id', (select id from public.warehouses where code = 'MAIN'), 'issue_type', 'sample',
    'issued_to', 'Customer trial', 'allow_negative', true, 'negative_reason', 'Stock count pending; MD approved by phone',
    'lines', jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where sku = 'ITM-000001'), 'qty', 10))));
  perform public.post_goods_issue(v_gi);
  perform assert_eq((select physical_qty from public.v_inventory_position where sku = 'ITM-000001' and warehouse_code = 'MAIN'), -2.000, 'authorised negative');
  perform assert_eq((select negative_authorised_by is not null from public.v_stock_movements
                      where sku = 'ITM-000001' and movement_type = 'issue'), true, 'negative authoriser recorded');
end $$;
-- Bring it back with a receipt: the new receipt cost becomes the average when stock was negative.
do $$
declare v_grn uuid;
begin
  v_grn := public.save_goods_receipt(jsonb_build_object('warehouse_id', (select id from public.warehouses where code = 'MAIN'),
    'currency_code', 'AED', 'lines', jsonb_build_array(jsonb_build_object(
      'product_id', (select id from public.products where sku = 'ITM-000001'), 'qty', 10, 'unit_cost', 215))));
  perform public.post_goods_receipt(v_grn);
  perform assert_eq((select physical_qty from public.v_inventory_position where sku = 'ITM-000001' and warehouse_code = 'MAIN'), 8.000, 'recovered from negative');
end $$;

-- =============================================================================
-- 6. Mixed sales order: A from stock, B to procure, C partly in stock
-- =============================================================================
select test_as('sales@smp.test');
do $$
declare
  v_cust uuid; v_q uuid; v_so uuid;
begin
  v_cust := public.save_customer(jsonb_build_object('name', 'Al Noor Contracting LLC', 'currency_code', 'AED'));
  v_q := public.save_quotation(jsonb_build_object('customer_id', v_cust, 'lines', jsonb_build_array(
    jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 50, 'unit_price', 52, 'fulfilment_mode', 'stock'),
    jsonb_build_object('product_id', (select id from public.products where sku = 'HLM-3M-H700'), 'qty', 40, 'unit_price', 52, 'fulfilment_mode', 'procure'),
    jsonb_build_object('product_id', (select id from public.products where sku = 'ITM-000001'), 'qty', 20, 'unit_price', 295, 'fulfilment_mode', 'stock'))));
  perform public.submit_quotation(v_q);
  v_so := public.convert_quotation_to_order(v_q, 'PO-ALN-551');
  perform public.confirm_sales_order(v_so);
  perform set_config('test.so', v_so::text, false);
end $$;

select test_as('wh1@smp.test');
-- A: 50 reserved out of 200 → 150 available.
select assert_eq((select reserved_qty from public.v_inventory_position where sku = 'CBL-4C-16' and warehouse_code = 'MAIN'), 50.000, 'A reserved');
select assert_eq((select available_qty from public.v_inventory_position where sku = 'CBL-4C-16' and warehouse_code = 'MAIN'), 150.000, 'A available');
-- C: 8 in stock reserved; 12 split into a procure line.
select assert_eq((select available_qty from public.v_inventory_position where sku = 'ITM-000001' and warehouse_code = 'MAIN'), 0.000, 'C fully reserved');
select assert_eq((select string_agg(fulfilment_mode || ':' || qty::int || ':' || stock_status, ',' order by line_no)
                    from public.sales_order_lines where sales_order_id = current_setting('test.so')::uuid),
                 'stock:50:reserved,procure:40:awaiting_receipt,stock:8:reserved,procure:12:awaiting_receipt', 'line plan A/B/C');
select assert_eq((select count(*) from public.purchase_requisition_lines rl join public.purchase_requisitions r on r.id = rl.requisition_id
                   where r.sales_order_id = current_setting('test.so')::uuid)::int, 2, 'requisition for B and C shortfall');

-- Reserved stock cannot be issued, transferred or counted away.
do $$
declare v_gi uuid; v_tr uuid; v_adj uuid;
begin
  v_gi := public.save_goods_issue(jsonb_build_object('warehouse_id', (select id from public.warehouses where code = 'MAIN'),
    'issue_type', 'internal_use', 'lines', jsonb_build_array(jsonb_build_object(
      'product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 151))));
  perform expect_error(format('select public.post_goods_issue(%L)', v_gi), 'reserved for customer orders');
  v_tr := public.save_stock_transfer(jsonb_build_object('from_warehouse_id', (select id from public.warehouses where code = 'MAIN'),
    'to_warehouse_id', (select id from public.warehouses where code = 'JAFZA'), 'lines', jsonb_build_array(jsonb_build_object(
      'product_id', (select id from public.products where sku = 'ITM-000001'), 'qty', 1))));
  perform expect_error(format('select public.dispatch_stock_transfer(%L)', v_tr), 'reserved for customer orders');
  perform public.cancel_inventory_document('stock_transfer', v_tr);
end $$;

-- Back-to-back receipt for B and C's procure line: goods are reserved for the order at once.
do $$
declare v_grn uuid; v_so uuid := current_setting('test.so')::uuid;
begin
  v_grn := public.save_goods_receipt(jsonb_build_object(
    'warehouse_id', (select id from public.warehouses where code = 'MAIN'),
    'supplier_id', (select id from public.suppliers where name = 'Global Safety Trading'),
    'currency_code', 'USD', 'lines', jsonb_build_array(
      jsonb_build_object('product_id', (select id from public.products where sku = 'HLM-3M-H700'), 'qty', 40, 'unit_cost', 9,
        'sales_order_line_id', (select id from public.sales_order_lines where sales_order_id = v_so and line_no = 2)),
      jsonb_build_object('product_id', (select id from public.products where sku = 'ITM-000001'), 'qty', 12, 'unit_cost', 57.50,
        'sales_order_line_id', (select id from public.sales_order_lines where sales_order_id = v_so and line_no = 4)))));
  perform public.post_goods_receipt(v_grn);
  perform assert_eq((select avg_cost from public.v_inventory_position where sku = 'HLM-3M-H700' and warehouse_code = 'MAIN'),
                    round(9 * 3.6725, 4), 'USD cost converted to AED');
  perform assert_eq((select string_agg(stock_status || '/' || procurement_status, ',' order by line_no)
                      from public.sales_order_lines where sales_order_id = v_so),
                    'reserved/not_required,reserved/received,reserved/not_required,reserved/received', 'all lines reserved after receipt');
  perform assert_eq((select available_qty from public.v_inventory_position where sku = 'HLM-3M-H700' and warehouse_code = 'MAIN'), 0.000, 'B fully held for order');
end $$;

-- Manual release returns stock to available and is logged as a movement.
do $$
declare v_res uuid;
begin
  select r.id into v_res from public.stock_reservations r join public.products p on p.id = r.product_id
   where p.sku = 'CBL-4C-16' and r.status = 'active';
  perform public.release_stock_reservation(v_res, 10, 'Customer reduced quantity by phone');
  perform assert_eq((select available_qty from public.v_inventory_position where sku = 'CBL-4C-16' and warehouse_code = 'MAIN'), 160.000, 'release → available');
  perform assert_eq((select count(*) from public.v_stock_movements where sku = 'CBL-4C-16' and movement_type = 'release')::int, 1, 'release movement');
  perform expect_error(format('select public.release_stock_reservation(%L, 1000, %L)', v_res, 'x'), 'between 0');
end $$;

-- =============================================================================
-- 7. Transfers: in transit counts as incoming at the destination
-- =============================================================================
do $$
declare v_tr uuid;
begin
  v_tr := public.save_stock_transfer(jsonb_build_object('from_warehouse_id', (select id from public.warehouses where code = 'MAIN'),
    'to_warehouse_id', (select id from public.warehouses where code = 'JAFZA'), 'lines', jsonb_build_array(jsonb_build_object(
      'product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 60))));
  perform public.dispatch_stock_transfer(v_tr);
  perform assert_eq((select physical_qty from public.v_inventory_position where sku = 'CBL-4C-16' and warehouse_code = 'MAIN'), 140.000, 'source reduced');
  perform assert_eq((select incoming_qty from public.v_inventory_position where sku = 'CBL-4C-16' and warehouse_code = 'JAFZA'), 60.000, 'incoming at destination');
  perform assert_eq((select incoming_qty from public.v_product_inventory where sku = 'CBL-4C-16'), 60.000, 'incoming in product summary');
  perform public.receive_stock_transfer(v_tr);
  perform assert_eq((select physical_qty from public.v_inventory_position where sku = 'CBL-4C-16' and warehouse_code = 'JAFZA'), 60.000, 'received at destination');
  perform assert_eq((select avg_cost from public.v_inventory_position where sku = 'CBL-4C-16' and warehouse_code = 'JAFZA'), 40.0000, 'cost carried over');
  perform assert_eq((select incoming_qty from public.v_product_inventory where sku = 'CBL-4C-16'), 0.000, 'no longer incoming');
end $$;

-- =============================================================================
-- 8. Physical count adjustment can't remove reserved stock; approval posts it
-- =============================================================================
do $$
declare v_adj uuid;
begin
  v_adj := public.save_stock_adjustment(jsonb_build_object('warehouse_id', (select id from public.warehouses where code = 'MAIN'),
    'reason', 'physical_count', 'lines', jsonb_build_array(jsonb_build_object(
      'product_id', (select id from public.products where sku = 'ITM-000001'), 'mode', 'count', 'counted_qty', 15))));
  perform public.submit_stock_adjustment(v_adj);
  perform set_config('test.adj', v_adj::text, false);
end $$;
select test_as('wh2@smp.test');
select expect_error($$select public.decide_approval((select id from public.approval_requests where doc_id = current_setting('test.adj')::uuid), true)$$,
                    'reserved for customer orders');
select public.decide_approval((select id from public.approval_requests where doc_id = current_setting('test.adj')::uuid), false, 'Recount — 20 rolls are reserved');
select assert_eq((select status from public.stock_adjustments where id = current_setting('test.adj')::uuid), 'rejected', 'adjustment rejected');

-- =============================================================================
-- 9. Visibility of costs and valuation
-- =============================================================================
select test_as('sales@smp.test');
select assert_eq((select physical_qty from public.v_product_inventory where sku = 'CBL-4C-16'), 200.000, 'sales sees quantities');
select assert_eq((select stock_value from public.v_product_inventory where sku = 'CBL-4C-16'), null::numeric, 'sales cannot see valuation');
select assert_eq((select count(*) from public.v_inventory_position)::int, 0, 'sales has no warehouse detail (no inventory.view)');
select test_as('logi@smp.test');
select assert_eq((select count(*) from public.v_stock_movements)::int > 0, true, 'logistics sees movement history');
select assert_eq((select max(unit_cost) from public.v_stock_movements), null::numeric, 'logistics sees no costs');
select assert_eq((select count(*) from public.goods_receipt_lines)::int, 0, 'logistics cannot read GRN costs');
select assert_eq((select count(*) from public.stock_movements)::int, 0, 'raw ledger hidden without valuation');
select test_as('md@smp.test');
select assert_eq((select stock_value from public.v_product_inventory where sku = 'CBL-4C-16'), 8000.00, 'valuation 200 × 40.00');
select assert_eq((select sum(stock_value) from public.inventory_valuation()) > 0, true, 'warehouse valuation');

-- =============================================================================
-- 10. Ledger integrity: every balance equals the sum of its movements
-- =============================================================================
reset role;
select assert_eq((select count(*) from public.stock_levels sl
                   where sl.qty_on_hand <> (select coalesce(sum(on_hand_change), 0) from public.stock_movements m
                                             where m.product_id = sl.product_id and m.warehouse_id = sl.warehouse_id)
                      or sl.qty_reserved <> (select coalesce(sum(reserved_change), 0) from public.stock_movements m
                                             where m.product_id = sl.product_id and m.warehouse_id = sl.warehouse_id))::int,
                 0, 'balances = ledger');
-- Even the database owner cannot bypass the balance guard or rewrite history.
select expect_error($$update public.stock_levels set qty_on_hand = qty_on_hand + 1$$, 'cannot be edited directly');
select expect_error($$delete from public.stock_movements$$, 'permanent');
-- Low-stock job: C (min 10) is fully reserved → alert.
select assert_eq(public.notify_low_stock() >= 1, true, 'low stock alert raised');

select 'ALL PRODUCT & INVENTORY TESTS PASSED' as result;
