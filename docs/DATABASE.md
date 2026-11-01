# Database reference

Migrations run in file order. Gaps in the numbering are reserved for modules still to come.

| File | Contents |
| --- | --- |
| `0001_foundation` | Profiles, roles, permissions, `has_permission()`, reference tables, document numbering, audit log, notifications |
| `0002_master_data` | Customers, suppliers, products, stock engine (balances, ledger, posting function) |
| `0003_access_and_reference_data` | Departments, 12 roles, permission catalogue, role mapping, currencies, VAT, terms, units, numbering series |
| `0004_sales_schema` | Enquiries, activities, approvals, quotations, sales orders, reservations, purchase requisitions |
| `0005_products_inventory` | Product master extensions, category tree, attachments, warehouses, GRN, issues, transfers, adjustments, views |
| `0007_sales_functions` | Customer, enquiry, quotation and sales order workflows |
| `0008_sales_crm_support` | Quoting defaults (cost hidden by role), customer credit summary, reopen enquiry; locks down cost-revealing helpers |
| `0012_security` | Row Level Security policies and grants |
| `0013_dashboards` | Sales dashboard function |
| `0014_user_management` | Per-user permission grants/denies, session revocation, auth events, user admin functions |
| `0018_modules` | Licensed modules: `system_modules`, permission-to-module map, `set_module_enabled()` (backend only); e-invoicing becomes a module |
| `0017_finance` | Bank accounts, invoices & credit notes, receipts, supplier bills (three-way match), supplier payments, expenses, e-invoicing queue, VAT summary |
| `0016_logistics` | Shipments, delivery notes, dispatch from reservations, proof of delivery, order fulfilment roll-up |
| `0015_procurement` | Supplier contacts, supplier quotations, purchase orders with approval, receiving against POs, incoming stock from POs |

## Products

| Table / view | Purpose |
| --- | --- |
| `products` | Item master: SKU, name, type (stock / non-stock / service), category, brand, UoM, description, technical specs (JSON list), default supplier, preferred currency, purchase and selling price, VAT category, minimum stock level, reorder qty, image, active flag. Written only through `save_product()`. |
| `product_categories` | Unlimited-depth tree (`parent_id`). A trigger blocks cycles; names are unique per parent. |
| `v_product_categories` | The tree with full path ("Electrical › Cables › Power"), depth and product counts. |
| `brands` | Brand list. |
| `units_of_measure` | PCS, MTR, ROLL, etc. |
| `tax_codes` | VAT categories: standard 5 %, zero-rated, exempt, out of scope. |
| `supplier_products` | Supplier price list per product (cost data — restricted). Kept in step with the product's default supplier. |
| `product_attachments` | Datasheets, certificates, manuals and drawings stored in the private `product-media` bucket. |

## Inventory

| Table / view | Purpose |
| --- | --- |
| `warehouses` | Storage locations. Cannot be deactivated while holding stock. |
| `stock_levels` | Current balance per product per warehouse: physical, reserved, available (generated), weighted average cost, value. A cache of the ledger — never edited directly. |
| `stock_movements` | The permanent ledger. One row per change: receipt, issue, transfer in/out, adjustment, opening, return, reserve, release. Records the quantities after the movement, cost, source document and who authorised negative stock. |
| `stock_reservations` | Stock set aside for a sales order line. One active row per order line and warehouse. |
| `goods_receipts` / `goods_receipt_lines` | Goods received notes. Posting adds stock at purchase cost (converted to AED) and, for back-to-back lines, reserves it for the customer order. |
| `goods_issues` / `goods_issue_lines` | Non-sales outflows: internal use, samples, returns to supplier. |
| `stock_transfers` / `stock_transfer_lines` | Two-step transfers: dispatch (leaves source) then receive (arrives at destination at the same cost). In-transit quantities count as incoming. |
| `stock_adjustments` / `stock_adjustment_lines` | The only way to correct a balance: by a ± change or a physical count. Requires approval by another person; approval posts it. |
| `v_inventory_position` | Product × warehouse: physical, reserved, available, incoming, average cost and value (cost columns only with valuation permission). |
| `v_product_inventory` | Product totals across warehouses plus the below-minimum flag. |
| `v_stock_movements` | Movement history with cost columns hidden from users without valuation permission. |
| `v_stock_incoming` | Incoming stock: transfers in transit plus the undelivered quantity on approved purchase orders. |

### Key functions
`save_product`, `set_product_active`, `delete_product_category`, `save_goods_receipt` / `post_goods_receipt`,
`save_goods_issue` / `post_goods_issue`, `save_stock_transfer` / `dispatch_stock_transfer` / `receive_stock_transfer`,
`save_stock_adjustment` / `submit_stock_adjustment` (+ `decide_approval`), `cancel_inventory_document`,
`reserve_stock_for_order_line`, `release_stock_reservation`, `inventory_valuation`, `notify_low_stock`.
Internal helpers (`stock_post_movement`, `stock_reserve`, `stock_release`, `stock_adjustment_apply`) cannot be called through the API.

## Sales & CRM

| Table | Purpose |
| --- | --- |
| `customers` | Customer master: code, company details, TRN/VAT, currency, payment & delivery terms, credit limit, sales rep, status. Written through `save_customer()`. |
| `customer_contacts` / `customer_addresses` | People and billing/delivery addresses per customer (one primary contact, one default address per kind). |
| `leads` / `lead_items` | Enquiries with requirement text and lines, value, probability, stage, owner. |
| `activities` | Calls, meetings, emails, site visits, follow-ups and notes linked to an enquiry, customer, quotation or order. |
| `quotations` / `quotation_lines` | Quotations and revisions. Line amounts, VAT and header totals are computed by the database. |
| `quotation_line_costs` | Internal unit cost per line — only visible with `quotation.view_cost`. |
| `approval_rules` / `approval_requests` | Configurable thresholds and the approval trail for quotations, orders and stock adjustments. |
| `sales_orders` / `sales_order_lines` | Orders converted from quotations. Each line has its fulfilment mode and generated stock, procurement and delivery statuses driven by its quantity counters. |
| `sales_order_line_costs` | Internal cost per order line (for margin). |
| `purchase_requisitions` / `purchase_requisition_lines` | Raised automatically for procure lines on confirmation; worked by procurement. |

## Procurement

| Table / view | Purpose |
| --- | --- |
| `suppliers` / `supplier_contacts` | Supplier master (code SUP-…, TRN, licence, category, address, bank details, currency, terms, lead time, status) and its people. Written through `save_supplier()`. |
| `purchase_requisitions` / `purchase_requisition_lines` | What needs buying: raised automatically for customer orders, from minimum stock levels (`create_reorder_requisition`) or by hand (`create_requisition`). `qty_ordered` counts approved PO quantities. |
| `supplier_quotations` / `supplier_quotation_lines` | Prices received from suppliers, usually against a requisition so they can be compared. Selecting one rejects the others and updates the supplier price list. |
| `purchase_orders` / `purchase_order_lines` | Orders to suppliers: draft → pending approval (above AED 25,000, configurable) → approved → sent → partially received → received, or closed short / cancelled. Totals are computed by the database; lines are frozen after draft. Each line tracks `qty_received` and `qty_billed`. |
| `v_open_requisition_lines` | Requisition lines still to be ordered, with customer order and suggested supplier. |

Receiving: a goods receipt against a PO takes its cost and currency from the PO, cannot exceed the outstanding
quantity (other draft receipts included), updates the PO status and, for customer-order items, marks the sales
order line received and reserves the stock for it.

### Key functions
`save_supplier`, `create_requisition`, `create_reorder_requisition`, `cancel_requisition_line`, `save_supplier_quotation`,
`select_supplier_quotation`, `save_purchase_order`, `submit_purchase_order` (+ `decide_approval`), `reopen_purchase_order`,
`mark_purchase_order_sent`, `cancel_purchase_order`, `close_purchase_order`, `save_goods_receipt` / `post_goods_receipt`.

## Logistics

| Table / view | Purpose |
| --- | --- |
| `delivery_notes` / `delivery_note_lines` | Deliveries against a confirmed sales order from one warehouse. Draft → dispatched (stock issued) → delivered (proof of delivery: received by, time, remarks, signed note in the private `delivery-pod` bucket); only drafts can be cancelled. Lines track `qty_invoiced` for invoicing. |
| `shipments` | A vehicle / courier trip carrying several delivery notes. Dispatching the shipment dispatches its notes; it completes when every note is delivered. |
| `v_deliverable_lines` | Order lines still to deliver, with the quantity reserved per warehouse and ready now. |

Dispatch rules: a delivery can only take stock **reserved for that order line in that warehouse** (non-stock items
excepted). Dispatch consumes the reservation and posts an `issue` movement that reduces on-hand and reserved
together, increases the order line's `qty_delivered`, and rolls the order up to *partially fulfilled* / *fulfilled*.

### Key functions
`save_delivery_note`, `dispatch_delivery_note`, `confirm_delivery`, `cancel_delivery_note`, `save_shipment`,
`dispatch_shipment`, `cancel_shipment`.

## Finance

| Table / view | Purpose |
| --- | --- |
| `bank_accounts` | Bank, cash and card accounts payments go in and out of. |
| `customer_invoices` / `customer_invoice_lines` | Tax invoices and tax credit notes (`kind`). Drafts have no number; posting assigns the next gap-free number (INV / CN), sets the due date from the payment terms and locks the document. Lines delivered on a delivery note keep the sales order price; extra charge lines can be added. Snapshots of customer name, TRN and address are kept as printed. `balance = total − paid − credited`. |
| `einvoice_transmissions` | One row per attempt to send an invoice to the e-invoicing service provider (ASP), with status, reference, response and back-off. |
| `customer_payments` / `customer_payment_allocations` | Receipts (transfer, cheque, PDC, cash, card) and how they are applied to invoices; partial and advance payments supported. Voiding (e.g. bounced cheque) reverses the allocations. |
| `supplier_bills` / `supplier_bill_lines` | Supplier tax invoices. Lines on a PO cannot exceed goods received and not yet billed (three-way match, enforced again by `qty_billed ≤ qty_received` on the PO line). Price variance against the PO above 2 %, or a bill with no PO, needs approval. Duplicate supplier invoice numbers are blocked. |
| `supplier_payments` / `supplier_payment_allocations` | Payments to suppliers against approved bills. |
| `expense_categories` / `expenses` | Staff expense claims with VAT (vendor TRN required to reclaim), receipt upload, approval by someone else, and payment. |
| `v_receivables` / `v_payables` | Open items with days overdue and ageing bucket (current, 1–30, 31–60, 61–90, 90+). |
| `v_uninvoiced_deliveries` | Delivered quantities not yet invoiced, per order and delivery note. |

Rules: invoices are raised from **delivered** quantities only and can never exceed them (drafts included). An invoice can
be voided only while unpaid, uncredited and not yet reported through e-invoicing; otherwise a credit note is issued.
The customer credit position now counts unpaid invoices plus the uninvoiced value of open orders.

### Key functions
`create_invoice_from_deliveries`, `save_invoice_draft`, `post_invoice`, `void_invoice`, `create_credit_note`, `retry_einvoice`,
`record_customer_payment`, `allocate_customer_payment`, `void_customer_payment`, `save_supplier_bill`, `submit_supplier_bill`,
`void_supplier_bill`, `record_supplier_payment`, `void_supplier_payment`, `save_expense`, `submit_expense`, `mark_expense_paid`,
`vat_summary`. Server-only (service role): `einvoice_claim_batch`, `einvoice_record_result`, `einvoice_document`.

## Licensed modules

| Table / function | Purpose |
| --- | --- |
| `system_modules` | One row per module (core, sales, inventory, procurement, logistics, finance, einvoicing) with on/off, dependencies and when it last changed. Read-only for app users. |
| `permissions.modules` | The module(s) each permission belongs to. `has_permission()` refuses permissions whose modules are all off — for every user, including the Super Administrator — so RLS, functions and menus follow automatically. |
| `set_module_enabled(code, on, note)` | Backend only (SQL editor / service role); refuses calls from signed-in app users and checks dependencies. |
| `module_enabled(code)`, `require_module(code)`, `enabled_modules()` | Checks used by functions and the app. |
