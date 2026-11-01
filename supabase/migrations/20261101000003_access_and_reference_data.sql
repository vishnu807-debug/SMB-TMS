-- =============================================================================
-- 0003 Access control & reference data
-- Departments, the 12 SMP roles, the permission catalogue for every module,
-- default role → permission mapping, and reference data (currencies, VAT,
-- terms, units, warehouse, numbering series, approval rules).
-- Everything here is editable later from System Settings / User Management.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
insert into public.departments (code, name) values
  ('MGMT', 'Management & Administration'),
  ('SALES', 'Sales & Business Development'),
  ('ACCT', 'Accounts & Finance'),
  ('LOG', 'Logistics & Operations'),
  ('PROC', 'Procurement & Purchasing'),
  ('WH', 'Inventory & Warehouse'),
  ('SUP', 'Customer Support')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
alter table public.roles add column if not exists department_id uuid references public.departments(id);
alter table public.roles add column if not exists sort_order smallint not null default 100;

insert into public.roles (code, name, description, is_system, department_id, sort_order)
select v.code, v.name, v.description, true, d.id, v.sort_order
from (values
  ('super_admin',           'Super Administrator',        'Full access to every module and setting.',                         'MGMT',  1),
  ('managing_director',     'Managing Director',          'Company-wide visibility, approvals and permission grants.',        'MGMT',  2),
  ('sales_manager',         'Sales Manager',              'Runs the sales team; approves quotations; sees margins.',          'SALES', 10),
  ('sales_executive',       'Sales Executive',            'Own enquiries, customers, quotations and orders.',                 'SALES', 11),
  ('accounts_manager',      'Accounts Manager',           'Receivables, payables, credit control and finance approvals.',     'ACCT',  20),
  ('accounts_executive',    'Accounts Executive',         'Invoices, receipts, supplier bills and expenses.',                 'ACCT',  21),
  ('logistics_manager',     'Logistics Manager',          'Deliveries and shipments; logistics reporting.',                   'LOG',   30),
  ('logistics_executive',   'Logistics Executive',        'Prepares and dispatches deliveries and shipments.',                'LOG',   31),
  ('procurement_manager',   'Procurement Manager',        'Suppliers, purchasing and PO approval; product master.',           'PROC',  40),
  ('procurement_executive', 'Procurement Executive',      'Requisitions, supplier quotes and purchase orders.',               'PROC',  41),
  ('warehouse_manager',     'Warehouse Manager',          'Stock receipts, issues, transfers and adjustment approval.',       'WH',    50),
  ('customer_support_executive', 'Customer Support Executive', 'Customer enquiries, order status and support tickets.',     'SUP',   60)
) v(code, name, description, dept, sort_order)
join public.departments d on d.code = v.dept
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Permission catalogue
-- ---------------------------------------------------------------------------
insert into public.permissions (code, module, description) values
  -- Dashboards & reports
  ('dashboard.sales', 'Dashboards', 'View the sales dashboard'),
  ('dashboard.management', 'Dashboards', 'View the management dashboard'),
  ('dashboard.finance', 'Dashboards', 'View the finance dashboard'),
  ('dashboard.operations', 'Dashboards', 'View the operations dashboard'),
  ('report.sales', 'Reports', 'Run sales reports'),
  ('report.finance', 'Reports', 'Run finance reports'),
  ('report.inventory', 'Reports', 'Run inventory reports'),
  ('report.procurement', 'Reports', 'Run procurement reports'),
  -- Customers & CRM
  ('customer.view', 'Customers', 'View customers assigned to you'),
  ('customer.view_all', 'Customers', 'View all customers'),
  ('customer.create', 'Customers', 'Create customers'),
  ('customer.edit', 'Customers', 'Edit customers'),
  ('customer.assign', 'Customers', 'Assign customers to sales representatives'),
  ('customer.set_credit', 'Customers', 'Change credit limits and hold/block customers'),
  ('lead.view', 'Leads & Enquiries', 'View your enquiries'),
  ('lead.view_all', 'Leads & Enquiries', 'View all enquiries'),
  ('lead.create', 'Leads & Enquiries', 'Register enquiries'),
  ('lead.edit', 'Leads & Enquiries', 'Edit enquiries and change stage'),
  ('lead.assign', 'Leads & Enquiries', 'Assign enquiries to other people'),
  ('activity.manage', 'Leads & Enquiries', 'Log activities and follow-ups'),
  ('activity.view_all', 'Leads & Enquiries', 'View and manage everyone''s follow-ups'),
  -- Quotations & sales orders
  ('quotation.view', 'Quotations', 'View your quotations'),
  ('quotation.view_all', 'Quotations', 'View all quotations'),
  ('quotation.create', 'Quotations', 'Create quotations and revisions'),
  ('quotation.edit', 'Quotations', 'Edit, submit and update quotation status'),
  ('quotation.approve', 'Quotations', 'Approve quotations above discount/margin limits'),
  ('quotation.view_cost', 'Quotations', 'See purchase cost, gross profit and margin on quotations'),
  ('sales_order.view', 'Sales Orders', 'View your sales orders'),
  ('sales_order.view_all', 'Sales Orders', 'View all sales orders'),
  ('sales_order.create', 'Sales Orders', 'Convert quotations to sales orders'),
  ('sales_order.edit', 'Sales Orders', 'Edit draft sales orders'),
  ('sales_order.confirm', 'Sales Orders', 'Confirm sales orders'),
  ('sales_order.approve', 'Sales Orders', 'Approve credit-limit exceptions; hold/release orders'),
  ('sales_order.cancel', 'Sales Orders', 'Cancel sales orders'),
  ('sales_order.view_cost', 'Sales Orders', 'See cost and margin on sales orders'),
  -- Suppliers & procurement
  ('supplier.view', 'Suppliers', 'View suppliers'),
  ('supplier.edit', 'Suppliers', 'Create and edit suppliers'),
  ('purchase_requisition.manage', 'Procurement', 'Work purchase requisitions'),
  ('purchase_order.view', 'Purchase Orders', 'View purchase orders'),
  ('purchase_order.create', 'Purchase Orders', 'Create purchase orders and supplier quotations'),
  ('purchase_order.approve', 'Purchase Orders', 'Approve purchase orders'),
  -- Products & inventory
  ('product.view', 'Products', 'View products and stock availability'),
  ('product.edit', 'Products', 'Create and edit products'),
  ('product.view_cost', 'Products', 'See purchase prices and supplier pricing'),
  ('category.manage', 'Products', 'Create, rename, move and delete product categories'),
  ('inventory.view', 'Inventory', 'View stock balances and movement history'),
  ('inventory.view_valuation', 'Inventory', 'See stock valuation and average cost'),
  ('inventory.receive', 'Inventory', 'Post goods received notes'),
  ('inventory.issue', 'Inventory', 'Post goods issues'),
  ('inventory.transfer', 'Inventory', 'Dispatch and receive stock transfers'),
  ('inventory.adjust', 'Inventory', 'Prepare stock adjustments'),
  ('inventory.approve_adjustment', 'Inventory', 'Approve and post stock adjustments'),
  ('inventory.reserve', 'Inventory', 'Reserve and release stock for orders manually'),
  ('inventory.allow_negative', 'Inventory', 'Authorise transactions that make stock negative'),
  ('warehouse.manage', 'Inventory', 'Create and edit warehouses'),
  ('goods_receipt.post', 'Inventory', 'Receive goods against purchase orders'),
  -- Logistics
  ('delivery.view', 'Logistics', 'View deliveries'),
  ('delivery.manage', 'Logistics', 'Prepare, dispatch and confirm deliveries'),
  ('shipment.manage', 'Logistics', 'Create and update shipments'),
  -- Finance
  ('invoice.view', 'Invoices', 'View customer invoices'),
  ('invoice.create', 'Invoices', 'Prepare customer invoices'),
  ('invoice.post', 'Invoices', 'Post (issue) customer invoices'),
  ('invoice.void', 'Invoices', 'Void unpaid invoices'),
  ('payment.view', 'Payments', 'View customer payments'),
  ('payment.record', 'Payments', 'Record and allocate customer payments'),
  ('payment.void', 'Payments', 'Void customer payments'),
  ('payable.view', 'Payables', 'View supplier bills and payments'),
  ('payable.manage', 'Payables', 'Enter supplier bills and payments'),
  ('payable.approve', 'Payables', 'Approve bill variances and supplier payments'),
  ('expense.submit', 'Expenses', 'Submit expense claims'),
  ('expense.view_all', 'Expenses', 'View all expenses'),
  ('expense.approve', 'Expenses', 'Approve expenses'),
  ('expense.pay', 'Expenses', 'Mark expenses as paid'),
  -- Approvals, support, administration
  ('approval.view', 'Approvals', 'View all approval requests'),
  ('approval.self_approve', 'Approvals', 'Approve requests you raised yourself'),
  ('ticket.view', 'Customer Support', 'View support tickets'),
  ('ticket.manage', 'Customer Support', 'Create and work support tickets'),
  ('user.view', 'User Management', 'View users and their access'),
  ('user.manage', 'User Management', 'Create, edit, deactivate users and assign roles'),
  ('user.grant_permissions', 'User Management', 'Grant or deny extra permissions to individual users'),
  ('role.manage', 'User Management', 'Change the permissions of roles'),
  ('session.manage', 'User Management', 'View and revoke other users'' sessions'),
  ('settings.manage', 'System Settings', 'Change company settings and reference data'),
  ('audit.view', 'System Settings', 'View the audit log')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Default role → permission mapping (super_admin holds everything implicitly)
-- ---------------------------------------------------------------------------
create temporary table _role_permission_map as
select * from (values
  ('managing_director', array[
    'dashboard.sales','dashboard.management','dashboard.finance','dashboard.operations',
    'report.sales','report.finance','report.inventory','report.procurement',
    'customer.view','customer.view_all','customer.assign','customer.set_credit',
    'lead.view','lead.view_all','lead.assign','activity.view_all',
    'quotation.view','quotation.view_all','quotation.approve','quotation.view_cost',
    'sales_order.view','sales_order.view_all','sales_order.approve','sales_order.cancel','sales_order.view_cost',
    'supplier.view','purchase_order.view','purchase_order.approve',
    'product.view','product.view_cost','inventory.view','inventory.view_valuation',
    'inventory.approve_adjustment','inventory.allow_negative',
    'delivery.view','invoice.view','payment.view','payable.view','payable.approve',
    'expense.view_all','expense.approve','approval.view','ticket.view',
    'user.view','user.grant_permissions','audit.view']),
  ('sales_manager', array[
    'dashboard.sales','report.sales',
    'customer.view','customer.view_all','customer.create','customer.edit','customer.assign',
    'lead.view','lead.view_all','lead.create','lead.edit','lead.assign','activity.manage','activity.view_all',
    'quotation.view','quotation.view_all','quotation.create','quotation.edit','quotation.approve','quotation.view_cost',
    'sales_order.view','sales_order.view_all','sales_order.create','sales_order.edit','sales_order.confirm',
    'sales_order.cancel','sales_order.view_cost',
    'product.view','product.view_cost','inventory.view','inventory.reserve',
    'delivery.view','invoice.view','approval.view','expense.submit','ticket.view','user.view']),
  ('sales_executive', array[
    'dashboard.sales','customer.view','customer.create','customer.edit',
    'lead.view','lead.create','lead.edit','activity.manage',
    'quotation.view','quotation.create','quotation.edit',
    'sales_order.view','sales_order.create','sales_order.edit','sales_order.confirm',
    'product.view','delivery.view','invoice.view','expense.submit','ticket.view']),
  ('accounts_manager', array[
    'dashboard.finance','report.finance','report.sales',
    'customer.view','customer.view_all','customer.edit','customer.set_credit',
    'quotation.view','quotation.view_all','quotation.view_cost',
    'sales_order.view','sales_order.view_all','sales_order.approve','sales_order.view_cost',
    'supplier.view','purchase_order.view','product.view','product.view_cost',
    'inventory.view','inventory.view_valuation','delivery.view',
    'invoice.view','invoice.create','invoice.post','invoice.void',
    'payment.view','payment.record','payment.void',
    'payable.view','payable.manage','payable.approve',
    'expense.submit','expense.view_all','expense.approve','expense.pay','approval.view']),
  ('accounts_executive', array[
    'dashboard.finance','customer.view','customer.view_all',
    'sales_order.view','sales_order.view_all','supplier.view','purchase_order.view','product.view',
    'delivery.view','invoice.view','invoice.create','payment.view','payment.record',
    'payable.view','payable.manage','expense.submit','expense.view_all']),
  ('logistics_manager', array[
    'dashboard.operations','report.inventory',
    'customer.view','customer.view_all','sales_order.view','sales_order.view_all',
    'purchase_order.view','product.view','inventory.view','inventory.transfer',
    'delivery.view','delivery.manage','shipment.manage','expense.submit']),
  ('logistics_executive', array[
    'customer.view','customer.view_all','sales_order.view','sales_order.view_all',
    'product.view','inventory.view','delivery.view','delivery.manage','shipment.manage','expense.submit']),
  ('procurement_manager', array[
    'dashboard.operations','report.procurement','report.inventory',
    'supplier.view','supplier.edit','product.view','product.edit','product.view_cost','category.manage',
    'inventory.view','inventory.view_valuation','purchase_requisition.manage',
    'purchase_order.view','purchase_order.create','purchase_order.approve',
    'sales_order.view','sales_order.view_all','payable.view','approval.view','expense.submit']),
  ('procurement_executive', array[
    'supplier.view','supplier.edit','product.view','product.edit','product.view_cost',
    'inventory.view','purchase_requisition.manage','purchase_order.view','purchase_order.create',
    'sales_order.view','sales_order.view_all','expense.submit']),
  ('warehouse_manager', array[
    'dashboard.operations','report.inventory',
    'product.view','inventory.view','inventory.view_valuation','inventory.receive','inventory.issue',
    'inventory.transfer','inventory.adjust','inventory.approve_adjustment','inventory.reserve',
    'warehouse.manage','goods_receipt.post','purchase_order.view','supplier.view',
    'sales_order.view','sales_order.view_all','delivery.view','delivery.manage','expense.submit']),
  ('customer_support_executive', array[
    'customer.view','customer.view_all','lead.view','lead.view_all','lead.create','activity.manage',
    'quotation.view','quotation.view_all','sales_order.view','sales_order.view_all',
    'product.view','delivery.view','invoice.view','ticket.view','ticket.manage'])
) m(role_code, perms);

-- Fail the migration on any misspelt role or permission code in the map.
do $$
declare v_bad text;
begin
  select string_agg(distinct x, ', ') into v_bad
  from _role_permission_map m, unnest(m.perms) x
  where not exists (select 1 from public.permissions p where p.code = x);
  if v_bad is not null then raise exception 'Unknown permission codes in role map: %', v_bad; end if;
  select string_agg(role_code, ', ') into v_bad from _role_permission_map m
  where not exists (select 1 from public.roles r where r.code = m.role_code);
  if v_bad is not null then raise exception 'Unknown role codes in role map: %', v_bad; end if;
end $$;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from _role_permission_map m
join public.roles r on r.code = m.role_code
join public.permissions p on p.code = any (m.perms)
on conflict do nothing;

drop table _role_permission_map;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
insert into public.currencies (code, name, symbol, decimals) values
  ('AED', 'UAE Dirham', 'AED', 2), ('USD', 'US Dollar', '$', 2), ('EUR', 'Euro', '€', 2),
  ('GBP', 'Pound Sterling', '£', 2), ('SAR', 'Saudi Riyal', 'SAR', 2), ('CNY', 'Chinese Yuan', '¥', 2),
  ('INR', 'Indian Rupee', '₹', 2), ('JPY', 'Japanese Yen', '¥', 0)
on conflict (code) do nothing;

-- Pegged currencies only; floating rates must be entered in Settings before use.
insert into public.exchange_rates (currency_code, rate_date, rate_to_base) values
  ('USD', date '2026-01-01', 3.672500),
  ('SAR', date '2026-01-01', 0.979333)
on conflict do nothing;

insert into public.tax_codes (code, name, rate, is_default) values
  ('SR', 'Standard rated (5%)', 5.00, true),
  ('ZR', 'Zero rated (0%)', 0.00, false),
  ('EX', 'Exempt', 0.00, false),
  ('OS', 'Out of scope', 0.00, false)
on conflict (code) do nothing;

insert into public.payment_terms (name, days, description) values
  ('Cash on delivery', 0, 'Payment on delivery'),
  ('100% advance', 0, 'Full payment before dispatch'),
  ('50% advance, balance on delivery', 0, 'Half with order, half on delivery'),
  ('Net 15', 15, '15 days from invoice date'),
  ('Net 30', 30, '30 days from invoice date'),
  ('Net 45', 45, '45 days from invoice date'),
  ('Net 60', 60, '60 days from invoice date'),
  ('Net 90', 90, '90 days from invoice date')
on conflict (name) do nothing;

insert into public.delivery_terms (code, name, description) values
  ('EXW', 'Ex Works', 'Buyer collects from our warehouse'),
  ('FCA', 'Free Carrier', 'Delivered to buyer''s carrier'),
  ('FOB', 'Free On Board', 'Loaded on vessel at port of shipment'),
  ('CFR', 'Cost and Freight', 'Freight paid to destination port'),
  ('CIF', 'Cost, Insurance and Freight', 'Freight and insurance paid to destination port'),
  ('DAP', 'Delivered At Place', 'Delivered to named place, duties unpaid'),
  ('DDP', 'Delivered Duty Paid', 'Delivered to named place, duties paid'),
  ('LOCAL', 'Local delivery (UAE)', 'Delivered to customer site within the UAE')
on conflict (code) do nothing;

insert into public.units_of_measure (code, name) values
  ('PCS', 'Pieces'), ('SET', 'Set'), ('BOX', 'Box'), ('CTN', 'Carton'), ('PKT', 'Packet'),
  ('KG', 'Kilogram'), ('MTR', 'Metre'), ('LTR', 'Litre'), ('ROLL', 'Roll'), ('LOT', 'Lot'), ('HR', 'Hour')
on conflict (code) do nothing;

insert into public.warehouses (code, name, address) values ('MAIN', 'Main Warehouse', null)
on conflict (code) do nothing;

insert into public.company_settings (id, legal_name, default_warehouse_id, quotation_terms)
select true, 'SMP General Trading LLC', w.id,
$t$1. Prices are valid until the date shown on this quotation.
2. VAT is charged at the applicable rate unless stated otherwise.
3. Delivery time starts from receipt of the customer's purchase order and any agreed advance payment.
4. Goods remain the property of SMP until paid for in full.
5. Any change in quantities may affect prices and delivery time.$t$
from public.warehouses w where w.code = 'MAIN'
on conflict (id) do nothing;

insert into public.document_sequence_templates (doc_type, prefix, yearly, padding) values
  ('customer', 'CUS', false, 5),
  ('supplier', 'SUP', false, 5),
  ('product', 'ITM', false, 6),
  ('lead', 'ENQ', true, 5),
  ('quotation', 'QT', true, 5),
  ('sales_order', 'SO', true, 5),
  ('purchase_requisition', 'PR', true, 5),
  ('supplier_quotation', 'SQ', true, 5),
  ('purchase_order', 'PO', true, 5),
  ('goods_receipt', 'GRN', true, 5),
  ('goods_issue', 'GI', true, 5),
  ('stock_transfer', 'TRF', true, 5),
  ('stock_adjustment', 'ADJ', true, 5),
  ('delivery_note', 'DN', true, 5),
  ('shipment', 'SHP', true, 5),
  ('invoice', 'INV', true, 5),
  ('credit_note', 'CN', true, 5),
  ('supplier_bill', 'BILL', true, 5),
  ('customer_payment', 'RCT', true, 5),
  ('supplier_payment', 'PAY', true, 5),
  ('expense', 'EXP', true, 5)
on conflict (doc_type) do nothing;

-- Default approval rules are seeded in 0004, where approval_rules is created.
