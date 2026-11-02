# SMP Trading Management System

CRM and mini-ERP for SMP General Trading: sales, procurement, inventory, logistics and finance in one system.
Built with **Next.js 15**, **React**, **TypeScript**, **Tailwind** and **Supabase** (PostgreSQL, Auth, Storage).

| Module | What it does |
| --- | --- |
| **Sales & CRM** | Customers (TRN check, credit limit, contacts, addresses), enquiries, follow-ups, quotations with revisions, margin control, approvals and PDF, sales orders with stock / procurement / mixed fulfilment, sales dashboard |
| **Products & inventory** | Product master, category tree, multi-warehouse stock, goods received, issues, transfers, approved adjustments, reservations, movement ledger, valuation |
| **Procurement** | Suppliers, requisitions (from orders, minimum stock or by hand), supplier quotation comparison, purchase orders with approval and PDF, receiving against POs |
| **Logistics** | Delivery notes from reserved stock (partial deliveries), shipments / vehicle trips, dispatch, proof of delivery, delivery note PDF |
| **Finance** | Tax invoices and credit notes from delivered goods, customer receipts and allocation, receivables ageing, supplier bills with three-way match, supplier payments, expense claims, bank accounts, VAT summary, **UAE e-invoicing (PINT AE) connector** |
| **Administration** | 12 roles, per-user extra/denied permissions, user management, session revocation, approvals inbox, audit log, system settings |

Every rule that protects money or stock lives **in the database** (Row Level Security + `security definer` functions),
so it holds no matter how the data is reached. The app checks permissions too, but the database is the real gate.
See [`docs/DATABASE.md`](docs/DATABASE.md) for every table and function.

---

## Hosting it: GitHub → Supabase → Vercel

You need three free accounts: **GitHub** (code — already set up at `vishnu807-debug/SMB-TMS`), **Supabase**
(database, logins, file storage) and **Vercel** (runs the website). Allow about 30 minutes.

### Step 1 — Create the Supabase project

1. Go to <https://supabase.com/dashboard> → **New project**.
2. Name: `smp-tms`. Set a strong **database password** and keep it in your password manager.
3. Region: **Frankfurt (eu-central-1)** — the closest to the UAE that Vercel also has.
4. Click **Create new project** and wait about two minutes.
5. Open **Project Settings → API Keys** and copy:
   * the **Project URL** (also on **Project Settings → Data API**),
   * the **anon / publishable** key — public, used by the browser,
   * the **service_role / secret** key — **secret**; never share it, never put it in a `NEXT_PUBLIC_` variable.

   (If you see both the new *publishable/secret* keys and *legacy* *anon/service_role* keys, either pair works.)

### Step 2 — Create the database (run the migrations)

**Option A — Supabase CLI (recommended).** On your computer, with Node.js 20 installed:

```bash
git clone https://github.com/vishnu807-debug/SMB-TMS.git
cd SMB-TMS
npm install
npx supabase login                                   # opens the browser once
npx supabase link --project-ref <your-project-ref>   # the ref is the xxxx in https://xxxx.supabase.co
npx supabase db push                                 # applies supabase/migrations/* in order
```

**Option B — no installation.** In Supabase open **SQL Editor → New query**, then paste and **Run** each file in
`supabase/migrations/` **one at a time, in filename order** (`…0001_foundation.sql` first, `…0017_finance.sql` last).
Every file must finish with "Success" before you run the next one.

Then switch off any modules the client has not taken (see *Licensed modules* below). Afterwards **Table Editor** should list tables such as `customers`, `sales_orders`, `customer_invoices`, and
**Storage** should show the private buckets `product-media`, `delivery-pod` and `finance-docs`.

### Step 3 — Configure sign-in (Supabase → Authentication)

1. **Sign In / Providers → Email:** turn **off** "Allow new users to sign up" (staff are invited by an administrator).
   Keep "Confirm email" on. Set the minimum password length to **10**.
2. **URL Configuration:** leave it for now; you fill it in at Step 5 once you know the website address.
3. **Emails → Templates.** Replace the link in two templates so the links open the app correctly:
   * **Invite user** — use this as the button link:
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/reset-password`
   * **Reset password** — use:
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
4. **Emails → SMTP Settings:** add your company mail server (Microsoft 365, Google Workspace, Zoho, SES…).
   Supabase's built-in mailer only sends a few emails per hour and is meant for testing.
5. *(Recommended)* **Project Settings → JWT / Sessions:** access-token expiry **3600** seconds or less.

### Step 4 — Deploy on Vercel

1. Go to <https://vercel.com/new> and sign in **with GitHub**.
2. Under **Import Git Repository**, choose **vishnu807-debug/SMB-TMS** → **Import**. (If it isn't listed, click
   **Adjust GitHub App Permissions** and give Vercel access to that repository.)
3. Framework preset: **Next.js** (detected automatically). Leave build settings as they are.
4. Open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL from Step 1 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key (**server only**) |
   | `NEXT_PUBLIC_SITE_URL` | `https://smb-tms.vercel.app` for now (fixed in Step 5) |
   | `CRON_SECRET` | a long random string, e.g. the output of `openssl rand -hex 32` |
   | `EINVOICE_ASP_URL`, `EINVOICE_ASP_API_KEY`, `EINVOICE_ASP_NAME` | leave empty until you sign up with an e-invoicing provider |

5. Click **Deploy**. When it finishes, note the address Vercel gives you (e.g. `https://smb-tms-xxxx.vercel.app`).

`vercel.json` already pins the server region to Frankfurt (next to the database) and schedules two daily jobs:
low-stock alerts and expiring quotations at 08:00 Dubai time, and an e-invoice retry run at 08:30.

### Step 5 — Connect the two

1. **Vercel → Project → Settings → Environment Variables:** set `NEXT_PUBLIC_SITE_URL` to your real address
   (or your custom domain, see below) → **Save** → **Deployments → ⋯ → Redeploy**.
2. **Supabase → Authentication → URL Configuration:**
   * **Site URL:** your address, e.g. `https://smb-tms-xxxx.vercel.app`
   * **Redirect URLs → Add URL:** `https://smb-tms-xxxx.vercel.app/auth/confirm`

### Step 6 — Create the first administrator

1. **Supabase → Authentication → Users → Add user → Create new user.** Enter your work email and a strong password, and
   tick **Auto Confirm User**.
2. **SQL Editor → New query**, change the email and **Run**:
   ```sql
   insert into public.user_roles (user_id, role_id)
   select p.id, r.id from public.profiles p, public.roles r
   where p.email = 'you@smp.ae' and r.code = 'super_admin';
   ```
3. Open the website and sign in. From now on, add staff in **User Management → Add user**; they receive an invitation email
   and choose their own password.

### Step 7 — Before the first real transaction

In the app, as the administrator:

1. **System Settings → Company:** legal name, TRN, address, bank details and the standard terms for quotations, purchase orders and invoices.
2. **System Settings → Bank and cash accounts** (Finance module): add each bank account (and petty cash).
3. **System Settings → Exchange rates:** today's USD/EUR/SAR rates, if you trade in other currencies.
4. **System Settings → Approval limits:** check the discount, margin, PO and bill thresholds.
5. **Warehouses**, then **Products** (with prices and minimum stock levels), **Suppliers** and **Customers**.
6. **Opening stock:** enter one **Stock adjustment** per warehouse with reason *Opening balance* and the counted quantities and
   unit costs; another user approves it.
7. Invite the staff and give each the right role (User Management → user → Roles).

### Custom domain (optional)

**Vercel → Project → Settings → Domains → Add** (e.g. `erp.smp.ae`) and create the DNS record Vercel shows at your domain
registrar. Then repeat Step 5 with the new address.

### Production checklist

* Supabase **Pro** plan for daily backups (and Point-in-Time Recovery if you want restore to the minute). The free plan
  pauses inactive projects and has no backups.
* Custom SMTP configured (Step 3.4) — otherwise invitations and password resets stop after a few emails.
* Only the Super Administrator role has `settings.manage` and `user.manage`; give them to as few people as possible.
* `SUPABASE_SERVICE_ROLE_KEY` exists **only** in Vercel's environment variables. It is never sent to the browser, and the
  build fails if anyone imports the admin client into browser code.

---

## Licensed modules (switching modules on and off)

Each installation can run only the modules the client has taken. Modules are switched by the **system provider**
(the software vendor) — either in the **Vendor console** inside the app (see below) or in the Supabase SQL editor.
The client's own users cannot switch them, not even their Super Administrator. Client admins can see what is active
in **System Settings → Licensed modules**.

### Vendor console

The vendor console is a page inside each client's installation that only the vendor's support account can open.
It shows the client, user count and last sign-in, lets you tick the modules the client has bought (dependencies are
ticked or unticked for you), asks for a licence/order reference, and keeps a change history.

Set up the vendor account once per installation:

1. **Supabase → Authentication → Users → Add user → Create new user.** Use the vendor's email (e.g.
   `support@your-company.com`), a strong password, and tick **Auto Confirm User**.
2. **Supabase → SQL Editor**, run:

   ```sql
   select public.grant_platform_admin('support@your-company.com', 'Vendor support');
   ```

3. Sign in to the app with that account. The menu shows **System provider → Vendor console** (`/vendor`).

What the vendor account can and cannot do:

* It can change the licensed modules. Every change is recorded with the vendor's email and the reference.
* It does **not** see the client's business data (customers, invoices…) unless the client gives it a role.
* It is hidden from the client's **User management**, and client admins cannot edit, deactivate or re-role it.
* Vendor access can only be granted or removed in the backend:
  `select public.revoke_platform_admin('support@your-company.com');`

### Switching modules from SQL

| Code | Module | Needs |
| --- | --- | --- |
| `core` | Users, roles, approvals, product catalogue, notifications, audit log, settings | always on |
| `sales` | Customers, enquiries, follow-ups, quotations, sales orders, sales dashboard | — |
| `inventory` | Stock by warehouse, issues, transfers, adjustments, reservations, movements, valuation | — |
| `procurement` | Suppliers, requisitions, supplier quotations, purchase orders, receiving | — |
| `logistics` | Delivery notes, shipments, dispatch, proof of delivery | `sales` |
| `finance` | Invoices, credit notes, receipts, supplier bills and payments, expenses, bank accounts, VAT summary | — |
| `einvoicing` | UAE e-invoicing (PINT AE) through an accredited service provider | `finance` |

New installations start with everything on except `einvoicing`. Without the vendor console, open **Supabase → SQL Editor** and run, for example:

```sql
-- See what is on
select code, name, is_enabled, requires from public.system_modules order by sort_order;

-- A client who takes Sales and Procurement only
select public.set_module_enabled('logistics', false);   -- switch off dependants first
select public.set_module_enabled('finance',   false);
select public.set_module_enabled('inventory', false);

-- Later the client signs up for Finance and e-invoicing (the third argument is an optional note kept in the log)
select public.set_module_enabled('finance',    true, 'Upgrade per contract 2027-01');
select public.set_module_enabled('einvoicing', true);
```

How a switched-off module behaves:

* It disappears from the menu.
* Its pages show "This module is not enabled".
* Its permissions are refused by the database for every user, so its functions cannot be called and its data cannot be
  read through the API.
* **No data is deleted.** Switching it back on brings everything back as it was.
* Dependencies are checked: you cannot switch on Logistics without Sales, or switch off Finance while e-invoicing is on.

With Sales and Procurement but no Inventory:

* Purchase orders can still be received (the *Goods Received* screen stays available).
* Items bought for customer orders are reserved for them on arrival.
* The stock screens (overview, transfers, adjustments and so on) stay hidden.

---

## UAE e-invoicing

The system produces each posted invoice and credit note as a **Peppol PINT AE** (UBL 2.1) document and sends it to your
**FTA-accredited service provider (ASP)**, which validates it, delivers it to the customer's provider and reports it to
the FTA.

* **Turn it on** (only for clients who take it): sign up with an ASP. They give you an API endpoint, an API key and the
  client's Peppol participant ID. Then:
  1. Put `EINVOICE_ASP_URL`, `EINVOICE_ASP_API_KEY` and `EINVOICE_ASP_NAME` in Vercel and redeploy.
  2. Activate the module in the backend: `select public.set_module_enabled('einvoicing', true);`
  3. In **System Settings → UAE e-invoicing** (visible only once the module is on), enter the provider and participant ID.
  While the module is off, invoices are never queued or sent.
* **Day to day:**
  * Posting an invoice sends it straight away. The invoice shows *queued → submitted → accepted*, or *rejected* with the
    provider's message.
  * Failed sends retry with back-off, and the scheduled job sweeps up anything left over.
  * Rejected invoices are corrected and resent from the invoice page.
  * Once reported, an invoice can no longer be voided; you issue a credit note instead.
* **Adapting to your ASP:** connectors differ in small ways (authentication header, response fields).
  * `src/lib/einvoicing/provider.ts` contains a generic HTTPS connector with a single `mapResponse()` to adjust.
  * `src/lib/einvoicing/pint-ae.ts` builds the XML.
  * Ask your ASP to validate a test invoice during onboarding before you enable it in production.

---

## Running it on your computer

```bash
cp .env.example .env.local     # fill in the Supabase URL, anon key (and service key for invites)
npm install
npm run dev                    # http://localhost:3000
```

Checks (the same ones GitHub Actions runs on every push):

```bash
npm run typecheck
npm run build
PGHOST=localhost PGPORT=5432 PGPASSWORD=postgres npm run db:test   # needs a local PostgreSQL 16+
```

The database tests apply all migrations to an empty PostgreSQL with a small Supabase stand-in
(`supabase/tests/00_supabase_stub.sql`) and then act out real scenarios as different users:

* **Products & inventory:** product validation, approved adjustments, negative-stock authorisation, transfers, and a ledger-integrity check.
* **Sales:** credit limits, discount and margin approvals, revisions, and per-rep visibility.
* **Users:** grants and denies, expiry, session revocation, and deactivation.
* **Procurement:** supplier quote selection, PO approval, over-receipt blocking, and back-to-back reservation.
* **Logistics:**
  * delivery only from reserved stock;
  * dispatch through a shipment;
  * proof of delivery;
  * order fulfilment roll-up.
* **Modules:** switching only from the backend, dependency checks, data hidden but kept when off, and e-invoicing following its module.
* **Finance:**
  * invoicing limited to delivered quantities;
  * receipts and bounced payments;
  * credit notes;
  * the e-invoice queue;
  * three-way match and variance approval;
  * supplier payments;
  * expenses;
  * VAT summary;
  * who can see what.

## Roles

`super_admin`, `managing_director`, `sales_manager`, `sales_executive`, `accounts_manager`, `accounts_executive`,
`logistics_manager`, `logistics_executive`, `procurement_manager`, `procurement_executive`, `warehouse_manager`,
`customer_support_executive`.

* Each role maps to fine-grained permissions such as `invoice.post` or `inventory.allow_negative`.
* Managers can change the mapping in **Roles & Permissions**.
* Individual users can be granted extra permissions, or denied ones, optionally until a date.
* Nobody can approve their own request (quotation, order, PO, bill, adjustment or expense) unless they are given `approval.self_approve`.

## How stock and money are protected

* **Stock:**
  * Balances change only through posting functions, which write a permanent movement in the same transaction.
  * Direct edits are blocked for every role.
  * A check at commit proves each balance equals its movements.
  * Negative stock needs management authorisation on that specific document.
  * Reserved stock cannot be issued, transferred, adjusted or delivered to someone else.
* **Documents:**
  * Posted documents (GRNs, delivery notes, invoices, bills) are locked; corrections are made by reversal documents.
  * Numbers are gap-free per year.
* **Quantities:**
  * Received quantities never exceed ordered quantities.
  * Delivered never exceeds ordered.
  * Invoiced never exceeds delivered.
  * Billed never exceeds received.
  * Each of these limits holds even when two people work at the same time.
* **Visibility:**
  * Costs, margins and stock values are visible only to roles allowed to see them, enforced in the database.
  * Sales executives see only their own customers, quotations, orders and invoices.
* **Audit:** every change to business data is written to the audit log, with who made it and when.
