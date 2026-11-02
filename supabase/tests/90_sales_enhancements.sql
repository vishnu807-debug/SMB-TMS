-- =============================================================================
-- Bulk import, quotation documents, new products on quotations, customer
-- confirmation and catalogue promotion (after 10–80).
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
reset role;

-- =============================================================================
-- 1. Customer import
-- =============================================================================
select test_as('sales@smp.test');
select set_config('test.rows', $j$[
  {"name":"Gulf Pump Traders LLC","trn":"100555666700003","email":"info@gulfpump.ae","phone":"+971 4 222 1111",
   "contact_name":"Sameer Khan","contact_email":"sameer@gulfpump.ae","contact_mobile":"050 123 4567",
   "address_line1":"Warehouse 7, Al Qusais 2","city":"Dubai","emirate":"Dubai","payment_terms":"Net 30"},
  {"name":"","email":"no-name@x.ae"},
  {"name":"Bad Data Co","trn":"123","email":"not-an-email","vat_registered":"maybe"},
  {"name":"Emirates Building Systems L.L.C."},
  {"name":"Gulf Pump Traders","email":"other@gulfpump.ae"},
  {"name":"Desert Rose Contracting","phone":"04-2221111"},
  {"name":"Credit Seeker LLC","credit_limit":"5,000"},
  {"name":"Al Noor Hospital Supplies","customer_type":"Government","city":"Abu Dhabi"},
  {"name":"Palm Facilities Management","customer_type":"Company","email":"ops@palmfm.ae","vat_registered":"no"}
]$j$, false);
do $$
declare res jsonb; st text[];
begin
  res := public.import_customers(current_setting('test.rows')::jsonb, false);
  select array_agg(x->>'status' order by (x->>'row')::int) into st from jsonb_array_elements(res->'rows') x;
  perform assert_eq(st, array['ready','error','error','duplicate','duplicate','duplicate','error','error','ready'], 'customer preview statuses');
  perform assert_eq((select count(*) from public.customers where name like 'Gulf Pump%')::int, 0, 'preview creates nothing');
  perform assert_eq((res->'rows'->2->'messages')::text like '%15 digits%' and (res->'rows'->2->'messages')::text like '%Email address%', true, 'all row errors listed');
  perform assert_eq((res->'rows'->3->'messages'->>0) like 'Already exists as CUS-%', true, 'existing customer by name');
  perform assert_eq((res->'rows'->4->'messages'->>0) like '%row 1%', true, 'duplicate inside the file');
  perform assert_eq((res->'rows'->5->'messages'->>0) ilike '%same phone%', true, 'duplicate by phone');
  perform assert_eq((res->'rows'->6->'messages'->>0) like '%credit limits%', true, 'credit limit needs permission');
  perform assert_eq((res->'rows'->7->'messages'->>0) like '%Address line 1%', true, 'incomplete address');

  res := public.import_customers(current_setting('test.rows')::jsonb, true, 'customers.xlsx', '00000000-0000-0000-0000-0000000000c1');
  perform assert_eq((select count(*) from jsonb_array_elements(res->'rows') x where x->>'status' = 'imported')::int, 2, 'two customers imported');
  perform assert_eq((select rows_imported || '/' || rows_failed from public.import_batches where id = (res->>'batch_id')::uuid), '2/7', 'batch counts');
  perform assert_eq((select count(*) from public.customer_contacts cc join public.customers c on c.id = cc.customer_id where c.name = 'Gulf Pump Traders LLC')::int, 1, 'contact created');
  perform assert_eq((select count(*) from public.customer_addresses a join public.customers c on c.id = a.customer_id where c.name = 'Gulf Pump Traders LLC')::int, 1, 'address created');
  perform assert_eq((select account_manager_id from public.customers where name = 'Palm Facilities Management'), auth.uid(), 'importer is the account manager');
  perform assert_eq((select import_batch_id is not null from public.customers where name = 'Palm Facilities Management'), true, 'batch recorded');
end $$;
select expect_error($$select public.import_customers(current_setting('test.rows')::jsonb, true, 'customers.xlsx', '00000000-0000-0000-0000-0000000000c1')$$, 'already been imported');
-- Re-importing the same file finds the new customers as duplicates.
select assert_eq((select count(*) from jsonb_array_elements(public.import_customers(current_setting('test.rows')::jsonb, false)->'rows') x
                   where x->>'status' = 'ready')::int, 0, 'second import finds duplicates');
select test_as('logi@smp.test');
select expect_error($$select public.import_customers('[{"name":"X Co"}]'::jsonb, false)$$, 'permission');

-- =============================================================================
-- 2. Enquiry import with customer mapping
-- =============================================================================
select test_as('sales@smp.test');
select set_config('test.leads', $j$[
  {"title":"Submersible pumps for basement","customer_code":"__GULF__","source":"Email","priority":"High","estimated_value":"18,500","expected_close_date":"2026-12-31"},
  {"title":"Pump spares annual contract","company_name":"Gulf Pump Traders LLC","source":"walk in","probability":"60%"},
  {"title":"Fire pump set","company_name":"Marina Towers Owners Association","contact_name":"Lina","contact_email":"lina@mtoa.ae"},
  {"title":"Fire pump spares","company_name":"Marina Towers Owners Association"},
  {"title":"x","company_name":"Somebody","source":"carrier pigeon","priority":"urgent","probability":"150"},
  {"title":"Pump spares annual contract","company_name":"Gulf Pump Traders LLC"},
  {"title":"Cooling tower fans","customer_code":"CUS-99999"}
]$j$, false);
select set_config('test.leads', replace(current_setting('test.leads'), '__GULF__', (select code from public.customers where name = 'Gulf Pump Traders LLC')), false);
do $$
declare res jsonb; st text[];
begin
  res := public.import_leads(current_setting('test.leads')::jsonb, false);
  select array_agg(x->>'status' order by (x->>'row')::int) into st from jsonb_array_elements(res->'rows') x;
  perform assert_eq(st, array['ready','ready','unmatched','unmatched','error','duplicate','unmatched'], 'enquiry preview statuses');
  perform assert_eq(res->'rows'->0->>'customer' like 'CUS-% Gulf Pump Traders LLC', true, 'matched by code');
  perform assert_eq(res->'rows'->1->>'customer' like '%Gulf Pump Traders LLC', true, 'matched by name');
  perform assert_eq((res->'rows'->4->'messages')::text like '%Source%' and (res->'rows'->4->'messages')::text like '%Priority%'
                    and (res->'rows'->4->'messages')::text like '%Probability%' and (res->'rows'->4->'messages')::text like '%Title%', true, 'enquiry errors');
end $$;
-- Resolve: create Marina Towers once for rows 3 and 4, skip the unknown code.
select set_config('test.leads2', (
  select jsonb_agg(case
    when x->>'company_name' = 'Marina Towers Owners Association' then x || '{"customer_resolution":"create"}'
    when x->>'customer_code' = 'CUS-99999' then x || '{"customer_resolution":"skip"}'
    else x end order by o)
  from jsonb_array_elements(current_setting('test.leads')::jsonb) with ordinality t(x, o))::text, false);
do $$
declare res jsonb; st text[];
begin
  res := public.import_leads(current_setting('test.leads2')::jsonb, true, 'enquiries.csv', '00000000-0000-0000-0000-0000000000e1');
  select array_agg(x->>'status' order by (x->>'row')::int) into st from jsonb_array_elements(res->'rows') x;
  perform assert_eq(st, array['imported','imported','imported','imported','error','duplicate','skipped'], 'enquiry import statuses');
  perform assert_eq((select count(*) from public.customers where name = 'Marina Towers Owners Association')::int, 1, 'new customer created once');
  perform assert_eq((select count(*) from public.leads l join public.customers c on c.id = l.customer_id where c.name = 'Marina Towers Owners Association')::int, 2, 'both enquiries linked');
  perform assert_eq((select source::text || '/' || priority::text from public.leads where title = 'Submersible pumps for basement'), 'email/high', 'source and priority mapped');
  perform assert_eq((select probability from public.leads where title = 'Pump spares annual contract'), 60::smallint, 'probability parsed');
end $$;
-- Prospect without a customer record, and linking to a chosen customer.
select public.import_leads(jsonb_build_array(
  jsonb_build_object('title', 'Chiller maintenance', 'company_name', 'Unknown Prospect FZE', 'customer_resolution', 'prospect'),
  jsonb_build_object('title', 'Valve replacement', 'company_name', 'GPT', 'customer_resolution', 'link',
                     'customer_id', (select id from public.customers where name = 'Gulf Pump Traders LLC'))), true, 'p.csv', gen_random_uuid());
select assert_eq((select customer_id is null and company_name = 'Unknown Prospect FZE' from public.leads where title = 'Chiller maintenance'), true, 'prospect kept');
select assert_eq((select c.name from public.leads l join public.customers c on c.id = l.customer_id where l.title = 'Valve replacement'), 'Gulf Pump Traders LLC', 'linked by choice');
-- Another sales executive cannot link to a customer they cannot see.
select test_as('sales2@smp.test');
select assert_eq(public.import_leads(jsonb_build_array(jsonb_build_object('title', 'Snoop', 'customer_resolution', 'link',
  'customer_id', (select id from public.customers where name = 'Palm Facilities Management' union all select null limit 1))), false)->'rows'->0->>'status', 'error', 'cannot link invisible customer');

-- =============================================================================
-- 3. Quotation with a catalogue product and a new (quotation-only) product
-- =============================================================================
select test_as('sales@smp.test');
do $$
declare v uuid; v_pcs uuid := (select id from public.units_of_measure where code = 'PCS'); v_set uuid := (select id from public.units_of_measure where code = 'SET');
begin
  v := public.save_quotation(jsonb_build_object(
    'customer_id', (select id from public.customers where name = 'Gulf Pump Traders LLC'),
    'subject', 'Pumps and cables',
    'lines', jsonb_build_array(
      jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 10, 'unit_price', 80, 'description', 'Power cable'),
      jsonb_build_object('quote_product', jsonb_build_object('name', 'Grundfos SP 17-8 submersible pump', 'brand', 'Grundfos',
          'model_no', 'SP17-8', 'description', '4" submersible borehole pump', 'uom_id', v_set,
          'technical_specs', jsonb_build_array(jsonb_build_object('name', 'Flow', 'value', '17 m3/h'), jsonb_build_object('name', 'Power', 'value', '5.5 kW'), jsonb_build_object('name', '', 'value', 'dropped'))),
        'description', 'Grundfos SP 17-8 submersible pump, 5.5 kW', 'qty', 2, 'unit_price', 14500, 'discount_pct', 5),
      jsonb_build_object('quote_product', jsonb_build_object('name', 'Pump control panel', 'uom_id', v_pcs), 'qty', 2, 'unit_price', 3200))));
  perform set_config('test.q', v::text, false);
  perform assert_eq((select count(*) from public.quotation_lines where quotation_id = v and product_id is null)::int, 2, 'two new-product lines');
  perform assert_eq((select jsonb_array_length(technical_specs) from public.quote_products where name like 'Grundfos%'), 2, 'blank spec dropped');
  perform assert_eq((select fulfilment_mode::text from public.quotation_lines where quotation_id = v and line_no = 2), 'procure', 'new products are procured');
  perform assert_eq((select total from public.quotations where id = v), round((800 + 27550 + 6400) * 1.05, 2), 'totals include new products');
  perform assert_eq((select count(*) from public.products where name like 'Grundfos%')::int, 0, 'not in the catalogue');
end $$;
-- Editing the draft keeps the same new-product record; removing a line discards its record.
do $$
declare v uuid := current_setting('test.q')::uuid; v_qp uuid := (select id from public.quote_products where name like 'Grundfos%');
begin
  perform public.save_quotation((select jsonb_build_object('id', v, 'customer_id', customer_id, 'lines', jsonb_build_array(
    jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 10, 'unit_price', 80),
    jsonb_build_object('quote_product', jsonb_build_object('id', v_qp, 'name', 'Grundfos SP 17-8 submersible pump', 'brand', 'Grundfos', 'model_no', 'SP17-8',
      'uom_id', (select id from public.units_of_measure where code = 'SET')), 'qty', 2, 'unit_price', 14500, 'discount_pct', 5)))
    from public.quotations where id = v));
  perform assert_eq((select quote_product_id from public.quotation_lines where quotation_id = v and line_no = 2), v_qp, 'same record kept');
  perform assert_eq((select count(*) from public.quote_products where quotation_id = v)::int, 1, 'removed new product discarded');
end $$;
select expect_error(format($$select public.save_quotation(jsonb_build_object('id', %L, 'customer_id', (select id from public.customers where name = 'Gulf Pump Traders LLC'),
  'lines', jsonb_build_array(jsonb_build_object('quote_product', jsonb_build_object('id', gen_random_uuid(), 'name', 'Hijack', 'uom_id', (select id from public.units_of_measure where code = 'PCS')), 'qty', 1, 'unit_price', 1))))$$,
  current_setting('test.q')), 'does not belong');
select expect_error(format($$select public.save_quotation(jsonb_build_object('customer_id', (select id from public.customers where name = 'Gulf Pump Traders LLC'),
  'lines', jsonb_build_array(jsonb_build_object('quote_product', jsonb_build_object('name', 'No unit'), 'qty', 1, 'unit_price', 1))))$$), 'unit of measurement');
select expect_error($$select public.save_quotation(jsonb_build_object('customer_id', (select id from public.customers where name = 'Gulf Pump Traders LLC'),
  'lines', jsonb_build_array(jsonb_build_object('qty', 1, 'unit_price', 1))))$$, 'select a product or enter a new product');

-- Other sales executives see neither the new product nor its documents.
select test_as('sales2@smp.test');
select assert_eq((select count(*) from public.quote_products where name like 'Grundfos%')::int, 0, 'hidden from other rep');

-- =============================================================================
-- 4. Documents
-- =============================================================================
select test_as('proc@smp.test');
insert into public.product_attachments(product_id, kind, file_name, storage_path, mime_type, size_bytes)
select id, 'datasheet', 'cable-datasheet.pdf', 'products/' || id || '/cable-datasheet.pdf', 'application/pdf', 1000 from public.products where sku = 'CBL-4C-16';
select test_as('sales@smp.test');
do $$
declare v uuid := current_setting('test.q')::uuid; v_qp uuid := (select id from public.quote_products where name like 'Grundfos%'); d uuid;
begin
  perform public.add_quotation_document(jsonb_build_object('quotation_id', v, 'kind', 'supporting', 'storage_path', 'quotations/' || v || '/compliance.pdf',
    'file_name', 'compliance.pdf', 'mime_type', 'application/pdf', 'size_bytes', 2048));
  perform public.add_quotation_document(jsonb_build_object('quotation_id', v, 'kind', 'datasheet', 'quote_product_id', v_qp,
    'storage_path', 'quotations/' || v || '/sp17-8.pdf', 'file_name', 'SP17-8 datasheet.pdf', 'mime_type', 'application/pdf', 'size_bytes', 4096));
  d := public.add_quotation_document(jsonb_build_object('quotation_id', v,
    'product_attachment_id', (select a.id from public.product_attachments a join public.products p on p.id = a.product_id where p.sku = 'CBL-4C-16')));
  perform assert_eq((select kind || ':' || (product_id is not null)::text from public.quotation_documents where id = d), 'datasheet:true', 'catalogue datasheet reused');
  perform assert_eq((select count(*) from public.quotation_documents where quotation_id = v)::int, 3, 'three documents');
end $$;
select expect_error(format($$select public.add_quotation_document(jsonb_build_object('quotation_id', %1$L, 'storage_path', 'quotations/%1$s/x.exe', 'file_name', 'x.exe', 'mime_type', 'application/x-msdownload', 'size_bytes', 10))$$, current_setting('test.q')), 'PDF, DOC and DOCX');
select expect_error(format($$select public.add_quotation_document(jsonb_build_object('quotation_id', %L, 'storage_path', 'quotations/00000000-0000-0000-0000-000000000000/a.pdf', 'file_name', 'a.pdf', 'mime_type', 'application/pdf', 'size_bytes', 10))$$, current_setting('test.q')), 'Upload the file again');
select expect_error(format($$select public.add_quotation_document(jsonb_build_object('quotation_id', %L,
  'product_attachment_id', (select a.id from public.product_attachments a join public.products p on p.id = a.product_id where p.sku = 'CBL-4C-16')))$$, current_setting('test.q')), 'already attached');
select public.set_quotation_document_shared((select id from public.quotation_documents where file_name = 'compliance.pdf'), false);
select assert_eq((select include_in_share from public.quotation_documents where file_name = 'compliance.pdf'), false, 'excluded from customer package');
select test_as('sales2@smp.test');
select assert_eq((select count(*) from public.quotation_documents where quotation_id = current_setting('test.q')::uuid)::int, 0, 'documents hidden from other rep');
select expect_error(format($$select public.remove_quotation_document((select id from public.quotation_documents limit 1))$$), 'not found');

-- =============================================================================
-- 5. Promotion is impossible before the customer confirms
-- =============================================================================
select test_as('proc@smp.test');
select assert_eq((select count(*) from public.v_pending_quote_products)::int, 0, 'nothing pending while unconfirmed');
select expect_error(format($$select public.promote_quote_product((select id from public.quote_products where name like 'Grundfos%%'), '{"action":"create"}')$$), 'after the customer has confirmed');

select test_as('sales@smp.test');
do $$
declare v uuid := current_setting('test.q')::uuid; s text;
begin
  s := public.submit_quotation(v)::text;
  if s = 'pending_approval' then
    perform test_as('md@smp.test');
    perform public.decide_approval((select id from public.approval_requests where doc_id = v and status = 'pending'), true, 'ok');
    perform test_as('sales@smp.test');
  end if;
  perform public.set_quotation_status(v, 'sent');
end $$;
-- Converting now is refused: the new product is not in the catalogue.
select expect_error(format($$select public.convert_quotation_to_order(%L)$$, current_setting('test.q')), 'New products must be added');
-- Confirmation needs a method, a PO number for POs, and a sensible date.
select expect_error(format($$select public.record_customer_confirmation(%L, '{}')$$, current_setting('test.q')), 'how the customer confirmed');
select expect_error(format($$select public.record_customer_confirmation(%L, '{"method":"purchase_order"}')$$, current_setting('test.q')), 'purchase order number');
select expect_error(format($$select public.record_customer_confirmation(%L, jsonb_build_object('method', 'email', 'date', current_date + 1))$$, current_setting('test.q')), 'future');
select public.record_customer_confirmation(current_setting('test.q')::uuid, '{"method":"purchase_order","reference":"GPT-PO-7781","note":"Signed PO received by email"}');
select assert_eq((select status::text || '/' || confirmation_reference || '/' || (confirmation_recorded_by = auth.uid())::text from public.quotations where id = current_setting('test.q')::uuid),
                 'accepted/GPT-PO-7781/true', 'confirmation recorded');
select expect_error(format($$select public.record_customer_confirmation(%L, '{"method":"email"}')$$, current_setting('test.q')), 'Only approved or sent');
-- Sales cannot promote (no product.edit).
select expect_error(format($$select public.promote_quote_product((select id from public.quote_products where name like 'Grundfos%%'), '{"action":"create"}')$$), 'permission');

-- =============================================================================
-- 6. Review by the catalogue maintainer
-- =============================================================================
select test_as('proc@smp.test');
select assert_eq((select count(*) from public.v_pending_quote_products where quotation_id = current_setting('test.q')::uuid)::int, 1, 'pending for review');
select assert_eq((select count(*) from public.notifications n join public.profiles p on p.id = n.user_id
                   where p.email = 'proc@smp.test' and n.title = 'New products to review')::int >= 1, true, 'reviewer notified');
select assert_eq((select count(*) from public.quotation_documents where quote_product_id = (select id from public.quote_products where name like 'Grundfos%'))::int, 1, 'reviewer sees the datasheet');
-- A catalogue product with the same model already exists → creating is blocked; linking is offered.
do $$
declare v_pid uuid;
begin
  v_pid := public.save_product(jsonb_build_object('sku', 'PMP-SP17', 'name', 'Grundfos borehole pump', 'model_no', 'sp17-8',
    'uom_id', (select id from public.units_of_measure where code = 'SET'), 'item_type', 'stock'));
  perform set_config('test.existing', v_pid::text, false);
end $$;
select assert_eq((select match_reason from public.find_product_matches((select id from public.quote_products where name like 'Grundfos%')) where sku = 'PMP-SP17'), 'Same model / SKU', 'match found');
select expect_error(format($$select public.promote_quote_product((select id from public.quote_products where name like 'Grundfos%%'), '{"action":"create"}')$$), 'Link this item');
select public.promote_quote_product((select id from public.quote_products where name like 'Grundfos%'),
  jsonb_build_object('action', 'link', 'product_id', current_setting('test.existing'), 'note', 'Same pump as PMP-SP17'));
select assert_eq((select status || '/' || (decided_by = auth.uid())::text from public.quote_products where name like 'Grundfos%'), 'linked/true', 'linked with audit');
-- Promotion cannot happen twice.
select expect_error(format($$select public.promote_quote_product((select id from public.quote_products where name like 'Grundfos%%'), jsonb_build_object('action', 'link', 'product_id', %L))$$, current_setting('test.existing')), 'already been added');
reset role;
select expect_error($$update public.quote_products set status = 'proposed', product_id = null, decided_at = null where name like 'Grundfos%'$$, 'already been added');

-- The quotation line keeps its own description and price.
select test_as('sales@smp.test');
select assert_eq((select description || ' @ ' || unit_price from public.quotation_lines where quotation_id = current_setting('test.q')::uuid and line_no = 2),
                 'Grundfos SP 17-8 submersible pump @ 14500.00', 'quoted text and price preserved');
select assert_eq((select product_id::text from public.quotation_lines where quotation_id = current_setting('test.q')::uuid and line_no = 2), current_setting('test.existing'), 'line linked to catalogue');

-- A second confirmed quotation: create a new catalogue product.
do $$
declare v uuid; s text;
begin
  v := public.save_quotation(jsonb_build_object(
    'customer_id', (select id from public.customers where name = 'Gulf Pump Traders LLC'),
    'lines', jsonb_build_array(jsonb_build_object('quote_product', jsonb_build_object('name', 'Lowara e-SV 10SV07 vertical pump', 'brand', 'Lowara',
      'model_no', '10SV07F030T', 'uom_id', (select id from public.units_of_measure where code = 'PCS'),
      'technical_specs', jsonb_build_array(jsonb_build_object('name', 'Stages', 'value', '7'))), 'qty', 1, 'unit_price', 9900))));
  perform set_config('test.q2', v::text, false);
  s := public.submit_quotation(v)::text;
  if s = 'pending_approval' then
    perform test_as('md@smp.test');
    perform public.decide_approval((select id from public.approval_requests where doc_id = v and status = 'pending'), true, 'ok');
    perform test_as('sales@smp.test');
  end if;
  perform public.record_customer_confirmation(v, '{"method":"email","reference":"Email 12 Nov"}');
end $$;
select test_as('proc@smp.test');
select expect_error(format($$select public.promote_quote_product((select id from public.quote_products where name like 'Lowara%%'), '{"action":"create","item_type":"gadget"}')$$), 'item type');
select set_config('test.newp', public.promote_quote_product((select id from public.quote_products where name like 'Lowara%'),
  '{"action":"create","item_type":"non_stock"}')::text, false);
select assert_eq((select p.name || '|' || p.model_no || '|' || b.name || '|' || p.item_type::text || '|' || p.default_sell_price || '|' || jsonb_array_length(p.technical_specs)
                   from public.products p join public.brands b on b.id = p.brand_id where p.id = current_setting('test.newp')::uuid),
                 'Lowara e-SV 10SV07 vertical pump|10SV07F030T|Lowara|non_stock|9900.00|1', 'catalogue product created from the quotation');
select assert_eq((select status from public.quote_products where name like 'Lowara%'), 'added', 'marked added');
reset role;
select assert_eq((select changed_by = (select id from public.profiles where email = 'proc@smp.test') from public.audit_log
                   where table_name = 'products' and record_id = current_setting('test.newp')::uuid and action = 'INSERT'), true, 'audit trail: who added it');
select assert_eq((select changed_by = (select id from public.profiles where email = 'sales@smp.test') from public.audit_log
                   where table_name = 'quote_products' and action = 'INSERT' and new_data->>'name' like 'Lowara%'), true, 'audit trail: who created it');

-- Both quotations now convert to sales orders.
select test_as('sales@smp.test');
select set_config('test.so', public.convert_quotation_to_order(current_setting('test.q')::uuid)::text, false);
select assert_eq((select count(*) from public.sales_order_lines where sales_order_id = current_setting('test.so')::uuid)::int, 2, 'first order created');
select assert_eq((select customer_po_ref from public.sales_orders where quotation_id = current_setting('test.q')::uuid), 'GPT-PO-7781', 'PO reference carried over');
select public.convert_quotation_to_order(current_setting('test.q2')::uuid);

-- =============================================================================
-- 7. Revisions copy new products and documents; existing quotations unaffected
-- =============================================================================
do $$
declare v uuid; v2 uuid; s text;
begin
  v := public.save_quotation(jsonb_build_object(
    'customer_id', (select id from public.customers where name = 'Gulf Pump Traders LLC'),
    'lines', jsonb_build_array(jsonb_build_object('quote_product', jsonb_build_object('name', 'Pressure vessel 300L',
      'uom_id', (select id from public.units_of_measure where code = 'PCS')), 'qty', 1, 'unit_price', 2500))));
  perform public.add_quotation_document(jsonb_build_object('quotation_id', v, 'kind', 'datasheet',
    'quote_product_id', (select id from public.quote_products where quotation_id = v),
    'storage_path', 'quotations/' || v || '/vessel.pdf', 'file_name', 'vessel.pdf', 'mime_type', 'application/pdf', 'size_bytes', 100));
  s := public.submit_quotation(v)::text;
  if s = 'pending_approval' then
    perform test_as('md@smp.test');
    perform public.decide_approval((select id from public.approval_requests where doc_id = v and status = 'pending'), true, 'ok');
    perform test_as('sales@smp.test');
  end if;
  v2 := public.revise_quotation(v);
  perform assert_eq((select count(*) from public.quote_products where quotation_id = v2)::int, 1, 'revision has its own new product');
  perform assert_eq((select quote_product_id from public.quotation_documents where quotation_id = v2) =
                    (select id from public.quote_products where quotation_id = v2), true, 'document follows the copy');
  perform assert_eq((select storage_path from public.quotation_documents where quotation_id = v2), 'quotations/' || v || '/vessel.pdf', 'file shared');
  -- Removing it from the new revision keeps the file (still used by the old revision).
  perform assert_eq(public.remove_quotation_document((select id from public.quotation_documents where quotation_id = v2)), null::text, 'file still in use');
end $$;
select assert_eq((select count(*) from public.quotation_lines where product_id is null and quote_product_id is null)::int, 0, 'every line has an item');

-- Removing items from a draft: reused catalogue files drop off, uploaded files stay as general documents.
do $$
declare v uuid; v_cust uuid := (select id from public.customers where name = 'Gulf Pump Traders LLC');
begin
  v := public.save_quotation(jsonb_build_object('customer_id', v_cust, 'lines', jsonb_build_array(
    jsonb_build_object('product_id', (select id from public.products where sku = 'CBL-4C-16'), 'qty', 1, 'unit_price', 90, 'description', 'Cable'),
    jsonb_build_object('quote_product', jsonb_build_object('name', 'Float switch', 'uom_id', (select id from public.units_of_measure where code = 'PCS')), 'qty', 1, 'unit_price', 50))));
  perform public.add_quotation_document(jsonb_build_object('quotation_id', v,
    'product_attachment_id', (select a.id from public.product_attachments a join public.products p on p.id = a.product_id where p.sku = 'CBL-4C-16')));
  perform public.add_quotation_document(jsonb_build_object('quotation_id', v, 'kind', 'datasheet', 'product_id', (select id from public.products where sku = 'CBL-4C-16'),
    'storage_path', 'quotations/' || v || '/cable-test.pdf', 'file_name', 'cable-test.pdf', 'mime_type', 'application/pdf', 'size_bytes', 100));
  perform public.add_quotation_document(jsonb_build_object('quotation_id', v, 'kind', 'datasheet', 'quote_product_id', (select id from public.quote_products where quotation_id = v),
    'storage_path', 'quotations/' || v || '/float.pdf', 'file_name', 'float.pdf', 'mime_type', 'application/pdf', 'size_bytes', 100));
  perform public.save_quotation(jsonb_build_object('id', v, 'customer_id', v_cust, 'lines', jsonb_build_array(
    jsonb_build_object('product_id', (select id from public.products where sku = 'HLM-3M-H700'), 'qty', 1, 'unit_price', 20, 'description', 'Helmet'))));
  perform assert_eq((select string_agg(file_name || ':' || coalesce(product_id::text, 'general') || ':' || coalesce(quote_product_id::text, '-'), ',' order by file_name)
                     from public.quotation_documents where quotation_id = v), 'cable-test.pdf:general:-,float.pdf:general:-', 'uploaded files kept as general documents');
end $$;

select 'ALL SALES ENHANCEMENT TESTS PASSED' as result;
