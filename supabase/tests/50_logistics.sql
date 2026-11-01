-- =============================================================================
-- Logistics — behaviour tests (after 10–40).
-- EBS order: line 1 = 100 m from stock (reserved), line 2 = 150 m bought on the PO
-- and reserved on receipt. Deliver in two parts, with a shipment and POD.
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
reset role;
select set_config('test.so', (select id::text from public.sales_orders where customer_po_ref = 'EBS-PO-1001'), false);
select set_config('test.l1', (select id::text from public.sales_order_lines where sales_order_id = current_setting('test.so')::uuid and fulfilment_mode = 'stock'), false);
select set_config('test.l2', (select id::text from public.sales_order_lines where sales_order_id = current_setting('test.so')::uuid and fulfilment_mode = 'procure'), false);
select set_config('test.main', (select id::text from public.warehouses where code = 'MAIN'), false);
select set_config('test.onhand', (select qty_on_hand::text from public.stock_levels sl join public.products p on p.id = sl.product_id
  where p.sku = 'CBL-4C-16' and sl.warehouse_id = current_setting('test.main')::uuid), false);
select assert_eq((select qty_ready from public.v_deliverable_lines where sales_order_line_id = current_setting('test.l1')::uuid), null::numeric, 'needs delivery.view');

-- =============================================================================
-- 1. Draft delivery notes respect reservations and what is left to deliver
-- =============================================================================
select test_as('logi@smp.test');
select assert_eq((select qty_ready from public.v_deliverable_lines where sales_order_line_id = current_setting('test.l1')::uuid), 100.000, '100 ready on line 1');
select assert_eq((select qty_ready from public.v_deliverable_lines where sales_order_line_id = current_setting('test.l2')::uuid), 150.000, '150 ready on line 2');
select expect_error(format($$select public.save_delivery_note(jsonb_build_object('sales_order_id', %L, 'warehouse_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('sales_order_line_id', %L, 'qty', 120))))$$, current_setting('test.so'), current_setting('test.main'), current_setting('test.l1')),
  'only 100.000 left');
select set_config('test.dn1', public.save_delivery_note(jsonb_build_object('sales_order_id', current_setting('test.so'), 'warehouse_id', current_setting('test.main'),
  'contact_name', 'Site store keeper', 'lines', jsonb_build_array(jsonb_build_object('sales_order_line_id', current_setting('test.l1'), 'qty', 60))))::text, false);
select assert_eq((select doc_no like 'DN-%' from public.delivery_notes where id = current_setting('test.dn1')::uuid), true, 'DN numbered');
select expect_error(format($$select public.save_delivery_note(jsonb_build_object('sales_order_id', %L, 'warehouse_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('sales_order_line_id', %L, 'qty', 50))))$$, current_setting('test.so'), current_setting('test.main'), current_setting('test.l1')),
  'only 40.000 left');
select assert_eq((select qty_ready from public.v_deliverable_lines where sales_order_line_id = current_setting('test.l1')::uuid), 40.000, 'draft note counts');
select expect_error($$update public.delivery_notes set status = 'delivered'$$, 'permission denied');

-- =============================================================================
-- 2. Shipment dispatch posts the stock issue from the reservation
-- =============================================================================
select set_config('test.shp', public.save_shipment(jsonb_build_object('mode', 'own_vehicle', 'vehicle_no', 'dxb a 12345', 'driver_name', 'Imran',
  'delivery_note_ids', jsonb_build_array(current_setting('test.dn1'))))::text, false);
select assert_eq((select vehicle_no from public.shipments where id = current_setting('test.shp')::uuid), 'DXB A 12345', 'vehicle upper-cased');
select public.dispatch_shipment(current_setting('test.shp')::uuid);
select assert_eq((select status::text from public.delivery_notes where id = current_setting('test.dn1')::uuid), 'dispatched', 'DN dispatched with shipment');
select assert_eq((select status::text from public.sales_orders where id = current_setting('test.so')::uuid), 'partially_fulfilled', 'SO partially fulfilled');
select assert_eq((select qty_delivered || '/' || qty_reserved || '/' || delivery_status from public.sales_order_lines where id = current_setting('test.l1')::uuid),
                 '60.000/40.000/partially_delivered', 'line 1: 60 delivered, 40 still reserved');
reset role;
select assert_eq((select qty_on_hand from public.stock_levels sl join public.products p on p.id = sl.product_id
  where p.sku = 'CBL-4C-16' and sl.warehouse_id = current_setting('test.main')::uuid), current_setting('test.onhand')::numeric - 60, 'on hand down 60');
select assert_eq((select qty from public.stock_reservations where sales_order_line_id = current_setting('test.l1')::uuid and status = 'active'), 40.000, 'reservation reduced');
select assert_eq((select count(*) from public.stock_movements where source_type = 'delivery_note' and reserved_change = -60 and on_hand_change = -60)::int, 1, 'issue consumed reservation');
select test_as('logi@smp.test');
select expect_error(format('select public.cancel_delivery_note(%L, %L)', current_setting('test.dn1'), 'oops'), 'Only draft');
select expect_error(format('select public.dispatch_delivery_note(%L)', current_setting('test.dn1')), 'already been dispatched');

-- Proof of delivery
select expect_error(format($$select public.confirm_delivery(%L, '{}'::jsonb)$$, current_setting('test.dn1')), 'person who received');
select public.confirm_delivery(current_setting('test.dn1')::uuid, '{"received_by_name":"Rashid (store keeper)","pod_notes":"Signed and stamped"}');
select assert_eq((select status::text from public.delivery_notes where id = current_setting('test.dn1')::uuid), 'delivered', 'delivered');
select assert_eq((select status::text from public.shipments where id = current_setting('test.shp')::uuid), 'completed', 'shipment completed when all delivered');

-- =============================================================================
-- 3. Final delivery: rest of line 1 + the back-to-back line 2
-- =============================================================================
select set_config('test.dn2', public.save_delivery_note(jsonb_build_object('sales_order_id', current_setting('test.so'), 'warehouse_id', current_setting('test.main'),
  'lines', jsonb_build_array(jsonb_build_object('sales_order_line_id', current_setting('test.l1'), 'qty', 40),
                             jsonb_build_object('sales_order_line_id', current_setting('test.l2'), 'qty', 150))))::text, false);
select public.dispatch_delivery_note(current_setting('test.dn2')::uuid);
select assert_eq((select status::text from public.sales_orders where id = current_setting('test.so')::uuid), 'fulfilled', 'SO fulfilled');
select assert_eq((select string_agg(delivery_status || ':' || stock_status, ',' order by line_no) from public.sales_order_lines where sales_order_id = current_setting('test.so')::uuid),
                 'delivered:reserved,delivered:reserved', 'both lines delivered');
select assert_eq((select count(*) from public.v_deliverable_lines where sales_order_id = current_setting('test.so')::uuid)::int, 0, 'nothing left to deliver');
select expect_error(format($$select public.save_delivery_note(jsonb_build_object('sales_order_id', %L, 'warehouse_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('sales_order_line_id', %L, 'qty', 1))))$$, current_setting('test.so'), current_setting('test.main'), current_setting('test.l1')),
  'only confirmed orders');

-- Cancel a draft note; planned shipment cancel frees its notes.
select set_config('test.shp2', public.save_shipment('{"mode":"courier","carrier_name":"Aramex"}')::text, false);
select public.cancel_shipment(current_setting('test.shp2')::uuid);
select expect_error(format('select public.dispatch_shipment(%L)', current_setting('test.shp2')), 'Only planned');

-- Sales without delivery.manage cannot create notes.
select test_as('sales@smp.test');
select expect_error(format($$select public.save_delivery_note(jsonb_build_object('sales_order_id', %L))$$, current_setting('test.so')), 'delivery.manage');

reset role;
select assert_eq((select count(*) from public.stock_levels sl
                   where sl.qty_reserved <> (select coalesce(sum(qty), 0) from public.stock_reservations r
                                             where r.product_id = sl.product_id and r.warehouse_id = sl.warehouse_id and r.status = 'active'))::int,
                 0, 'reserved = active reservations');
select 'ALL LOGISTICS TESTS PASSED' as result;
