# SMP Trading Management System

Next.js 15 + Supabase (PostgreSQL, Auth, Storage) CRM and mini-ERP for SMP General Trading.

## What is built so far

| Area | Database | Screens | Status |
| --- | --- | --- | --- |
| Foundation: roles, permissions, numbering, audit log, notifications | ✅ | Sign-in, sign-out, layout, notifications | Done |
| **Product master** (SKU, category tree, brand, specs, UoM, supplier, prices, VAT, min. stock, image, attachments, active flag) | ✅ tested | List, create/edit, detail, categories | **Done** |
| **Inventory** (multi-warehouse, GRN, issues, transfers, approved adjustments, reservations, movement history, valuation) | ✅ tested | Overview, documents, reservations, movements, warehouses | **Done** |
| **Sales & CRM** (customers, enquiries, follow-ups, quotations with PDF, sales orders, approvals, dashboard) | ✅ tested | All screens | **Done** |
| **Authentication & user management** (12 roles, per-user grants/denies, sessions, deactivation, audit) | ✅ tested | Users, roles matrix, profile, password reset, audit log | **Done** |
| **Procurement** (suppliers, requisitions, supplier quote comparison, purchase orders with approval & PDF, receiving against POs) | ✅ tested | Procurement, purchase orders, suppliers | **Done** |
| Logistics, finance | — | — | Next |

Sidebar items for unbuilt modules are shown as "Soon" and are not clickable.

## Setup

1. **Create a Supabase project** (region closest to the UAE).
2. **Apply the database migrations** with the Supabase CLI:
   ```bash
   npx supabase link --project-ref <your-ref>
   npx supabase db push          # applies supabase/migrations/* in order
   ```
3. **Environment variables** — copy `.env.example` to `.env.local` and fill in the project URL and the *anon* key.
   The service-role key is **not** needed for this module and must never be given a `NEXT_PUBLIC_` prefix.
4. **Create the first administrator.** In Supabase → Authentication → Users, invite/create the user, then in the SQL editor:
   ```sql
   insert into public.user_roles (user_id, role_id)
   select p.id, r.id from public.profiles p, public.roles r
   where p.email = 'you@smp.ae' and r.code = 'super_admin';
   ```
   Assign other staff the same way (role codes are listed below) until the User Management screen is delivered.
5. **Scheduled jobs** (Supabase → Database → Cron, or `pg_cron`):
   ```sql
   select cron.schedule('low-stock-alerts', '0 5 * * *', 'select public.notify_low_stock()');      -- 09:00 Dubai
   select cron.schedule('expire-quotations', '5 20 * * *', 'select public.expire_quotations()');   -- 00:05 Dubai
   ```
6. **Run the app**
   ```bash
   npm install
   npm run dev
   ```

### Recommended Supabase Auth settings
Disable public sign-ups (staff are invited), set minimum password length to 10+ with leaked-password protection, and set the JWT expiry to 1 hour or less.

## Sales & CRM at a glance

* **Customers** — automatic code (CUS-00001), company details, TRN with 15-digit check, VAT treatment, currency,
  payment and delivery terms, credit limit (Accounts only), assigned sales rep, multiple contacts and billing/delivery
  addresses, duplicate warnings, and a 360° page (credit position, quotations, orders, enquiries, activities).
* **Enquiries** — numbered (ENQ-2026-00001), source, requirement text and lines, value, probability, expected close,
  owner, stages new → contacted → qualified → quoted → won/lost (lost needs a reason), conversion to a customer,
  and a "Create quotation" button that copies the requirement lines.
* **Follow-ups** — calls, meetings, site visits and follow-ups on any enquiry, customer, quotation or order;
  overdue and due-today highlighting; a personal list (and team view for managers).
* **Quotations** — automatic number and revisions (QT-2026-00012-R1), all commercial fields, live totals and VAT,
  stock availability per line, suggested fulfilment, internal cost / gross profit / margin (only for roles with
  `quotation.view_cost`; costs entered by others are ignored), approval when discount > 10 %, margin < 15 % or
  total > AED 250,000 (editable rules), and a downloadable PDF (watermarked DRAFT until approved).
* **Sales orders** — created only from approved/sent/accepted quotations; draft fulfilment plan per line
  (stock / procure, warehouse); credit-limit approval; on confirmation stock is reserved, short stock lines are split
  automatically and a purchase requisition is raised; each line shows its own stock, procurement and delivery status;
  hold/release and cancel (which releases reservations and requisitions).
* **Approvals** — one list of everything waiting (quotations, orders, stock adjustments); nobody approves their own.
* **Dashboard** — sales, gross profit and margin (cost-permitted roles), win rate, pipeline, open quotations and
  orders, monthly sales chart, quotations by status, top customers, sales by rep, follow-ups due, open orders and a
  customer-activity timeline. Sales executives see only their own figures.

## Roles (seeded in migration 0003)

`super_admin`, `managing_director`, `sales_manager`, `sales_executive`, `accounts_manager`, `accounts_executive`,
`logistics_manager`, `logistics_executive`, `procurement_manager`, `procurement_executive`, `warehouse_manager`,
`customer_support_executive`. Each maps to fine-grained permissions such as `inventory.receive` or
`inventory.allow_negative`; the mapping lives in `role_permissions` and can be changed without code.

Inventory-related defaults:

| Permission | Who has it by default |
| --- | --- |
| `inventory.view`, `product.view` | Most operational roles |
| `inventory.receive`, `inventory.issue`, `inventory.transfer`, `inventory.adjust` | Warehouse Manager (transfer also Logistics Manager) |
| `inventory.approve_adjustment` | Warehouse Manager, Managing Director (never your own adjustment) |
| `inventory.allow_negative` | Managing Director only |
| `inventory.view_valuation` | MD, Accounts Manager, Procurement Manager, Warehouse Manager |
| `product.edit`, `product.view_cost` | Procurement Manager / Executive |
| `category.manage` | Procurement Manager |

## How stock is protected

* **Available = Physical − Reserved**, stored as a generated column so it can't drift.
* **Every change is a movement.** Balances (`stock_levels`) can only be changed by the posting functions,
  which always write an immutable row in `stock_movements` in the same transaction. A trigger blocks
  direct edits to balances from *any* role, including the database owner, and a deferred check at commit
  proves that each balance equals the sum of its movements.
* **No direct balance edits for users** — corrections go through a stock adjustment, which must be
  approved by someone other than the person who prepared it before it posts.
* **No negative stock** unless a holder of `inventory.allow_negative` authorises that specific document;
  the authoriser is recorded on the movement.
* **Reserved stock is protected** — it cannot be issued, transferred or adjusted away.
* **One active reservation per order line and warehouse** (unique index), so reservations can't duplicate.
* Costs and valuation are hidden from users without the relevant permission, in the database (RLS and
  views), not only in the UI.

## Security notes

* All reads go through Row Level Security; all writes go through `security definer` functions that check
  permissions themselves. Pages check permissions too (`requirePermission`), but the database is the real gate.
* The browser only ever has the anon key. File uploads go straight to the private `product-media`
  bucket, whose storage policies require `product.edit`; files are served through short-lived signed URLs.

## Tests

The database tests run against a real PostgreSQL 16 with a small Supabase stub:
```bash
PGHOST=/path/to/socket PGPORT=5432 npm run db:test
```
They cover categories, product validation, approved adjustments, weighted-average costing, negative-stock
authorisation, a mixed sales order (stock / procure / partly in stock), back-to-back receipts, transfers,
reservation release, cost visibility per role and ledger integrity — and for sales: customer validation and
duplicate checks, per-rep visibility, credit-limit changes, enquiries and follow-ups, quotation totals and VAT,
discount approval, margin visibility, revisions, conversion, credit-limit approval, hold, cancellation and the
dashboard's scope per role.

See `docs/DATABASE.md` for what each table is for.
