-- =============================================================================
-- 0020 Sales enhancements
--   1. Bulk import of customers and enquiries (validated in the database,
--      duplicate-checked, one import per file token, batch audit trail).
--   2. Documents on quotations (own uploads, per-line datasheets, reuse of
--      catalogue datasheets) in the private "quotation-docs" bucket.
--   3. Quotation-only ("new") products kept apart from the product master,
--      customer confirmation, and controlled promotion to the catalogue.
--   Nothing existing is removed; existing quotations keep working unchanged.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Phone numbers compared as digits without the UAE country code or trunk zero
-- ("+971 50 123 4567" = "050-1234567" = "00971501234567").
create or replace function public.normalize_phone(p text)
returns text language sql immutable as $$
  select case when length(d) >= 7 then d end
  from (select regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^(00971|971|0)', '') as d) x;
$$;

-- Product names compared without case, punctuation or repeated spaces.
create or replace function public.normalize_product_name(p text)
returns text language sql immutable as $$
  select nullif(trim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g')), '');
$$;

-- Reads a trimmed, non-empty text value from an import row.
create or replace function public.import_val(r jsonb, k text)
returns text language sql immutable as $$
  select nullif(trim(r->>k), '');
$$;

-- "yes", "Y", "true", "1" → true; "no", "N", "false", "0" → false; anything else → null.
create or replace function public.import_bool(p text)
returns boolean language sql immutable as $$
  select case when lower(trim(coalesce(p, ''))) in ('yes', 'y', 'true', '1') then true
              when lower(trim(coalesce(p, ''))) in ('no', 'n', 'false', '0') then false end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Bulk import
-- ---------------------------------------------------------------------------
create table public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  entity        text not null check (entity in ('customers', 'leads')),
  file_name     text not null check (length(file_name) between 1 and 255),
  client_token  uuid not null unique,                 -- the same file preview can only be imported once
  rows_total    integer not null check (rows_total >= 0),
  rows_imported integer not null check (rows_imported >= 0),
  rows_failed   integer not null check (rows_failed >= 0),
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id) default auth.uid()
);
create index import_batches_created_idx on public.import_batches(created_at desc);
alter table public.import_batches enable row level security;
revoke all on public.import_batches from anon;
revoke insert, update, delete, truncate on public.import_batches from authenticated;
create policy import_batches_read on public.import_batches for select to authenticated
  using (created_by = auth.uid() or public.has_permission('audit.view'));

alter table public.customers add column import_batch_id uuid references public.import_batches(id);
alter table public.leads     add column import_batch_id uuid references public.import_batches(id);

-- Customers -------------------------------------------------------------------
-- p_rows: array of objects with the template's keys (see the app's import screen).
-- p_commit = false validates only; true also creates the valid rows (each row in
-- its own savepoint, so one failure never affects the others).
create or replace function public.import_customers(p_rows jsonb, p_commit boolean, p_file_name text default null, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; n integer := 0; msgs text[]; st text;
  v_name text; v_trn text; v_email text; v_phone text; v_type text; v_vat boolean; v_vat_raw text;
  v_cur text; v_term uuid; v_credit numeric; v_mgr uuid; v_cemail text; v_cphone text;
  v_dup record; v_payload jsonb; v_id uuid; v_code text;
  seen_name jsonb := '{}'; seen_trn jsonb := '{}'; seen_email jsonb := '{}'; seen_phone jsonb := '{}';
  v_out jsonb := '[]'; v_batch uuid; v_ok integer := 0; v_fail integer := 0;
  v_has_addr boolean;
begin
  perform public.require_permission('customer.create');
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    perform public.raise_business_error('validation', 'The file has no data rows.');
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    perform public.raise_business_error('validation', 'Import at most 2,000 rows at a time. Split the file and import it in parts.');
  end if;
  if p_commit then
    if p_token is null or coalesce(trim(p_file_name), '') = '' then
      perform public.raise_business_error('validation', 'Missing import reference. Upload the file again.');
    end if;
    if exists (select 1 from public.import_batches where client_token = p_token) then
      perform public.raise_business_error('duplicate', 'This file has already been imported. Upload it again to start a new import.');
    end if;
    insert into public.import_batches(entity, file_name, client_token, rows_total, rows_imported, rows_failed)
    values ('customers', left(trim(p_file_name), 255), p_token, jsonb_array_length(p_rows), 0, 0)
    returning id into v_batch;
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1; msgs := '{}'; st := 'ready'; v_id := null; v_code := null;
    if jsonb_typeof(r) <> 'object' then r := '{}'; end if;

    v_name  := public.import_val(r, 'name');
    v_trn   := nullif(regexp_replace(coalesce(r->>'trn', ''), '\s', '', 'g'), '');
    v_email := lower(public.import_val(r, 'email'));
    v_phone := public.import_val(r, 'phone');
    v_cemail := lower(public.import_val(r, 'contact_email'));
    v_cphone := coalesce(public.import_val(r, 'contact_mobile'), public.import_val(r, 'contact_phone'));
    v_type  := lower(coalesce(public.import_val(r, 'customer_type'), 'company'));
    v_vat_raw := public.import_val(r, 'vat_registered');
    v_vat   := coalesce(public.import_bool(v_vat_raw), v_trn is not null);
    v_cur   := upper(coalesce(public.import_val(r, 'currency_code'), public.base_currency()));
    v_term := null; v_credit := 0; v_mgr := auth.uid();

    if v_name is null or length(v_name) < 2 then msgs := msgs || 'Company name is required.'::text;
    elsif length(v_name) > 200 then msgs := msgs || 'Company name is longer than 200 characters.'::text; end if;
    if v_type not in ('company', 'government', 'individual') then
      msgs := msgs || 'Customer type must be Company, Government or Individual.'::text;
    end if;
    if v_trn is not null and v_trn !~ '^[0-9]{15}$' then msgs := msgs || 'TRN must be exactly 15 digits.'::text; end if;
    if v_vat_raw is not null and public.import_bool(v_vat_raw) is null then msgs := msgs || 'VAT registered must be Yes or No.'::text; end if;
    if v_vat and v_trn is null then msgs := msgs || 'A VAT-registered customer needs a TRN.'::text; end if;
    if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then msgs := msgs || 'Email address is not valid.'::text; end if;
    if v_cemail is not null and v_cemail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then msgs := msgs || 'Contact email is not valid.'::text; end if;
    if v_phone is not null and length(v_phone) > 40 then msgs := msgs || 'Phone number is too long.'::text; end if;
    if not exists (select 1 from public.currencies where code = v_cur and is_active) then
      msgs := msgs || format('Currency %s is not set up.', v_cur);
    end if;
    if public.import_val(r, 'payment_terms') is not null then
      select id into v_term from public.payment_terms
       where is_active and (lower(name) = lower(public.import_val(r, 'payment_terms'))
                            or days = case when public.import_val(r, 'payment_terms') ~ '^\d{1,4}$' then public.import_val(r, 'payment_terms')::int end)
       order by lower(name) = lower(public.import_val(r, 'payment_terms')) desc limit 1;
      if v_term is null then msgs := msgs || format('Payment terms "%s" not found.', public.import_val(r, 'payment_terms')); end if;
    end if;
    if public.import_val(r, 'credit_limit') is not null then
      if replace(public.import_val(r, 'credit_limit'), ',', '') !~ '^\d+(\.\d+)?$' then
        msgs := msgs || 'Credit limit must be a number.'::text;
      else
        v_credit := replace(public.import_val(r, 'credit_limit'), ',', '')::numeric;
        if v_credit > 0 and not public.has_permission('customer.set_credit') then
          msgs := msgs || 'You are not allowed to set credit limits (leave the column empty).'::text;
        end if;
      end if;
    end if;
    if public.import_val(r, 'account_manager_email') is not null then
      select id into v_mgr from public.profiles where lower(email) = lower(public.import_val(r, 'account_manager_email')) and is_active;
      if v_mgr is null then
        msgs := msgs || format('Account manager %s is not an active user.', public.import_val(r, 'account_manager_email'));
      elsif v_mgr <> auth.uid() and not public.has_permission('customer.assign') then
        msgs := msgs || 'You cannot assign customers to another sales representative.'::text;
      end if;
    end if;
    v_has_addr := coalesce(public.import_val(r, 'address_line1'), public.import_val(r, 'city'), public.import_val(r, 'address_line2'),
                           public.import_val(r, 'emirate'), public.import_val(r, 'po_box')) is not null;
    if v_has_addr and (public.import_val(r, 'address_line1') is null or public.import_val(r, 'city') is null) then
      msgs := msgs || 'An address needs at least Address line 1 and City.'::text;
    end if;
    if public.import_val(r, 'contact_name') is null and coalesce(v_cemail, v_cphone, public.import_val(r, 'contact_designation')) is not null then
      msgs := msgs || 'Contact details were given without a contact name.'::text;
    end if;

    -- Duplicates against existing customers (and their contacts).
    if cardinality(msgs) = 0 then
      select c.code, c.name,
             case when v_trn is not null and c.trn = v_trn then 'TRN'
                  when v_email is not null and c.email = v_email::citext then 'email'
                  when public.normalize_phone(v_phone) is not null and public.normalize_phone(c.phone) = public.normalize_phone(v_phone) then 'phone'
                  else 'company name' end as reason
        into v_dup
        from public.customers c
       where (v_trn is not null and c.trn = v_trn)
          or (v_email is not null and c.email = v_email::citext)
          or (public.normalize_phone(v_phone) is not null and public.normalize_phone(c.phone) = public.normalize_phone(v_phone))
          or (length(public.normalize_party_name(v_name)) > 2 and c.name_normalized = public.normalize_party_name(v_name))
       limit 1;
      if found then
        st := 'duplicate'; msgs := msgs || format('Already exists as %s %s (same %s).', v_dup.code, v_dup.name, v_dup.reason);
      else
        select c.code, c.name into v_dup from public.customer_contacts cc join public.customers c on c.id = cc.customer_id
         where (v_email is not null and cc.email = v_email::citext) or (v_cemail is not null and cc.email = v_cemail::citext)
            or (public.normalize_phone(v_cphone) is not null and public.normalize_phone(v_cphone) in (public.normalize_phone(cc.mobile), public.normalize_phone(cc.phone)))
         limit 1;
        if found then
          st := 'duplicate'; msgs := msgs || format('The contact already belongs to customer %s %s.', v_dup.code, v_dup.name);
        end if;
      end if;
    end if;
    -- Duplicates inside the file.
    if cardinality(msgs) = 0 then
      if seen_name ? coalesce(public.normalize_party_name(v_name), lower(v_name)) then
        st := 'duplicate'; msgs := msgs || format('Same company name as row %s in this file.', seen_name->>coalesce(public.normalize_party_name(v_name), lower(v_name)));
      elsif v_trn is not null and seen_trn ? v_trn then
        st := 'duplicate'; msgs := msgs || format('Same TRN as row %s in this file.', seen_trn->>v_trn);
      elsif v_email is not null and seen_email ? v_email then
        st := 'duplicate'; msgs := msgs || format('Same email as row %s in this file.', seen_email->>v_email);
      elsif public.normalize_phone(v_phone) is not null and seen_phone ? public.normalize_phone(v_phone) then
        st := 'duplicate'; msgs := msgs || format('Same phone as row %s in this file.', seen_phone->>public.normalize_phone(v_phone));
      end if;
    end if;
    if cardinality(msgs) > 0 and st = 'ready' then st := 'error'; end if;
    if st = 'ready' then
      seen_name := seen_name || jsonb_build_object(coalesce(public.normalize_party_name(v_name), lower(v_name)), n);
      if v_trn is not null then seen_trn := seen_trn || jsonb_build_object(v_trn, n); end if;
      if v_email is not null then seen_email := seen_email || jsonb_build_object(v_email, n); end if;
      if public.normalize_phone(v_phone) is not null then seen_phone := seen_phone || jsonb_build_object(public.normalize_phone(v_phone), n); end if;
    end if;

    if p_commit and st = 'ready' then
      v_payload := jsonb_build_object(
        'name', v_name, 'customer_type', v_type, 'trn', v_trn, 'vat_registered', v_vat,
        'trade_license_no', public.import_val(r, 'trade_license_no'), 'industry', public.import_val(r, 'industry'),
        'website', public.import_val(r, 'website'), 'email', v_email, 'phone', v_phone, 'currency_code', v_cur,
        'payment_term_id', v_term, 'credit_limit', v_credit, 'account_manager_id', v_mgr, 'status', 'active',
        'source', coalesce(public.import_val(r, 'source'), 'Bulk import'), 'notes', public.import_val(r, 'notes'),
        'contacts', case when public.import_val(r, 'contact_name') is not null then jsonb_build_array(jsonb_build_object(
            'name', public.import_val(r, 'contact_name'), 'designation', public.import_val(r, 'contact_designation'),
            'email', v_cemail, 'phone', public.import_val(r, 'contact_phone'), 'mobile', public.import_val(r, 'contact_mobile'),
            'is_primary', true)) else '[]'::jsonb end,
        'addresses', case when v_has_addr then jsonb_build_array(jsonb_build_object(
            'kind', 'billing', 'line1', public.import_val(r, 'address_line1'), 'line2', public.import_val(r, 'address_line2'),
            'city', public.import_val(r, 'city'), 'emirate', public.import_val(r, 'emirate'),
            'country', coalesce(public.import_val(r, 'country'), 'United Arab Emirates'), 'po_box', public.import_val(r, 'po_box'),
            'is_default', true)) else '[]'::jsonb end);
      begin
        v_id := public.save_customer(v_payload);
        update public.customers set import_batch_id = v_batch where id = v_id returning code into v_code;
        st := 'imported'; v_ok := v_ok + 1;
      exception when others then
        st := 'error'; msgs := msgs || sqlerrm;
      end;
    end if;
    if p_commit and st <> 'imported' then v_fail := v_fail + 1; end if;
    v_out := v_out || jsonb_build_object('row', n, 'status', st, 'messages', to_jsonb(msgs), 'id', v_id, 'code', v_code);
  end loop;

  if p_commit then
    update public.import_batches set rows_imported = v_ok, rows_failed = v_fail where id = v_batch;
  end if;
  return jsonb_build_object('rows', v_out, 'batch_id', v_batch);
end $$;

-- Enquiries -------------------------------------------------------------------
-- Each row may carry a resolution chosen on the preview screen:
--   customer_resolution = 'link'     → customer_id is the chosen customer
--                         'create'   → create the customer from company/contact columns
--                         'prospect' → keep the company name only (no customer record)
--                         'skip'     → do not import this row
create or replace function public.import_leads(p_rows jsonb, p_commit boolean, p_file_name text default null, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; n integer := 0; msgs text[]; st text; v_out jsonb := '[]';
  v_title text; v_code text; v_company text; v_res text; v_cust public.customers; v_cust_id uuid; v_match text;
  v_cnt integer; v_source text; v_priority text; v_prob integer; v_value numeric; v_cur text; v_date date; v_owner uuid;
  v_email text; v_id uuid; v_doc text; v_batch uuid; v_ok integer := 0; v_fail integer := 0;
  seen jsonb := '{}'; v_key text; created jsonb := '{}'; v_nerr integer;
begin
  perform public.require_permission('lead.create');
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    perform public.raise_business_error('validation', 'The file has no data rows.');
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    perform public.raise_business_error('validation', 'Import at most 2,000 rows at a time. Split the file and import it in parts.');
  end if;
  if p_commit then
    if p_token is null or coalesce(trim(p_file_name), '') = '' then
      perform public.raise_business_error('validation', 'Missing import reference. Upload the file again.');
    end if;
    if exists (select 1 from public.import_batches where client_token = p_token) then
      perform public.raise_business_error('duplicate', 'This file has already been imported. Upload it again to start a new import.');
    end if;
    insert into public.import_batches(entity, file_name, client_token, rows_total, rows_imported, rows_failed)
    values ('leads', left(trim(p_file_name), 255), p_token, jsonb_array_length(p_rows), 0, 0)
    returning id into v_batch;
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    n := n + 1; msgs := '{}'; st := 'ready'; v_cust_id := null; v_match := null; v_id := null; v_doc := null;
    if jsonb_typeof(r) <> 'object' then r := '{}'; end if;
    v_title   := public.import_val(r, 'title');
    v_code    := upper(public.import_val(r, 'customer_code'));
    v_company := public.import_val(r, 'company_name');
    v_res     := lower(coalesce(public.import_val(r, 'customer_resolution'), ''));
    v_email   := lower(public.import_val(r, 'contact_email'));

    if v_res = 'skip' then
      v_out := v_out || jsonb_build_object('row', n, 'status', 'skipped', 'messages', '["Skipped on the preview screen."]'::jsonb);
      if p_commit then v_fail := v_fail + 1; end if;
      continue;
    end if;

    if v_title is null or length(v_title) < 3 then msgs := msgs || 'Title is required (at least 3 characters).'::text;
    elsif length(v_title) > 200 then msgs := msgs || 'Title is longer than 200 characters.'::text; end if;
    if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then msgs := msgs || 'Contact email is not valid.'::text; end if;

    v_source := regexp_replace(lower(coalesce(public.import_val(r, 'source'), 'other')), '[\s-]+', '_', 'g');
    if v_source not in (select unnest(enum_range(null::public.lead_source))::text) then
      msgs := msgs || format('Source "%s" is not valid (use Phone, Email, Walk in, Website, Referral, Exhibition, Existing customer, Tender or Other).', public.import_val(r, 'source'));
    end if;
    v_priority := lower(coalesce(public.import_val(r, 'priority'), 'medium'));
    if v_priority not in ('low', 'medium', 'high') then msgs := msgs || 'Priority must be Low, Medium or High.'::text; end if;
    v_prob := 20;
    if public.import_val(r, 'probability') is not null then
      v_prob := case when replace(public.import_val(r, 'probability'), '%', '') ~ '^\d{1,3}$' then replace(public.import_val(r, 'probability'), '%', '')::int end;
      if v_prob is null or v_prob > 100 then
        msgs := msgs || 'Probability must be a whole number from 0 to 100.'::text; v_prob := 20;
      end if;
    end if;
    v_value := null;
    if public.import_val(r, 'estimated_value') is not null then
      if replace(public.import_val(r, 'estimated_value'), ',', '') !~ '^\d+(\.\d+)?$' then msgs := msgs || 'Estimated value must be a number.'::text;
      else v_value := replace(public.import_val(r, 'estimated_value'), ',', '')::numeric; end if;
    end if;
    v_cur := upper(coalesce(public.import_val(r, 'currency_code'), public.base_currency()));
    if not exists (select 1 from public.currencies where code = v_cur and is_active) then msgs := msgs || format('Currency %s is not set up.', v_cur); end if;
    v_date := null;
    if public.import_val(r, 'expected_close_date') is not null then
      begin
        if public.import_val(r, 'expected_close_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad'; end if;
        v_date := public.import_val(r, 'expected_close_date')::date;
      exception when others then msgs := msgs || 'Expected close date must be a date (e.g. 2026-12-31 or 31/12/2026).'::text;
      end;
    end if;
    v_owner := auth.uid();
    if public.import_val(r, 'owner_email') is not null then
      select id into v_owner from public.profiles where lower(email) = lower(public.import_val(r, 'owner_email')) and is_active;
      if v_owner is null then msgs := msgs || format('Owner %s is not an active user.', public.import_val(r, 'owner_email'));
      elsif v_owner <> auth.uid() and not public.has_permission('lead.assign') then
        msgs := msgs || 'You cannot assign enquiries to another person.'::text;
      end if;
    end if;

    v_nerr := cardinality(msgs);   -- errors that must be fixed in the file

    -- Customer mapping.
    if v_res = 'link' then
      select * into v_cust from public.customers where id = nullif(r->>'customer_id', '')::uuid;
      if not found or not public.can_view_owned(v_cust.account_manager_id, 'customer.view_all') then
        msgs := msgs || 'The chosen customer was not found.'::text;
      else v_cust_id := v_cust.id; v_match := v_cust.code || ' ' || v_cust.name; end if;
    elsif v_res = 'create' then
      if v_company is null or length(v_company) < 2 then msgs := msgs || 'Enter the company name to create the customer.'::text;
      elsif not public.has_permission('customer.create') then msgs := msgs || 'You are not allowed to create customers.'::text;
      elsif not (created ? coalesce(public.normalize_party_name(v_company), lower(v_company)))
            and exists (select 1 from public.customers where name_normalized = public.normalize_party_name(v_company)) then
        msgs := msgs || format('A customer named "%s" already exists — link the row to it instead.', v_company);
      else v_match := 'New customer: ' || v_company; end if;
    elsif v_res = 'prospect' then
      if v_company is null then msgs := msgs || 'Enter the company name for a prospect.'::text; else v_match := 'Prospect (no customer record)'; end if;
    elsif v_res <> '' then
      msgs := msgs || 'Unknown customer choice.'::text;
    else
      -- Automatic matching: code, then exact company name, then contact email.
      if v_code is not null then
        select * into v_cust from public.customers where code = v_code;
        if not found or not public.can_view_owned(v_cust.account_manager_id, 'customer.view_all') then
          st := 'unmatched'; msgs := msgs || format('Customer code %s was not found.', v_code);
        else v_cust_id := v_cust.id; end if;
      elsif v_company is not null then
        select count(*) into v_cnt from public.customers c
         where c.name_normalized = public.normalize_party_name(v_company) and public.can_view_owned(c.account_manager_id, 'customer.view_all');
        if v_cnt = 1 then
          select * into v_cust from public.customers c
           where c.name_normalized = public.normalize_party_name(v_company) and public.can_view_owned(c.account_manager_id, 'customer.view_all');
          v_cust_id := v_cust.id;
        elsif v_cnt > 1 then
          st := 'unmatched'; msgs := msgs || format('More than one customer is called "%s" — choose which one.', v_company);
        elsif v_email is not null then
          select c.* into v_cust from public.customers c
           where public.can_view_owned(c.account_manager_id, 'customer.view_all')
             and (c.email = v_email::citext or exists (select 1 from public.customer_contacts cc where cc.customer_id = c.id and cc.email = v_email::citext))
           limit 1;
          if found then v_cust_id := v_cust.id; end if;
        end if;
        if v_cust_id is null and st <> 'unmatched' then
          st := 'unmatched'; msgs := msgs || format('Customer "%s" was not found.', v_company);
        end if;
      else
        msgs := msgs || 'Enter a customer code or company name.'::text;
      end if;
      if v_cust_id is not null then
        v_match := v_cust.code || ' ' || v_cust.name;
        if v_cust.status in ('blocked', 'inactive') then msgs := msgs || format('Customer %s is %s.', v_cust.name, v_cust.status); end if;
      end if;
    end if;

    if v_nerr > 0 then st := 'error'; end if;

    -- Duplicate enquiries: same title for the same customer/company, still open.
    if cardinality(msgs) = 0 and st = 'ready' then
      select l.doc_no into v_doc from public.leads l
       where l.stage not in ('won', 'lost')
         and lower(trim(l.title)) = lower(v_title)
         and ((v_cust_id is not null and l.customer_id = v_cust_id)
              or (v_cust_id is null and v_company is not null and public.normalize_party_name(l.company_name) = public.normalize_party_name(v_company)))
       limit 1;
      if v_doc is not null then st := 'duplicate'; msgs := msgs || format('Open enquiry %s already has this title for this customer.', v_doc); v_doc := null; end if;
      v_key := lower(v_title) || '|' || coalesce(v_cust_id::text, public.normalize_party_name(v_company), lower(v_company), '');
      if st = 'ready' and seen ? v_key then
        st := 'duplicate'; msgs := msgs || format('Same enquiry as row %s in this file.', seen->>v_key);
      end if;
    end if;
    if cardinality(msgs) > 0 and st = 'ready' then st := 'error'; end if;
    if st = 'ready' then seen := seen || jsonb_build_object(v_key, n); end if;

    if p_commit and st = 'ready' then
      begin
        if v_res = 'create' then
          if created ? coalesce(public.normalize_party_name(v_company), lower(v_company)) then
            v_cust_id := (created->>coalesce(public.normalize_party_name(v_company), lower(v_company)))::uuid;
          else
            v_cust_id := public.save_customer(jsonb_build_object('name', v_company, 'customer_type', 'company', 'vat_registered', false,
              'email', v_email, 'phone', public.import_val(r, 'contact_phone'), 'status', 'active', 'source', 'Bulk import (enquiries)',
              'contacts', case when public.import_val(r, 'contact_name') is not null then jsonb_build_array(jsonb_build_object(
                'name', public.import_val(r, 'contact_name'), 'email', v_email, 'mobile', public.import_val(r, 'contact_phone'), 'is_primary', true))
                else '[]'::jsonb end));
            update public.customers set import_batch_id = v_batch where id = v_cust_id;
            created := created || jsonb_build_object(coalesce(public.normalize_party_name(v_company), lower(v_company)), v_cust_id);
          end if;
        end if;
        v_id := public.save_lead(jsonb_build_object(
          'title', v_title, 'source', v_source, 'customer_id', v_cust_id,
          'company_name', case when v_cust_id is null then v_company else coalesce(v_company, v_cust.name) end,
          'contact_name', public.import_val(r, 'contact_name'), 'contact_email', v_email, 'contact_phone', public.import_val(r, 'contact_phone'),
          'requirement', public.import_val(r, 'requirement'), 'estimated_value', v_value, 'currency_code', v_cur,
          'probability', v_prob, 'expected_close_date', v_date, 'priority', v_priority, 'owner_id', v_owner));
        update public.leads set import_batch_id = v_batch where id = v_id returning doc_no into v_doc;
        st := 'imported'; v_ok := v_ok + 1;
      exception when others then
        st := 'error'; msgs := msgs || sqlerrm;
      end;
    end if;
    if p_commit and st <> 'imported' then v_fail := v_fail + 1; end if;
    v_out := v_out || jsonb_build_object('row', n, 'status', st, 'messages', to_jsonb(msgs), 'customer', v_match, 'id', v_id, 'code', v_doc);
  end loop;

  if p_commit then
    update public.import_batches set rows_imported = v_ok, rows_failed = v_fail where id = v_batch;
  end if;
  return jsonb_build_object('rows', v_out, 'batch_id', v_batch);
end $$;

revoke execute on function public.import_customers(jsonb, boolean, text, uuid), public.import_leads(jsonb, boolean, text, uuid) from public, anon;
grant execute on function public.import_customers(jsonb, boolean, text, uuid), public.import_leads(jsonb, boolean, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Quotation-only products (kept apart from the product master)
-- ---------------------------------------------------------------------------
-- Each one belongs to exactly one quotation (a revision gets its own copy), so
-- a product can only be promoted from the revision the customer confirmed.
create table public.quote_products (
  id              uuid primary key default gen_random_uuid(),
  quotation_id    uuid not null references public.quotations(id) on delete cascade,
  name            text not null check (length(trim(name)) between 2 and 200),
  description     text check (description is null or length(description) <= 4000),
  brand           text check (brand is null or length(brand) <= 80),
  model_no        text check (model_no is null or length(model_no) <= 80),
  technical_specs jsonb not null default '[]'::jsonb
                  check (jsonb_typeof(technical_specs) = 'array' and jsonb_array_length(technical_specs) <= 60),
  uom_id          uuid not null references public.units_of_measure(id),
  -- proposed → added (a new catalogue product was created) or linked (matched to an existing product)
  status          text not null default 'proposed' check (status in ('proposed', 'added', 'linked')),
  product_id      uuid references public.products(id),
  decided_at      timestamptz,
  decided_by      uuid references public.profiles(id),
  decision_note   text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id),
  constraint quote_products_decision check ((status = 'proposed') = (product_id is null) and (status = 'proposed') = (decided_at is null))
);
create index on public.quote_products(quotation_id);
create index quote_products_pending_idx on public.quote_products(status) where status = 'proposed';
select public.attach_standard_triggers('public.quote_products');

-- A promoted product can never be "un-promoted" or promoted again.
create or replace function public.quote_products_guard()
returns trigger language plpgsql as $$
begin
  if old.status <> 'proposed' then
    raise exception using errcode = 'P0001', hint = 'locked',
      message = 'This item has already been added to or linked with the product catalogue.';
  end if;
  return coalesce(new, old);
end $$;
create trigger quote_products_guard before update or delete on public.quote_products
  for each row execute function public.quote_products_guard();

alter table public.quotation_lines alter column product_id drop not null;
alter table public.quotation_lines add column quote_product_id uuid references public.quote_products(id);
alter table public.quotation_lines add constraint quotation_lines_item check (product_id is not null or quote_product_id is not null);
create index on public.quotation_lines(quote_product_id);

-- Customer confirmation (status 'accepted' = confirmed by the customer).
alter table public.quotations
  add column confirmation_date        date,
  add column confirmation_method      text check (confirmation_method in ('purchase_order', 'email', 'signed_quotation', 'phone', 'other')),
  add column confirmation_reference   text check (confirmation_reference is null or length(confirmation_reference) <= 120),
  add column confirmation_note        text check (confirmation_note is null or length(confirmation_note) <= 2000),
  add column confirmation_recorded_by uuid references public.profiles(id),
  add column confirmation_recorded_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. Quotation documents
-- ---------------------------------------------------------------------------
create table public.quotation_documents (
  id                    uuid primary key default gen_random_uuid(),
  quotation_id          uuid not null references public.quotations(id) on delete cascade,
  kind                  text not null default 'supporting'
                        check (kind in ('datasheet', 'drawing', 'certificate', 'supporting', 'customer_confirmation', 'other')),
  -- Optional link to one item of the quotation: a catalogue product or a new (quotation-only) product.
  product_id            uuid references public.products(id),
  -- If the new product is removed from the draft, its uploaded files stay as general documents.
  quote_product_id      uuid references public.quote_products(id) on delete set null,
  -- Either an uploaded file (storage_path) or a reused catalogue datasheet (product_attachment_id).
  storage_path          text,
  product_attachment_id uuid references public.product_attachments(id) on delete cascade,
  file_name             text not null check (length(trim(file_name)) between 1 and 255),
  mime_type             text,
  size_bytes            bigint check (size_bytes is null or size_bytes between 1 and 26214400),
  include_in_share      boolean not null default true,
  created_at            timestamptz not null default now(),
  created_by            uuid references public.profiles(id) default auth.uid(),
  constraint quotation_documents_source check ((storage_path is null) <> (product_attachment_id is null)),
  constraint quotation_documents_path check (storage_path is null or storage_path like 'quotations/%')
);
create index on public.quotation_documents(quotation_id);
create index on public.quotation_documents(storage_path);
create index on public.quotation_documents(quote_product_id);
create unique index quotation_documents_reuse_once on public.quotation_documents(quotation_id, product_attachment_id) where product_attachment_id is not null;
select public.attach_standard_triggers('public.quotation_documents', false);

-- ---------------------------------------------------------------------------
-- Security for the new tables
-- ---------------------------------------------------------------------------
alter table public.quote_products enable row level security;
alter table public.quotation_documents enable row level security;
revoke all on public.quote_products, public.quotation_documents from anon;
revoke insert, update, delete, truncate on public.quote_products, public.quotation_documents from authenticated;
grant select on public.quote_products, public.quotation_documents, public.import_batches to authenticated;

-- Visible with the quotation, and to catalogue maintainers who review new items.
create policy quote_products_read on public.quote_products for select to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id) or public.has_permission('product.edit'));
create policy quotation_documents_read on public.quotation_documents for select to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_id)
         or (quote_product_id is not null and public.has_permission('product.edit')));

-- ---------------------------------------------------------------------------
-- save_quotation — now also accepts new (quotation-only) products per line:
--   { "quote_product": { "id"?, "name", "description", "brand", "model_no",
--                        "technical_specs": [{"name","value"}], "uom_id" }, ... }
-- Everything else is unchanged from 0007.
-- ---------------------------------------------------------------------------
create or replace function public.save_quotation(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id        uuid := nullif(p->>'id', '')::uuid;
  v_old       public.quotations;
  v_customer  public.customers;
  v_rep       uuid := coalesce(nullif(p->>'sales_rep_id', '')::uuid, auth.uid());
  v_currency  char(3);
  v_rate      numeric;
  v_qdate     date := coalesce(nullif(p->>'quotation_date', '')::date, current_date);
  v_valid     date;
  v_line      jsonb;
  v_n         integer := 0;
  v_product   public.products;
  v_tax       public.tax_codes;
  v_line_id   uuid;
  v_mode      public.fulfilment_mode;
  v_cost      record;
  v_can_cost  boolean := public.has_permission('quotation.view_cost');
  v_base_no   text;
  v_validity  integer;
  v_qp        jsonb;
  v_qp_id     uuid;
  v_specs     jsonb;
  v_spec      jsonb;
  v_prev_qp   uuid[] := '{}';
begin
  if v_id is null then
    perform public.require_permission('quotation.create');
  else
    perform public.require_permission('quotation.edit');
    select * into v_old from public.quotations where id = v_id for update;
    if not found then perform public.raise_business_error('not_found', 'Quotation not found.'); end if;
    if not public.can_view_owned(v_old.sales_rep_id, 'quotation.view_all') then
      perform public.raise_business_error('forbidden', 'You can only edit your own quotations.');
    end if;
    if v_old.status <> 'draft' then
      perform public.raise_business_error('locked', 'Only draft quotations can be edited. Create a revision instead.');
    end if;
  end if;

  -- Customer must exist, be visible and not blocked.
  select * into v_customer from public.customers where id = nullif(p->>'customer_id', '')::uuid;
  if not found then perform public.raise_business_error('validation', 'Select a customer.'); end if;
  if v_customer.status in ('blocked', 'inactive') then
    perform public.raise_business_error('validation', format('Customer %s is %s and cannot be quoted.', v_customer.name, v_customer.status));
  end if;
  if not public.can_view_owned(v_customer.account_manager_id, 'customer.view_all')
     and not public.has_permission('quotation.view_all') then
    perform public.raise_business_error('forbidden', 'This customer is assigned to another sales representative.');
  end if;
  if v_rep <> auth.uid() and not public.has_permission('quotation.view_all') then
    perform public.raise_business_error('forbidden', 'You cannot create quotations for another sales representative.');
  end if;

  -- Contact and addresses must belong to the customer.
  if nullif(p->>'contact_id', '') is not null and not exists
     (select 1 from public.customer_contacts where id = (p->>'contact_id')::uuid and customer_id = v_customer.id) then
    perform public.raise_business_error('validation', 'The contact does not belong to this customer.');
  end if;
  if nullif(p->>'billing_address_id', '') is not null and not exists
     (select 1 from public.customer_addresses where id = (p->>'billing_address_id')::uuid and customer_id = v_customer.id) then
    perform public.raise_business_error('validation', 'The billing address does not belong to this customer.');
  end if;
  if nullif(p->>'shipping_address_id', '') is not null and not exists
     (select 1 from public.customer_addresses where id = (p->>'shipping_address_id')::uuid and customer_id = v_customer.id) then
    perform public.raise_business_error('validation', 'The shipping address does not belong to this customer.');
  end if;

  v_currency := coalesce(nullif(p->>'currency_code', ''), v_customer.currency_code);
  if v_currency = public.base_currency() then
    v_rate := 1;
  else
    v_rate := coalesce(nullif(p->>'exchange_rate', '')::numeric, public.rate_to_base(v_currency, v_qdate));
    if v_rate is null or v_rate <= 0 then
      perform public.raise_business_error('validation',
        format('No exchange rate for %s. Enter the rate on the quotation or add it in Settings.', v_currency));
    end if;
  end if;

  select quotation_validity_days into v_validity from public.company_settings where id;
  v_valid := coalesce(nullif(p->>'valid_until', '')::date, v_qdate + v_validity);

  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then
    perform public.raise_business_error('validation', 'Add at least one item to the quotation.');
  end if;

  if v_id is null then
    v_base_no := public.next_document_number('quotation', v_qdate);
    insert into public.quotations(doc_no, base_doc_no, revision_no, lead_id, customer_id, contact_id,
      billing_address_id, shipping_address_id, sales_rep_id, subject, customer_reference, quotation_date,
      valid_until, currency_code, exchange_rate, payment_term_id, delivery_term_id, delivery_time,
      delivery_location, terms_conditions, notes, internal_notes)
    values (v_base_no, v_base_no, 0, nullif(p->>'lead_id', '')::uuid, v_customer.id,
      nullif(p->>'contact_id', '')::uuid, nullif(p->>'billing_address_id', '')::uuid,
      nullif(p->>'shipping_address_id', '')::uuid, v_rep, nullif(p->>'subject', ''),
      nullif(p->>'customer_reference', ''), v_qdate, v_valid, v_currency, v_rate,
      coalesce(nullif(p->>'payment_term_id', '')::uuid, v_customer.payment_term_id),
      coalesce(nullif(p->>'delivery_term_id', '')::uuid, v_customer.delivery_term_id),
      nullif(p->>'delivery_time', ''), nullif(p->>'delivery_location', ''),
      coalesce(p->>'terms_conditions', (select quotation_terms from public.company_settings where id)),
      nullif(p->>'notes', ''), nullif(p->>'internal_notes', ''))
    returning id into v_id;
  else
    update public.quotations set lead_id = nullif(p->>'lead_id', '')::uuid, customer_id = v_customer.id,
      contact_id = nullif(p->>'contact_id', '')::uuid, billing_address_id = nullif(p->>'billing_address_id', '')::uuid,
      shipping_address_id = nullif(p->>'shipping_address_id', '')::uuid, sales_rep_id = v_rep,
      subject = nullif(p->>'subject', ''), customer_reference = nullif(p->>'customer_reference', ''),
      quotation_date = v_qdate, valid_until = v_valid, currency_code = v_currency, exchange_rate = v_rate,
      payment_term_id = nullif(p->>'payment_term_id', '')::uuid, delivery_term_id = nullif(p->>'delivery_term_id', '')::uuid,
      delivery_time = nullif(p->>'delivery_time', ''), delivery_location = nullif(p->>'delivery_location', ''),
      terms_conditions = coalesce(p->>'terms_conditions', ''), notes = nullif(p->>'notes', ''),
      internal_notes = nullif(p->>'internal_notes', '')
    where id = v_id;
    select coalesce(array_agg(quote_product_id) filter (where quote_product_id is not null), '{}')
      into v_prev_qp from public.quotation_lines where quotation_id = v_id;
    delete from public.quotation_lines where quotation_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_n := v_n + 1;
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 then
      perform public.raise_business_error('validation', format('Line %s: quantity must be greater than zero.', v_n));
    end if;
    if coalesce((v_line->>'unit_price')::numeric, -1) < 0 then
      perform public.raise_business_error('validation', format('Line %s: unit price cannot be negative.', v_n));
    end if;
    if coalesce((v_line->>'discount_pct')::numeric, 0) not between 0 and 100 then
      perform public.raise_business_error('validation', format('Line %s: discount must be between 0 and 100%%.', v_n));
    end if;

    if nullif(v_line->>'product_id', '') is not null then
      -- Catalogue product (unchanged behaviour).
      select * into v_product from public.products where id = (v_line->>'product_id')::uuid;
      if not found then perform public.raise_business_error('validation', format('Line %s: select a product.', v_n)); end if;
      if not v_product.is_active then
        perform public.raise_business_error('validation', format('Line %s: %s is inactive.', v_n, v_product.name));
      end if;
      select * into v_tax from public.tax_codes
       where id = coalesce(nullif(v_line->>'tax_code_id', '')::uuid, v_customer.default_tax_code_id, v_product.tax_code_id)
          or (coalesce(nullif(v_line->>'tax_code_id', '')::uuid, v_customer.default_tax_code_id, v_product.tax_code_id) is null and is_default)
       limit 1;
      if not found then perform public.raise_business_error('config', 'No VAT code configured.'); end if;
      v_mode := coalesce(nullif(v_line->>'fulfilment_mode', ''),
                         case when v_product.item_type = 'stock' then 'stock' else 'procure' end)::public.fulfilment_mode;
      if v_mode = 'stock' and v_product.item_type <> 'stock' then
        perform public.raise_business_error('validation', format('Line %s: %s is not a stock item; use direct procurement.', v_n, v_product.name));
      end if;
      -- A promoted item on a revision keeps its link to the original quotation-only record.
      v_qp_id := null;
      if nullif(v_line->>'quote_product_id', '') is not null then
        select id into v_qp_id from public.quote_products
         where id = (v_line->>'quote_product_id')::uuid and id = any (v_prev_qp) and product_id = v_product.id;
      end if;

      insert into public.quotation_lines(quotation_id, line_no, product_id, quote_product_id, description, uom_id, qty, unit_price,
        discount_pct, tax_code_id, tax_rate, fulfilment_mode, lead_time_text)
      values (v_id, v_n, v_product.id, v_qp_id, coalesce(nullif(trim(v_line->>'description'), ''), v_product.name),
        v_product.uom_id, (v_line->>'qty')::numeric, round((v_line->>'unit_price')::numeric, 2),
        coalesce((v_line->>'discount_pct')::numeric, 0), v_tax.id, v_tax.rate, v_mode, nullif(v_line->>'lead_time_text', ''))
      returning id into v_line_id;

      select * into v_cost from public.default_unit_cost(v_product.id, v_mode, v_rate);
      if v_can_cost and nullif(v_line->>'unit_cost', '') is not null then
        insert into public.quotation_line_costs(line_id, quotation_id, unit_cost, cost_source, supplier_id)
        values (v_line_id, v_id, (v_line->>'unit_cost')::numeric,
                case when abs((v_line->>'unit_cost')::numeric - v_cost.unit_cost) < 0.0001 then v_cost.cost_source else 'manual' end,
                coalesce(nullif(v_line->>'cost_supplier_id', '')::uuid, v_cost.supplier_id));
      else
        insert into public.quotation_line_costs(line_id, quotation_id, unit_cost, cost_source, supplier_id)
        values (v_line_id, v_id, v_cost.unit_cost, v_cost.cost_source, v_cost.supplier_id);
      end if;

    elsif jsonb_typeof(v_line->'quote_product') = 'object' then
      -- New product entered on the quotation: stored apart from the catalogue.
      v_qp := v_line->'quote_product';
      if coalesce(length(trim(v_qp->>'name')), 0) < 2 then
        perform public.raise_business_error('validation', format('Line %s: enter the product name.', v_n));
      end if;
      if length(trim(v_qp->>'name')) > 200 or length(coalesce(v_qp->>'brand', '')) > 80 or length(coalesce(v_qp->>'model_no', '')) > 80
         or length(coalesce(v_qp->>'description', '')) > 4000 then
        perform public.raise_business_error('validation', format('Line %s: product name, brand, model or description is too long.', v_n));
      end if;
      if not exists (select 1 from public.units_of_measure where id = nullif(v_qp->>'uom_id', '')::uuid and is_active) then
        perform public.raise_business_error('validation', format('Line %s: select the unit of measurement.', v_n));
      end if;
      if jsonb_typeof(coalesce(v_qp->'technical_specs', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(v_qp->'technical_specs', '[]'::jsonb)) > 60 then
        perform public.raise_business_error('validation', format('Line %s: technical specifications must be a list of up to 60 name/value pairs.', v_n));
      end if;
      v_specs := '[]'::jsonb;
      for v_spec in select * from jsonb_array_elements(coalesce(v_qp->'technical_specs', '[]'::jsonb)) loop
        if coalesce(trim(v_spec->>'name'), '') <> '' then
          v_specs := v_specs || jsonb_build_object('name', left(trim(v_spec->>'name'), 80), 'value', left(coalesce(trim(v_spec->>'value'), ''), 500));
        end if;
      end loop;

      v_qp_id := nullif(v_qp->>'id', '')::uuid;
      if v_qp_id is not null then
        if not (v_qp_id = any (v_prev_qp)) or not exists (select 1 from public.quote_products where id = v_qp_id and quotation_id = v_id and status = 'proposed') then
          perform public.raise_business_error('validation', format('Line %s: this new product does not belong to the quotation.', v_n));
        end if;
        update public.quote_products set name = trim(v_qp->>'name'), description = nullif(trim(v_qp->>'description'), ''),
          brand = nullif(trim(v_qp->>'brand'), ''), model_no = nullif(trim(v_qp->>'model_no'), ''),
          technical_specs = v_specs, uom_id = (v_qp->>'uom_id')::uuid
         where id = v_qp_id;
      else
        insert into public.quote_products(quotation_id, name, description, brand, model_no, technical_specs, uom_id)
        values (v_id, trim(v_qp->>'name'), nullif(trim(v_qp->>'description'), ''), nullif(trim(v_qp->>'brand'), ''),
                nullif(trim(v_qp->>'model_no'), ''), v_specs, (v_qp->>'uom_id')::uuid)
        returning id into v_qp_id;
      end if;

      select * into v_tax from public.tax_codes
       where id = coalesce(nullif(v_line->>'tax_code_id', '')::uuid, v_customer.default_tax_code_id)
          or (coalesce(nullif(v_line->>'tax_code_id', '')::uuid, v_customer.default_tax_code_id) is null and is_default)
       limit 1;
      if not found then perform public.raise_business_error('config', 'No VAT code configured.'); end if;

      insert into public.quotation_lines(quotation_id, line_no, product_id, quote_product_id, description, uom_id, qty, unit_price,
        discount_pct, tax_code_id, tax_rate, fulfilment_mode, lead_time_text)
      values (v_id, v_n, null, v_qp_id, coalesce(nullif(trim(v_line->>'description'), ''), trim(v_qp->>'name')),
        (v_qp->>'uom_id')::uuid, (v_line->>'qty')::numeric, round((v_line->>'unit_price')::numeric, 2),
        coalesce((v_line->>'discount_pct')::numeric, 0), v_tax.id, v_tax.rate, 'procure', nullif(v_line->>'lead_time_text', ''))
      returning id into v_line_id;

      insert into public.quotation_line_costs(line_id, quotation_id, unit_cost, cost_source)
      values (v_line_id, v_id,
              case when v_can_cost and nullif(v_line->>'unit_cost', '') is not null then (v_line->>'unit_cost')::numeric else 0 end,
              case when v_can_cost and nullif(v_line->>'unit_cost', '') is not null then 'manual' else 'none' end);
    else
      perform public.raise_business_error('validation', format('Line %s: select a product or enter a new product.', v_n));
    end if;
  end loop;

  -- New products removed from the quotation are discarded; their uploaded files stay as general documents.
  delete from public.quote_products qp
   where qp.quotation_id = v_id and qp.status = 'proposed'
     and not exists (select 1 from public.quotation_lines l where l.quote_product_id = qp.id);
  -- Documents of catalogue products no longer on the quotation: reused catalogue files are dropped,
  -- uploaded files stay as general documents.
  delete from public.quotation_documents d
   where d.quotation_id = v_id and d.product_attachment_id is not null
     and not exists (select 1 from public.quotation_lines l where l.quotation_id = v_id and l.product_id = d.product_id);
  update public.quotation_documents d set product_id = null
   where d.quotation_id = v_id and d.product_id is not null and d.quote_product_id is null
     and not exists (select 1 from public.quotation_lines l where l.quotation_id = v_id and l.product_id = d.product_id);

  -- Linked enquiry moves to "quoted".
  if nullif(p->>'lead_id', '') is not null then
    update public.leads set stage = 'quoted', customer_id = coalesce(customer_id, v_customer.id)
     where id = (p->>'lead_id')::uuid and stage in ('new', 'contacted', 'qualified');
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Revisions copy new products and documents (each revision owns its copies).
-- ---------------------------------------------------------------------------
create or replace function public.revise_quotation(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  q public.quotations;
  v_new uuid;
  v_rev integer;
  l record;
  v_line uuid;
  v_map jsonb := '{}';
  qp record;
  v_qp uuid;
begin
  perform public.require_permission('quotation.create');
  select * into q from public.quotations where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Quotation not found.'); end if;
  if not public.can_view_owned(q.sales_rep_id, 'quotation.view_all') then
    perform public.raise_business_error('forbidden', 'You can only revise your own quotations.');
  end if;
  if q.status not in ('approved', 'sent', 'rejected', 'expired', 'pending_approval', 'lost') then
    perform public.raise_business_error('invalid_state', 'This quotation cannot be revised in its current status.');
  end if;
  select max(revision_no) + 1 into v_rev from public.quotations where base_doc_no = q.base_doc_no;

  perform set_config('smp.allow_locked_edit', 'on', true);
  update public.approval_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where doc_type = 'quotation' and doc_id = p_id and status = 'pending';
  update public.quotations set status = 'superseded' where id = p_id;
  perform set_config('smp.allow_locked_edit', 'off', true);

  insert into public.quotations(doc_no, base_doc_no, revision_no, parent_quotation_id, lead_id, customer_id, contact_id,
    billing_address_id, shipping_address_id, sales_rep_id, subject, customer_reference, quotation_date, valid_until,
    currency_code, exchange_rate, payment_term_id, delivery_term_id, delivery_time, delivery_location,
    terms_conditions, notes, internal_notes)
  select q.base_doc_no || '-R' || v_rev, q.base_doc_no, v_rev, q.id, q.lead_id, q.customer_id, q.contact_id,
    q.billing_address_id, q.shipping_address_id, q.sales_rep_id, q.subject, q.customer_reference, current_date,
    current_date + greatest(q.valid_until - q.quotation_date, 1), q.currency_code, q.exchange_rate, q.payment_term_id,
    q.delivery_term_id, q.delivery_time, q.delivery_location, q.terms_conditions, q.notes, q.internal_notes
  returning id into v_new;

  -- New products still awaiting the catalogue are copied; promoted ones keep their catalogue product.
  for qp in select * from public.quote_products where quotation_id = p_id loop
    if qp.status = 'proposed' then
      insert into public.quote_products(quotation_id, name, description, brand, model_no, technical_specs, uom_id)
      values (v_new, qp.name, qp.description, qp.brand, qp.model_no, qp.technical_specs, qp.uom_id)
      returning id into v_qp;
      v_map := v_map || jsonb_build_object(qp.id::text, v_qp);
    end if;
  end loop;

  for l in select ql.*, c.unit_cost, c.cost_source, c.supplier_id
             from public.quotation_lines ql left join public.quotation_line_costs c on c.line_id = ql.id
            where ql.quotation_id = p_id order by ql.line_no loop
    insert into public.quotation_lines(quotation_id, line_no, product_id, quote_product_id, description, uom_id, qty, unit_price,
      discount_pct, tax_code_id, tax_rate, fulfilment_mode, lead_time_text)
    values (v_new, l.line_no, l.product_id,
      case when l.product_id is null then (v_map->>l.quote_product_id::text)::uuid else l.quote_product_id end,
      l.description, l.uom_id, l.qty, l.unit_price, l.discount_pct, l.tax_code_id, l.tax_rate, l.fulfilment_mode, l.lead_time_text)
    returning id into v_line;
    insert into public.quotation_line_costs(line_id, quotation_id, unit_cost, cost_source, supplier_id)
    values (v_line, v_new, coalesce(l.unit_cost, 0), coalesce(l.cost_source, 'none'), l.supplier_id);
  end loop;

  -- Documents follow (the files are shared, not duplicated). Customer confirmations stay with the old revision.
  insert into public.quotation_documents(quotation_id, kind, product_id, quote_product_id, storage_path, product_attachment_id,
    file_name, mime_type, size_bytes, include_in_share, created_by)
  select v_new, d.kind, coalesce(d.product_id, (select product_id from public.quote_products x where x.id = d.quote_product_id and x.status <> 'proposed')),
    case when v_map ? d.quote_product_id::text then (v_map->>d.quote_product_id::text)::uuid end,
    d.storage_path, d.product_attachment_id, d.file_name, d.mime_type, d.size_bytes, d.include_in_share, auth.uid()
  from public.quotation_documents d
  where d.quotation_id = p_id and d.kind <> 'customer_confirmation';
  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- Converting to a sales order needs every item to be a catalogue product.
-- ---------------------------------------------------------------------------
create or replace function public.convert_quotation_to_order(
  p_quotation_id uuid, p_customer_po_ref text default null, p_required_date date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  q public.quotations;
  v_so uuid;
  v_line uuid;
  v_wh uuid;
  l record;
  v_pending text;
begin
  perform public.require_permission('sales_order.create');
  select * into q from public.quotations where id = p_quotation_id for update;
  if not found then perform public.raise_business_error('not_found', 'Quotation not found.'); end if;
  if not public.can_view_owned(q.sales_rep_id, 'quotation.view_all') then
    perform public.raise_business_error('forbidden', 'You can only convert your own quotations.');
  end if;
  if q.status not in ('approved', 'sent', 'accepted') then
    perform public.raise_business_error('invalid_state',
      'Only approved quotations can be converted to a sales order (current status: ' || q.status || ').');
  end if;
  if q.valid_until < current_date and q.status <> 'accepted' then
    perform public.raise_business_error('validation', 'This quotation has expired. Create a revision first.');
  end if;
  if exists (select 1 from public.sales_orders where quotation_id = p_quotation_id) then
    perform public.raise_business_error('duplicate', 'This quotation has already been converted.');
  end if;
  if exists (select 1 from public.customers where id = q.customer_id and status in ('blocked', 'inactive')) then
    perform public.raise_business_error('validation', 'The customer is blocked or inactive.');
  end if;
  select string_agg(format('line %s (%s)', line_no, left(description, 40)), ', ' order by line_no) into v_pending
    from public.quotation_lines where quotation_id = q.id and product_id is null;
  if v_pending is not null then
    perform public.raise_business_error('validation',
      'New products must be added to the product catalogue (or linked to an existing product) after the customer confirms, before a sales order can be created: ' || v_pending || '.');
  end if;
  select default_warehouse_id into v_wh from public.company_settings where id;

  insert into public.sales_orders(doc_no, quotation_id, customer_id, contact_id, billing_address_id, shipping_address_id,
    sales_rep_id, customer_po_ref, order_date, required_date, currency_code, exchange_rate, payment_term_id,
    delivery_term_id, delivery_location, terms_conditions, notes, internal_notes)
  values (public.next_document_number('sales_order'), q.id, q.customer_id, q.contact_id, q.billing_address_id,
    q.shipping_address_id, q.sales_rep_id, coalesce(nullif(trim(p_customer_po_ref), ''),
      case when q.confirmation_method = 'purchase_order' then q.confirmation_reference end),
    current_date, p_required_date,
    q.currency_code, q.exchange_rate, q.payment_term_id, q.delivery_term_id, q.delivery_location,
    q.terms_conditions, q.notes, q.internal_notes)
  returning id into v_so;

  for l in select ql.*, c.unit_cost, c.cost_source, c.supplier_id
             from public.quotation_lines ql left join public.quotation_line_costs c on c.line_id = ql.id
            where ql.quotation_id = q.id order by ql.line_no loop
    insert into public.sales_order_lines(sales_order_id, line_no, quotation_line_id, product_id, description, uom_id,
      qty, unit_price, discount_pct, tax_code_id, tax_rate, fulfilment_mode, warehouse_id)
    values (v_so, l.line_no, l.id, l.product_id, l.description, l.uom_id, l.qty, l.unit_price, l.discount_pct,
      l.tax_code_id, l.tax_rate, l.fulfilment_mode, case when l.fulfilment_mode = 'stock' then v_wh end)
    returning id into v_line;
    insert into public.sales_order_line_costs(line_id, sales_order_id, unit_cost, cost_source, supplier_id)
    values (v_line, v_so, coalesce(l.unit_cost, 0), coalesce(l.cost_source, 'none'), l.supplier_id);
  end loop;

  perform set_config('smp.allow_locked_edit', 'on', true);
  update public.quotations set status = 'converted', accepted_at = coalesce(accepted_at, now()) where id = q.id;
  perform set_config('smp.allow_locked_edit', 'off', true);
  if q.lead_id is not null then
    update public.leads set stage = 'won', won_at = now(), probability = 100
     where id = q.lead_id and stage <> 'won';
  end if;
  return v_so;
end $$;

-- ---------------------------------------------------------------------------
-- Customer confirmation
-- ---------------------------------------------------------------------------
create or replace function public.record_customer_confirmation(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  q public.quotations;
  v_date date;
  v_method text := nullif(trim(p->>'method'), '');
  v_new integer;
begin
  perform public.require_permission('quotation.edit');
  select * into q from public.quotations where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Quotation not found.'); end if;
  if not public.can_view_owned(q.sales_rep_id, 'quotation.view_all') then
    perform public.raise_business_error('forbidden', 'You can only update your own quotations.');
  end if;
  if q.status not in ('approved', 'sent') then
    perform public.raise_business_error('invalid_state', 'Only approved or sent quotations can be confirmed by the customer.');
  end if;
  begin
    v_date := coalesce(nullif(p->>'date', '')::date, current_date);
  exception when others then
    perform public.raise_business_error('validation', 'Enter a valid confirmation date.');
  end;
  if v_date > current_date then perform public.raise_business_error('validation', 'The confirmation date cannot be in the future.'); end if;
  if v_date < q.quotation_date then perform public.raise_business_error('validation', 'The confirmation date is before the quotation date.'); end if;
  if v_method is null or v_method not in ('purchase_order', 'email', 'signed_quotation', 'phone', 'other') then
    perform public.raise_business_error('validation', 'Select how the customer confirmed.');
  end if;
  if v_method = 'purchase_order' and coalesce(trim(p->>'reference'), '') = '' then
    perform public.raise_business_error('validation', 'Enter the customer''s purchase order number.');
  end if;
  if length(coalesce(p->>'reference', '')) > 120 or length(coalesce(p->>'note', '')) > 2000 then
    perform public.raise_business_error('validation', 'The reference or note is too long.');
  end if;

  perform set_config('smp.allow_locked_edit', 'on', true);
  update public.quotations set status = 'accepted', accepted_at = now(), sent_at = coalesce(sent_at, now()),
    confirmation_date = v_date, confirmation_method = v_method,
    confirmation_reference = nullif(trim(p->>'reference'), ''), confirmation_note = nullif(trim(p->>'note'), ''),
    confirmation_recorded_by = auth.uid(), confirmation_recorded_at = now()
  where id = p_id;
  perform set_config('smp.allow_locked_edit', 'off', true);

  select count(*) into v_new from public.quote_products where quotation_id = p_id and status = 'proposed';
  if v_new > 0 then
    perform public.notify_permission_holders('product.edit', 'New products to review',
      format('%s was confirmed by the customer and has %s new product(s) to add to the catalogue.', q.doc_no, v_new),
      '/quotations/' || p_id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Catalogue promotion
-- ---------------------------------------------------------------------------
-- Possible matches in the catalogue for a new product (same name, same model or
-- one name containing the other).
create or replace function public.find_product_matches(p_quote_product_id uuid)
returns table (id uuid, sku text, name text, brand text, model_no text, is_active boolean, match_reason text, exact boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.sku, p.name, b.name, p.model_no, p.is_active,
         case when qp.model_no is not null and (upper(p.model_no) = upper(qp.model_no) or p.sku = upper(qp.model_no)) then 'Same model / SKU'
              when public.normalize_product_name(p.name) = public.normalize_product_name(qp.name) then 'Same name'
              else 'Similar name' end,
         (qp.model_no is not null and (upper(p.model_no) = upper(qp.model_no) or p.sku = upper(qp.model_no)))
           or public.normalize_product_name(p.name) = public.normalize_product_name(qp.name)
  from public.quote_products qp
  join public.products p on
        (qp.model_no is not null and (upper(p.model_no) = upper(qp.model_no) or p.sku = upper(qp.model_no)))
     or public.normalize_product_name(p.name) = public.normalize_product_name(qp.name)
     or (length(public.normalize_product_name(qp.name)) >= 4 and length(public.normalize_product_name(p.name)) >= 4
         and (public.normalize_product_name(p.name) like '%' || public.normalize_product_name(qp.name) || '%'
              or public.normalize_product_name(qp.name) like '%' || public.normalize_product_name(p.name) || '%'))
  left join public.brands b on b.id = p.brand_id
  where qp.id = p_quote_product_id
    and (public.has_permission('product.edit') or exists (select 1 from public.quotations q where q.id = qp.quotation_id
         and public.has_permission('quotation.view') and public.can_view_owned(q.sales_rep_id, 'quotation.view_all')))
  order by 8 desc, p.is_active desc, p.name
  limit 10;
$$;

-- Approve a new product: create it in the catalogue (p.action = 'create') or link it
-- to an existing product (p.action = 'link', p.product_id). Only after the customer
-- has confirmed the quotation, only once, and never as a duplicate.
create or replace function public.promote_quote_product(p_quote_product_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  qp public.quote_products;
  q public.quotations;
  l public.quotation_lines;
  v_action text := lower(coalesce(p->>'action', ''));
  v_product uuid;
  v_name text;
  v_model text;
  v_brand uuid;
  v_dup record;
  v_type text := coalesce(nullif(p->>'item_type', ''), 'stock');
begin
  perform public.require_permission('product.edit');
  select * into qp from public.quote_products where id = p_quote_product_id for update;
  if not found then perform public.raise_business_error('not_found', 'New product not found.'); end if;
  if qp.status <> 'proposed' then
    perform public.raise_business_error('duplicate', 'This item has already been added to or linked with the product catalogue.');
  end if;
  select * into q from public.quotations where id = qp.quotation_id;
  if q.status not in ('accepted', 'converted') then
    perform public.raise_business_error('invalid_state',
      'New products can only be added to the catalogue after the customer has confirmed the quotation (current status: ' || q.status || ').');
  end if;
  select * into l from public.quotation_lines where quote_product_id = qp.id order by line_no limit 1;

  if v_action = 'link' then
    select id into v_product from public.products where id = nullif(p->>'product_id', '')::uuid and is_active;
    if v_product is null then perform public.raise_business_error('validation', 'Select an active catalogue product to link to.'); end if;
  elsif v_action = 'create' then
    v_name  := coalesce(nullif(trim(p->>'name'), ''), qp.name);
    v_model := coalesce(nullif(trim(p->>'model_no'), ''), qp.model_no);
    if v_type not in ('stock', 'non_stock', 'service') then
      perform public.raise_business_error('validation', 'Select the item type.');
    end if;
    -- Duplicate prevention: same name or same model/SKU already in the catalogue.
    select pr.sku, pr.name into v_dup from public.products pr
     where public.normalize_product_name(pr.name) = public.normalize_product_name(v_name)
        or (v_model is not null and (upper(pr.model_no) = upper(v_model) or pr.sku = upper(v_model)))
        or (nullif(trim(p->>'sku'), '') is not null and pr.sku = upper(trim(p->>'sku')))
     limit 1;
    if found then
      perform public.raise_business_error('duplicate',
        format('The catalogue already has %s %s. Link this item to that product instead of creating a duplicate.', v_dup.sku, v_dup.name));
    end if;
    if nullif(trim(qp.brand), '') is not null then
      select id into v_brand from public.brands where lower(name) = lower(trim(qp.brand));
      if v_brand is null then insert into public.brands(name) values (trim(qp.brand)) returning id into v_brand; end if;
    end if;
    v_product := public.save_product(jsonb_build_object(
      'sku', nullif(trim(p->>'sku'), ''), 'name', v_name,
      'description', coalesce(nullif(trim(p->>'description'), ''), qp.description, l.description),
      'category_id', nullif(p->>'category_id', ''), 'brand_id', v_brand, 'uom_id', qp.uom_id, 'item_type', v_type,
      'default_sell_price', coalesce(l.unit_price, 0), 'currency_code', q.currency_code, 'tax_code_id', l.tax_code_id,
      'technical_specs', qp.technical_specs, 'model_no', v_model));
  else
    perform public.raise_business_error('validation', 'Choose whether to create a new catalogue product or link to an existing one.');
  end if;

  update public.quote_products set status = case when v_action = 'create' then 'added' else 'linked' end,
    product_id = v_product, decided_at = now(), decided_by = auth.uid(), decision_note = nullif(trim(p->>'note'), '')
  where id = qp.id;
  -- The quotation lines now point at the catalogue product too; their description and price stay as quoted.
  perform set_config('smp.allow_locked_edit', 'on', true);
  update public.quotation_lines set product_id = v_product where quote_product_id = qp.id and product_id is null;
  -- Documents keep their link to the new-product record (history) and gain the catalogue product.
  update public.quotation_documents set product_id = v_product where quote_product_id = qp.id;
  perform set_config('smp.allow_locked_edit', 'off', true);
  return v_product;
end $$;

-- New products waiting for the catalogue (confirmed quotations only).
-- Catalogue maintainers (product.edit) see every pending item even without access to the
-- quotation itself; sales users see the items on quotations they can see.
create or replace view public.v_pending_quote_products as
select qp.id, qp.name, qp.description, qp.brand, qp.model_no, qp.technical_specs, qp.uom_id, u.code as uom_code, qp.created_at,
       q.id as quotation_id, q.doc_no, q.status as quotation_status, q.currency_code, q.confirmation_date,
       c.name as customer_name, r.full_name as sales_rep, cr.full_name as created_by_name,
       l.description as line_description, l.qty, l.unit_price, l.tax_code_id
from public.quote_products qp
join public.quotations q on q.id = qp.quotation_id
join public.customers c on c.id = q.customer_id
join public.units_of_measure u on u.id = qp.uom_id
left join public.profiles r on r.id = q.sales_rep_id
left join public.profiles cr on cr.id = qp.created_by
left join lateral (select * from public.quotation_lines x where x.quote_product_id = qp.id order by x.line_no limit 1) l on true
where qp.status = 'proposed' and q.status in ('accepted', 'converted')
  and (public.has_permission('product.edit')
       or (public.has_permission('quotation.view') and public.can_view_owned(q.sales_rep_id, 'quotation.view_all')));
revoke all on public.v_pending_quote_products from anon;
grant select on public.v_pending_quote_products to authenticated;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
create or replace function public.quotation_documents_editable(p_quotation_id uuid)
returns public.quotations language plpgsql stable security definer set search_path = public as $$
declare q public.quotations;
begin
  perform public.require_permission('quotation.edit');
  select * into q from public.quotations where id = p_quotation_id;
  if not found then perform public.raise_business_error('not_found', 'Quotation not found.'); end if;
  if not public.can_view_owned(q.sales_rep_id, 'quotation.view_all') then
    perform public.raise_business_error('forbidden', 'You can only change documents on your own quotations.');
  end if;
  if q.status in ('superseded', 'lost') then
    perform public.raise_business_error('locked', 'Documents cannot be changed on a superseded or lost quotation.');
  end if;
  return q;
end $$;
revoke execute on function public.quotation_documents_editable(uuid) from public, anon, authenticated;

-- p: { quotation_id, kind, product_id?, quote_product_id?, include_in_share?,
--      and either storage_path + file_name + mime_type + size_bytes, or product_attachment_id }
create or replace function public.add_quotation_document(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  q public.quotations;
  v_kind text := coalesce(nullif(p->>'kind', ''), 'supporting');
  v_path text := nullif(p->>'storage_path', '');
  v_att public.product_attachments;
  v_product uuid := nullif(p->>'product_id', '')::uuid;
  v_qp uuid := nullif(p->>'quote_product_id', '')::uuid;
  v_mime text := nullif(p->>'mime_type', '');
  v_id uuid;
begin
  q := public.quotation_documents_editable(nullif(p->>'quotation_id', '')::uuid);
  if v_kind not in ('datasheet', 'drawing', 'certificate', 'supporting', 'customer_confirmation', 'other') then
    perform public.raise_business_error('validation', 'Unknown document type.');
  end if;
  if (select count(*) from public.quotation_documents where quotation_id = q.id) >= 50 then
    perform public.raise_business_error('validation', 'A quotation can have at most 50 documents.');
  end if;
  if v_product is not null and v_qp is not null then
    perform public.raise_business_error('validation', 'A document can belong to one item only.');
  end if;
  if v_product is not null and not exists (select 1 from public.quotation_lines where quotation_id = q.id and product_id = v_product) then
    perform public.raise_business_error('validation', 'That product is not on this quotation.');
  end if;
  if v_qp is not null and not exists (select 1 from public.quote_products where id = v_qp and quotation_id = q.id) then
    perform public.raise_business_error('validation', 'That new product is not on this quotation.');
  end if;

  if nullif(p->>'product_attachment_id', '') is not null then
    -- Reuse a datasheet from the catalogue (no copy of the file is made).
    select * into v_att from public.product_attachments where id = (p->>'product_attachment_id')::uuid;
    if not found or not exists (select 1 from public.quotation_lines where quotation_id = q.id and product_id = v_att.product_id) then
      perform public.raise_business_error('validation', 'That catalogue document does not belong to a product on this quotation.');
    end if;
    if exists (select 1 from public.quotation_documents where quotation_id = q.id and product_attachment_id = v_att.id) then
      perform public.raise_business_error('duplicate', 'This catalogue document is already attached.');
    end if;
    insert into public.quotation_documents(quotation_id, kind, product_id, product_attachment_id, file_name, mime_type, size_bytes, include_in_share)
    values (q.id, case when v_att.kind in ('datasheet', 'drawing', 'certificate') then v_att.kind else 'other' end,
            v_att.product_id, v_att.id, v_att.file_name, v_att.mime_type, v_att.size_bytes, coalesce((p->>'include_in_share')::boolean, true))
    returning id into v_id;
  else
    if v_path is null or v_path not like 'quotations/' || q.id::text || '/%' or v_path like '%..%' then
      perform public.raise_business_error('validation', 'Upload the file again.');
    end if;
    if v_mime is null or v_mime not in ('application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
       and not (v_kind = 'customer_confirmation' and v_mime in ('image/jpeg', 'image/png')) then
      perform public.raise_business_error('validation', 'Only PDF, DOC and DOCX files can be attached.');
    end if;
    if coalesce((p->>'size_bytes')::bigint, 0) not between 1 and 26214400 then
      perform public.raise_business_error('validation', 'Files must be 25 MB or smaller.');
    end if;
    if coalesce(length(trim(p->>'file_name')), 0) = 0 then
      perform public.raise_business_error('validation', 'The file needs a name.');
    end if;
    insert into public.quotation_documents(quotation_id, kind, product_id, quote_product_id, storage_path, file_name, mime_type, size_bytes, include_in_share)
    values (q.id, v_kind, v_product, v_qp, v_path, left(trim(p->>'file_name'), 255), v_mime, (p->>'size_bytes')::bigint,
            case when v_kind = 'customer_confirmation' then false else coalesce((p->>'include_in_share')::boolean, true) end)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Returns the storage path when no other quotation (revision) still uses the file,
-- so the caller can delete it from storage.
create or replace function public.remove_quotation_document(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare d public.quotation_documents;
begin
  select * into d from public.quotation_documents where id = p_id;
  if not found then perform public.raise_business_error('not_found', 'Document not found.'); end if;
  perform public.quotation_documents_editable(d.quotation_id);
  delete from public.quotation_documents where id = p_id;
  if d.storage_path is not null and not exists (select 1 from public.quotation_documents where storage_path = d.storage_path) then
    return d.storage_path;
  end if;
  return null;
end $$;

create or replace function public.set_quotation_document_shared(p_id uuid, p_share boolean)
returns void language plpgsql security definer set search_path = public as $$
declare d public.quotation_documents;
begin
  select * into d from public.quotation_documents where id = p_id;
  if not found then perform public.raise_business_error('not_found', 'Document not found.'); end if;
  perform public.quotation_documents_editable(d.quotation_id);
  update public.quotation_documents set include_in_share = p_share where id = p_id;
end $$;

grant execute on function public.record_customer_confirmation(uuid, jsonb), public.find_product_matches(uuid),
  public.promote_quote_product(uuid, jsonb), public.add_quotation_document(jsonb), public.remove_quotation_document(uuid),
  public.set_quotation_document_shared(uuid, boolean) to authenticated;
revoke execute on function public.record_customer_confirmation(uuid, jsonb), public.find_product_matches(uuid),
  public.promote_quote_product(uuid, jsonb), public.add_quotation_document(jsonb), public.remove_quotation_document(uuid),
  public.set_quotation_document_shared(uuid, boolean) from anon;

-- ---------------------------------------------------------------------------
-- Storage: private bucket "quotation-docs", paths quotations/<quotation_id>/<file>.
-- A file is readable by whoever can see a quotation that lists it (and by catalogue
-- maintainers for datasheets of new products under review).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('quotation-docs', 'quotation-docs', false, 26214400,
            array['application/pdf', 'application/msword',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'])
    on conflict (id) do nothing;

    execute $p$create policy quotation_docs_read on storage.objects for select to authenticated
      using (bucket_id = 'quotation-docs' and exists (select 1 from public.quotation_documents d where d.storage_path = name))$p$;
    execute $p$create policy quotation_docs_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'quotation-docs' and public.has_permission('quotation.edit')
                  and (storage.foldername(name))[1] = 'quotations'
                  and exists (select 1 from public.quotations q where q.id::text = (storage.foldername(name))[2]
                              and q.status not in ('superseded', 'lost')
                              and public.can_view_owned(q.sales_rep_id, 'quotation.view_all')))$p$;
    -- Delete only files that no quotation lists any more (remove_quotation_document runs first).
    execute $p$create policy quotation_docs_delete on storage.objects for delete to authenticated
      using (bucket_id = 'quotation-docs' and public.has_permission('quotation.edit')
             and exists (select 1 from public.quotations q where q.id::text = (storage.foldername(name))[2]
                         and public.can_view_owned(q.sales_rep_id, 'quotation.view_all'))
             and not exists (select 1 from public.quotation_documents d where d.storage_path = name))$p$;
  end if;
end $$;
