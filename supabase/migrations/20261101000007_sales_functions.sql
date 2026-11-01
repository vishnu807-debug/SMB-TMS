-- =============================================================================
-- 0004 Sales & CRM business functions.
-- Every multi-table write or status change happens here, in one transaction,
-- with an explicit permission check. The app never writes these tables
-- directly except where RLS allows simple inserts (activities).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
create or replace function public.base_currency()
returns char(3) language sql stable security definer set search_path = public as $$
  select base_currency from public.company_settings where id
$$;

-- Latest rate (1 unit of p_currency = x base currency) on or before p_date.
create or replace function public.rate_to_base(p_currency char(3), p_date date default current_date)
returns numeric language sql stable security definer set search_path = public as $$
  select case when p_currency = public.base_currency() then 1::numeric
              else (select rate_to_base from public.exchange_rates
                     where currency_code = p_currency and rate_date <= p_date
                     order by rate_date desc limit 1) end
$$;

create or replace function public.can_view_owned(p_owner uuid, p_view_all text)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (auth.uid() = p_owner or public.has_permission(p_view_all))
$$;

-- Default internal cost for a product in the document currency.
-- Stock items: weighted-average cost across warehouses (AED).
-- Procured items (or stock with no stock): preferred supplier's last cost.
create or replace function public.default_unit_cost(
  p_product_id uuid, p_mode public.fulfilment_mode, p_doc_rate numeric,
  out unit_cost numeric, out cost_source text, out supplier_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_avg numeric;
  v_sp  record;
  v_sp_rate numeric;
begin
  unit_cost := 0; cost_source := 'none'; supplier_id := null;
  if p_mode = 'stock' then
    select case when sum(qty_on_hand) > 0 then sum(qty_on_hand * avg_cost) / sum(qty_on_hand) end
      into v_avg from public.stock_levels where product_id = p_product_id;
    if v_avg is not null and v_avg > 0 then
      unit_cost := round(v_avg / p_doc_rate, 4); cost_source := 'stock_avg';
      return;
    end if;
  end if;
  select sp.* into v_sp from public.supplier_products sp
   where sp.product_id = p_product_id
   order by sp.is_preferred desc, sp.updated_at desc limit 1;
  if found and v_sp.last_cost > 0 then
    v_sp_rate := public.rate_to_base(v_sp.currency_code);
    if v_sp_rate is not null then
      unit_cost := round(v_sp.last_cost * v_sp_rate / p_doc_rate, 4);
      cost_source := 'supplier';
      supplier_id := v_sp.supplier_id;
      return;
    end if;
  end if;
  -- Last resort: the purchase price on the product master.
  select round(p.purchase_price * public.rate_to_base(p.currency_code) / p_doc_rate, 4), p.default_supplier_id
    into v_avg, supplier_id
    from public.products p where p.id = p_product_id and p.purchase_price > 0;
  if v_avg is not null then
    unit_cost := v_avg; cost_source := 'supplier';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
-- Possible duplicates by normalised name, TRN, or email.
create or replace function public.find_customer_duplicates(
  p_name text, p_trn text default null, p_email text default null, p_exclude uuid default null)
returns table (id uuid, code text, name text, trn text, match_reason text)
language sql stable security definer set search_path = public as $$
  select c.id, c.code, c.name, c.trn,
         case when p_trn is not null and c.trn = p_trn then 'Same TRN'
              when p_email is not null and c.email = p_email::citext then 'Same email'
              else 'Similar name' end
  from public.customers c
  where public.has_permission('customer.view')
    and (p_exclude is null or c.id <> p_exclude)
    and ( (p_trn is not null and c.trn = p_trn)
       or (p_email is not null and c.email = p_email::citext)
       or (length(public.normalize_party_name(p_name)) > 2
           and c.name_normalized = public.normalize_party_name(p_name)) )
  limit 5;
$$;

-- Create or update a customer with its contacts and addresses in one call.
create or replace function public.save_customer(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id      uuid := nullif(p->>'id', '')::uuid;
  v_old     public.customers;
  v_manager uuid;
  v_trn     text := nullif(regexp_replace(coalesce(p->>'trn', ''), '\s', '', 'g'), '');
  v_contact jsonb;
  v_addr    jsonb;
  v_keep    uuid[];
  v_new_id  uuid;
begin
  if v_id is null then
    perform public.require_permission('customer.create');
  else
    perform public.require_permission('customer.edit');
    select * into v_old from public.customers where id = v_id for update;
    if not found then perform public.raise_business_error('not_found', 'Customer not found.'); end if;
    if not public.can_view_owned(v_old.account_manager_id, 'customer.view_all') then
      perform public.raise_business_error('forbidden', 'You can only edit customers assigned to you.');
    end if;
  end if;

  -- Keep the current representative unless a new one is given; changing it needs customer.assign.
  v_manager := coalesce(nullif(p->>'account_manager_id', '')::uuid, v_old.account_manager_id, auth.uid());
  if v_manager is distinct from coalesce(v_old.account_manager_id, auth.uid())
     and not public.has_permission('customer.assign') then
    perform public.raise_business_error('forbidden', 'You cannot assign customers to another sales representative.');
  end if;
  if coalesce((p->>'credit_limit')::numeric, 0) <> coalesce(v_old.credit_limit, 0)
     and not public.has_permission('customer.set_credit') then
    perform public.raise_business_error('forbidden', 'Only Accounts or Management can change a credit limit.');
  end if;
  if coalesce((p->>'status'), 'active') in ('blocked', 'on_hold')
     and coalesce(v_old.status::text, 'active') <> (p->>'status')
     and not public.has_permission('customer.set_credit') then
    perform public.raise_business_error('forbidden', 'Only Accounts or Management can put a customer on hold or block it.');
  end if;
  if coalesce(length(trim(p->>'name')), 0) < 2 then
    perform public.raise_business_error('validation', 'Enter the customer''s company name.');
  end if;
  if v_trn is not null and v_trn !~ '^[0-9]{15}$' then
    perform public.raise_business_error('validation', 'The TRN must be exactly 15 digits.');
  end if;
  if coalesce((p->>'vat_registered')::boolean, false) and v_trn is null then
    perform public.raise_business_error('validation', 'Enter the TRN for a VAT-registered customer.');
  end if;
  if v_trn is not null and exists (select 1 from public.customers c where c.trn = v_trn and c.id is distinct from v_id) then
    perform public.raise_business_error('duplicate', 'Another customer already has this TRN.');
  end if;

  if v_id is null then
    insert into public.customers (name, customer_type, trade_license_no, trn, vat_registered, default_tax_code_id,
      industry, website, email, phone, currency_code, payment_term_id, delivery_term_id, credit_limit,
      account_manager_id, status, source, notes)
    values (trim(p->>'name'), coalesce(p->>'customer_type', 'company')::public.customer_type,
      nullif(p->>'trade_license_no', ''), v_trn, coalesce((p->>'vat_registered')::boolean, v_trn is not null),
      nullif(p->>'default_tax_code_id', '')::uuid, nullif(p->>'industry', ''), nullif(p->>'website', ''),
      nullif(p->>'email', ''), nullif(p->>'phone', ''), coalesce(nullif(p->>'currency_code', ''), public.base_currency()),
      nullif(p->>'payment_term_id', '')::uuid, nullif(p->>'delivery_term_id', '')::uuid,
      coalesce((p->>'credit_limit')::numeric, 0), v_manager,
      coalesce(p->>'status', 'active')::public.party_status, nullif(p->>'source', ''), nullif(p->>'notes', ''))
    returning id into v_id;
  else
    update public.customers set
      name = trim(p->>'name'),
      customer_type = coalesce(p->>'customer_type', 'company')::public.customer_type,
      trade_license_no = nullif(p->>'trade_license_no', ''),
      trn = v_trn,
      vat_registered = coalesce((p->>'vat_registered')::boolean, v_trn is not null),
      default_tax_code_id = nullif(p->>'default_tax_code_id', '')::uuid,
      industry = nullif(p->>'industry', ''), website = nullif(p->>'website', ''),
      email = nullif(p->>'email', ''), phone = nullif(p->>'phone', ''),
      currency_code = coalesce(nullif(p->>'currency_code', ''), public.base_currency()),
      payment_term_id = nullif(p->>'payment_term_id', '')::uuid,
      delivery_term_id = nullif(p->>'delivery_term_id', '')::uuid,
      credit_limit = coalesce((p->>'credit_limit')::numeric, 0),
      account_manager_id = v_manager,
      status = coalesce(p->>'status', 'active')::public.party_status,
      source = nullif(p->>'source', ''), notes = nullif(p->>'notes', '')
    where id = v_id;
  end if;

  -- Contacts: upsert the ones sent, delete the ones removed (unless in use).
  v_keep := '{}';
  update public.customer_contacts set is_primary = false where customer_id = v_id;
  for v_contact in select * from jsonb_array_elements(coalesce(p->'contacts', '[]'::jsonb)) loop
    if nullif(v_contact->>'id', '') is not null then
      update public.customer_contacts set name = trim(v_contact->>'name'),
        designation = nullif(v_contact->>'designation', ''), email = nullif(v_contact->>'email', ''),
        phone = nullif(v_contact->>'phone', ''), mobile = nullif(v_contact->>'mobile', ''),
        is_primary = coalesce((v_contact->>'is_primary')::boolean, false)
      where id = (v_contact->>'id')::uuid and customer_id = v_id;
      v_keep := v_keep || (v_contact->>'id')::uuid;
    else
      insert into public.customer_contacts(customer_id, name, designation, email, phone, mobile, is_primary)
      values (v_id, trim(v_contact->>'name'), nullif(v_contact->>'designation', ''), nullif(v_contact->>'email', ''),
              nullif(v_contact->>'phone', ''), nullif(v_contact->>'mobile', ''),
              coalesce((v_contact->>'is_primary')::boolean, false))
      returning id into v_new_id;
      v_keep := v_keep || v_new_id;
    end if;
  end loop;
  delete from public.customer_contacts cc where cc.customer_id = v_id and cc.id <> all(v_keep)
    and not exists (select 1 from public.quotations q where q.contact_id = cc.id)
    and not exists (select 1 from public.sales_orders s where s.contact_id = cc.id);

  v_keep := '{}';
  update public.customer_addresses set is_default = false where customer_id = v_id;
  for v_addr in select * from jsonb_array_elements(coalesce(p->'addresses', '[]'::jsonb)) loop
    if nullif(v_addr->>'id', '') is not null then
      update public.customer_addresses set kind = (v_addr->>'kind')::public.address_kind,
        label = nullif(v_addr->>'label', ''), line1 = trim(v_addr->>'line1'), line2 = nullif(v_addr->>'line2', ''),
        city = trim(v_addr->>'city'), emirate = nullif(v_addr->>'emirate', ''),
        country = coalesce(nullif(v_addr->>'country', ''), 'United Arab Emirates'),
        po_box = nullif(v_addr->>'po_box', ''), is_default = coalesce((v_addr->>'is_default')::boolean, false)
      where id = (v_addr->>'id')::uuid and customer_id = v_id;
      v_keep := v_keep || (v_addr->>'id')::uuid;
    else
      insert into public.customer_addresses(customer_id, kind, label, line1, line2, city, emirate, country, po_box, is_default)
      values (v_id, (v_addr->>'kind')::public.address_kind, nullif(v_addr->>'label', ''), trim(v_addr->>'line1'),
              nullif(v_addr->>'line2', ''), trim(v_addr->>'city'), nullif(v_addr->>'emirate', ''),
              coalesce(nullif(v_addr->>'country', ''), 'United Arab Emirates'), nullif(v_addr->>'po_box', ''),
              coalesce((v_addr->>'is_default')::boolean, false))
      returning id into v_new_id;
      v_keep := v_keep || v_new_id;
    end if;
  end loop;
  delete from public.customer_addresses ca where ca.customer_id = v_id and ca.id <> all(v_keep)
    and not exists (select 1 from public.quotations q where ca.id in (q.billing_address_id, q.shipping_address_id))
    and not exists (select 1 from public.sales_orders s where ca.id in (s.billing_address_id, s.shipping_address_id));

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
create or replace function public.save_lead(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid := nullif(p->>'id', '')::uuid;
  v_old   public.leads;
  v_owner uuid := coalesce(nullif(p->>'owner_id', '')::uuid, auth.uid());
  v_item  jsonb;
begin
  if v_id is null then
    perform public.require_permission('lead.create');
  else
    perform public.require_permission('lead.edit');
    select * into v_old from public.leads where id = v_id for update;
    if not found then perform public.raise_business_error('not_found', 'Enquiry not found.'); end if;
    if not public.can_view_owned(v_old.owner_id, 'lead.view_all') then
      perform public.raise_business_error('forbidden', 'You can only edit your own enquiries.');
    end if;
    if v_old.stage in ('won', 'lost') then
      perform public.raise_business_error('locked', 'Closed enquiries cannot be edited. Reopen it first.');
    end if;
  end if;
  if v_owner <> auth.uid() and not public.has_permission('lead.assign') then
    perform public.raise_business_error('forbidden', 'You cannot assign enquiries to another person.');
  end if;

  if v_id is null then
    insert into public.leads(title, source, customer_id, company_name, contact_name, contact_email, contact_phone,
      requirement, estimated_value, currency_code, probability, expected_close_date, priority, owner_id)
    values (trim(p->>'title'), coalesce(p->>'source', 'other')::public.lead_source,
      nullif(p->>'customer_id', '')::uuid, nullif(trim(p->>'company_name'), ''), nullif(p->>'contact_name', ''),
      nullif(p->>'contact_email', ''), nullif(p->>'contact_phone', ''), nullif(p->>'requirement', ''),
      nullif(p->>'estimated_value', '')::numeric, coalesce(nullif(p->>'currency_code', ''), public.base_currency()),
      coalesce((p->>'probability')::smallint, 20), nullif(p->>'expected_close_date', '')::date,
      coalesce(p->>'priority', 'medium')::public.priority_level, v_owner)
    returning id into v_id;
    if v_owner <> auth.uid() then
      perform public.notify_user(v_owner, 'New enquiry assigned to you', trim(p->>'title'), '/leads/' || v_id);
    end if;
  else
    update public.leads set title = trim(p->>'title'), source = coalesce(p->>'source', 'other')::public.lead_source,
      customer_id = nullif(p->>'customer_id', '')::uuid, company_name = nullif(trim(p->>'company_name'), ''),
      contact_name = nullif(p->>'contact_name', ''), contact_email = nullif(p->>'contact_email', ''),
      contact_phone = nullif(p->>'contact_phone', ''), requirement = nullif(p->>'requirement', ''),
      estimated_value = nullif(p->>'estimated_value', '')::numeric,
      currency_code = coalesce(nullif(p->>'currency_code', ''), public.base_currency()),
      probability = coalesce((p->>'probability')::smallint, 20),
      expected_close_date = nullif(p->>'expected_close_date', '')::date,
      priority = coalesce(p->>'priority', 'medium')::public.priority_level, owner_id = v_owner
    where id = v_id;
    if v_owner <> v_old.owner_id then
      perform public.notify_user(v_owner, 'Enquiry reassigned to you', trim(p->>'title'), '/leads/' || v_id);
    end if;
  end if;

  delete from public.lead_items where lead_id = v_id;
  for v_item in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    insert into public.lead_items(lead_id, product_id, description, qty, target_price)
    values (v_id, nullif(v_item->>'product_id', '')::uuid, trim(v_item->>'description'),
            (v_item->>'qty')::numeric, nullif(v_item->>'target_price', '')::numeric);
  end loop;
  return v_id;
end $$;

create or replace function public.set_lead_stage(p_id uuid, p_stage public.lead_stage, p_lost_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_lead public.leads;
begin
  perform public.require_permission('lead.edit');
  select * into v_lead from public.leads where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Enquiry not found.'); end if;
  if not public.can_view_owned(v_lead.owner_id, 'lead.view_all') then
    perform public.raise_business_error('forbidden', 'You can only update your own enquiries.');
  end if;
  if p_stage = 'lost' and coalesce(trim(p_lost_reason), '') = '' then
    perform public.raise_business_error('validation', 'Please give a reason the enquiry was lost.');
  end if;
  update public.leads set stage = p_stage,
         lost_reason = case when p_stage = 'lost' then trim(p_lost_reason) else null end,
         won_at = case when p_stage = 'won' then coalesce(won_at, now()) else null end,
         probability = case p_stage when 'won' then 100 when 'lost' then 0 else probability end
   where id = p_id;
end $$;

-- Turn an enquiry from a new company into a customer (with its contact).
create or replace function public.convert_lead_to_customer(p_lead_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_lead public.leads;
  v_customer uuid;
begin
  perform public.require_permission('customer.create');
  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then perform public.raise_business_error('not_found', 'Enquiry not found.'); end if;
  if not public.can_view_owned(v_lead.owner_id, 'lead.view_all') then
    perform public.raise_business_error('forbidden', 'You can only convert your own enquiries.');
  end if;
  if v_lead.customer_id is not null then
    return v_lead.customer_id;
  end if;
  if exists (select 1 from public.find_customer_duplicates(v_lead.company_name, null, v_lead.contact_email)) then
    perform public.raise_business_error('duplicate',
      'A customer with a similar name or email already exists. Link the enquiry to that customer instead.');
  end if;
  v_customer := public.save_customer(jsonb_build_object(
    'name', v_lead.company_name, 'email', v_lead.contact_email, 'phone', v_lead.contact_phone,
    'account_manager_id', v_lead.owner_id, 'source', v_lead.source::text,
    'contacts', case when v_lead.contact_name is not null then
       jsonb_build_array(jsonb_build_object('name', v_lead.contact_name, 'email', v_lead.contact_email,
                                            'phone', v_lead.contact_phone, 'is_primary', true))
       else '[]'::jsonb end));
  update public.leads set customer_id = v_customer,
         stage = case when stage in ('new', 'contacted') then 'qualified' else stage end
   where id = p_lead_id;
  return v_customer;
end $$;

-- ---------------------------------------------------------------------------
-- Activities & follow-ups
-- ---------------------------------------------------------------------------
create or replace function public.complete_activity(p_id uuid, p_outcome text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_act public.activities;
begin
  perform public.require_permission('activity.manage');
  select * into v_act from public.activities where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Activity not found.'); end if;
  if v_act.owner_id <> auth.uid() and not public.has_permission('activity.view_all') then
    perform public.raise_business_error('forbidden', 'You can only complete your own follow-ups.');
  end if;
  update public.activities set completed_at = coalesce(completed_at, now()),
         outcome = coalesce(nullif(trim(p_outcome), ''), outcome)
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------------
-- Create a new draft or replace an existing draft (header + all lines).
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
    delete from public.quotation_lines where quotation_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p->'lines') loop
    v_n := v_n + 1;
    select * into v_product from public.products where id = nullif(v_line->>'product_id', '')::uuid;
    if not found then perform public.raise_business_error('validation', format('Line %s: select a product.', v_n)); end if;
    if not v_product.is_active then
      perform public.raise_business_error('validation', format('Line %s: %s is inactive.', v_n, v_product.name));
    end if;
    select * into v_tax from public.tax_codes
     where id = coalesce(nullif(v_line->>'tax_code_id', '')::uuid, v_customer.default_tax_code_id, v_product.tax_code_id)
        or (coalesce(nullif(v_line->>'tax_code_id', '')::uuid, v_customer.default_tax_code_id, v_product.tax_code_id) is null and is_default)
     limit 1;
    if not found then perform public.raise_business_error('config', 'No VAT code configured.'); end if;
    if coalesce((v_line->>'qty')::numeric, 0) <= 0 then
      perform public.raise_business_error('validation', format('Line %s: quantity must be greater than zero.', v_n));
    end if;
    if coalesce((v_line->>'unit_price')::numeric, -1) < 0 then
      perform public.raise_business_error('validation', format('Line %s: unit price cannot be negative.', v_n));
    end if;
    if coalesce((v_line->>'discount_pct')::numeric, 0) not between 0 and 100 then
      perform public.raise_business_error('validation', format('Line %s: discount must be between 0 and 100%%.', v_n));
    end if;
    v_mode := coalesce(nullif(v_line->>'fulfilment_mode', ''),
                       case when v_product.item_type = 'stock' then 'stock' else 'procure' end)::public.fulfilment_mode;
    if v_mode = 'stock' and v_product.item_type <> 'stock' then
      perform public.raise_business_error('validation', format('Line %s: %s is not a stock item; use direct procurement.', v_n, v_product.name));
    end if;

    insert into public.quotation_lines(quotation_id, line_no, product_id, description, uom_id, qty, unit_price,
      discount_pct, tax_code_id, tax_rate, fulfilment_mode, lead_time_text)
    values (v_id, v_n, v_product.id, coalesce(nullif(trim(v_line->>'description'), ''), v_product.name),
      v_product.uom_id, (v_line->>'qty')::numeric, round((v_line->>'unit_price')::numeric, 2),
      coalesce((v_line->>'discount_pct')::numeric, 0), v_tax.id, v_tax.rate, v_mode, nullif(v_line->>'lead_time_text', ''))
    returning id into v_line_id;

    -- Cost: entered value only from users allowed to see costs; otherwise system default.
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
  end loop;

  -- Linked enquiry moves to "quoted".
  if nullif(p->>'lead_id', '') is not null then
    update public.leads set stage = 'quoted', customer_id = coalesce(customer_id, v_customer.id)
     where id = (p->>'lead_id')::uuid and stage in ('new', 'contacted', 'qualified');
  end if;
  return v_id;
end $$;

-- Margin figures for one quotation (null for users without view_cost).
create or replace function public.quotation_margin(p_id uuid)
returns table (total_cost numeric, gross_profit numeric, gross_margin_pct numeric,
               total_cost_base numeric, gross_profit_base numeric)
language sql stable security definer set search_path = public as $$
  select round(sum(l.qty * c.unit_cost), 2),
         round(q.net_total - sum(l.qty * c.unit_cost), 2),
         case when q.net_total > 0 then round((q.net_total - sum(l.qty * c.unit_cost)) / q.net_total * 100, 2) end,
         round(sum(l.qty * c.unit_cost) * q.exchange_rate, 2),
         round((q.net_total - sum(l.qty * c.unit_cost)) * q.exchange_rate, 2)
  from public.quotations q
  join public.quotation_lines l on l.quotation_id = q.id
  join public.quotation_line_costs c on c.line_id = l.id
  where q.id = p_id and public.has_permission('quotation.view_cost')
  group by q.id, q.net_total, q.exchange_rate;
$$;

-- Evaluate approval rules; returns the breached reasons (empty = no approval needed).
create or replace function public.evaluate_quotation_rules(p_id uuid, out reasons text[], out approver text)
language plpgsql stable security definer set search_path = public as $$
declare
  q public.quotations;
  r public.approval_rules;
  v_margin numeric;
  v_val numeric;
begin
  reasons := '{}';
  select * into q from public.quotations where id = p_id;
  select case when q.net_total > 0 then (q.net_total - sum(l.qty * c.unit_cost)) / q.net_total * 100 end
    into v_margin
    from public.quotation_lines l join public.quotation_line_costs c on c.line_id = l.id
   where l.quotation_id = p_id;
  for r in select * from public.approval_rules where doc_type = 'quotation' and is_active order by name loop
    v_val := case r.metric when 'max_discount_pct' then q.max_discount_pct
                           when 'margin_pct' then v_margin
                           when 'total_base' then q.total_base end;
    if v_val is not null and ((r.comparison = 'gt' and v_val > r.threshold) or (r.comparison = 'lt' and v_val < r.threshold)) then
      reasons := reasons || format('%s (%s %s %s)', r.name,
        case r.metric when 'total_base' then to_char(v_val, 'FM999,999,999,990.00') || ' ' || public.base_currency()
                      else to_char(v_val, 'FM9990.00') || '%' end,
        case r.comparison when 'gt' then '>' else '<' end,
        case r.metric when 'total_base' then to_char(r.threshold, 'FM999,999,999,990') else to_char(r.threshold, 'FM9990.##') || '%' end);
      approver := r.approver_permission;
    end if;
  end loop;
end $$;

-- Draft → approved (no rule breached) or pending_approval.
create or replace function public.submit_quotation(p_id uuid)
returns public.quotation_status language plpgsql security definer set search_path = public as $$
declare
  q public.quotations;
  v_eval record;
begin
  perform public.require_permission('quotation.edit');
  select * into q from public.quotations where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Quotation not found.'); end if;
  if not public.can_view_owned(q.sales_rep_id, 'quotation.view_all') then
    perform public.raise_business_error('forbidden', 'You can only submit your own quotations.');
  end if;
  if q.status <> 'draft' then
    perform public.raise_business_error('invalid_state', 'Only draft quotations can be submitted.');
  end if;
  if q.valid_until < current_date then
    perform public.raise_business_error('validation', 'The validity date has already passed. Update it before submitting.');
  end if;
  if not exists (select 1 from public.quotation_lines where quotation_id = p_id) then
    perform public.raise_business_error('validation', 'The quotation has no items.');
  end if;

  select * into v_eval from public.evaluate_quotation_rules(p_id);
  if cardinality(v_eval.reasons) > 0 then
    update public.quotations set status = 'pending_approval', submitted_at = now() where id = p_id;
    insert into public.approval_requests(doc_type, doc_id, doc_no, reasons, approver_permission, requested_by)
    values ('quotation', p_id, q.doc_no, v_eval.reasons, v_eval.approver, auth.uid());
    perform public.notify_permission_holders(v_eval.approver, 'Quotation awaiting approval',
      q.doc_no || ': ' || array_to_string(v_eval.reasons, '; '), '/quotations/' || p_id);
    return 'pending_approval';
  end if;
  update public.quotations set status = 'approved', submitted_at = now(), approved_at = now(),
         approved_by = auth.uid() where id = p_id;
  return 'approved';
end $$;

-- Approve or reject any pending request (quotation or sales order).
create or replace function public.decide_approval(p_request_id uuid, p_approve boolean, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  a public.approval_requests;
begin
  select * into a from public.approval_requests where id = p_request_id for update;
  if not found then perform public.raise_business_error('not_found', 'Approval request not found.'); end if;
  perform public.require_permission(a.approver_permission);
  if a.status <> 'pending' then
    perform public.raise_business_error('invalid_state', 'This request has already been decided.');
  end if;
  if a.requested_by = auth.uid() and not public.has_permission('approval.self_approve') then
    perform public.raise_business_error('forbidden', 'You cannot approve your own request.');
  end if;
  if not p_approve and coalesce(trim(p_comment), '') = '' then
    perform public.raise_business_error('validation', 'Please give a reason for rejecting.');
  end if;

  update public.approval_requests set status = case when p_approve then 'approved' else 'rejected' end::public.approval_status,
         decided_by = auth.uid(), decided_at = now(), comment = nullif(trim(p_comment), '')
   where id = p_request_id;

  if a.doc_type = 'quotation' then
    update public.quotations set
      status = case when p_approve then 'approved' else 'rejected' end::public.quotation_status,
      approved_at = case when p_approve then now() end,
      approved_by = case when p_approve then auth.uid() end
    where id = a.doc_id and status = 'pending_approval';
    perform public.notify_user(a.requested_by,
      'Quotation ' || a.doc_no || case when p_approve then ' approved' else ' rejected' end,
      p_comment, '/quotations/' || a.doc_id);
  elsif a.doc_type = 'sales_order' then
    if p_approve then
      perform public.sales_order_apply_confirmation(a.doc_id);
    else
      update public.sales_orders set status = 'draft' where id = a.doc_id and status = 'pending_approval';
    end if;
    perform public.notify_user(a.requested_by,
      'Sales order ' || a.doc_no || case when p_approve then ' approved and confirmed' else ' rejected' end,
      p_comment, '/sales-orders/' || a.doc_id);
  elsif a.doc_type = 'stock_adjustment' then
    if p_approve then
      perform public.stock_adjustment_apply(a.doc_id);
    else
      update public.stock_adjustments set status = 'rejected', rejection_reason = trim(p_comment)
       where id = a.doc_id and status = 'submitted';
    end if;
    perform public.notify_user(a.requested_by,
      'Stock adjustment ' || a.doc_no || case when p_approve then ' approved and posted' else ' rejected' end,
      p_comment, '/inventory/adjustments/' || a.doc_id);
  end if;
end $$;

-- Rejected quotations go back to draft for rework.
create or replace function public.reopen_quotation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare q public.quotations;
begin
  perform public.require_permission('quotation.edit');
  select * into q from public.quotations where id = p_id for update;
  if not public.can_view_owned(q.sales_rep_id, 'quotation.view_all') then
    perform public.raise_business_error('forbidden', 'You can only reopen your own quotations.');
  end if;
  if q.status not in ('rejected', 'pending_approval') then
    perform public.raise_business_error('invalid_state', 'Only rejected or pending quotations can be returned to draft.');
  end if;
  update public.approval_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where doc_type = 'quotation' and doc_id = p_id and status = 'pending';
  update public.quotations set status = 'draft', submitted_at = null where id = p_id;
end $$;

create or replace function public.set_quotation_status(p_id uuid, p_status public.quotation_status, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare q public.quotations;
begin
  perform public.require_permission('quotation.edit');
  select * into q from public.quotations where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Quotation not found.'); end if;
  if not public.can_view_owned(q.sales_rep_id, 'quotation.view_all') then
    perform public.raise_business_error('forbidden', 'You can only update your own quotations.');
  end if;
  if p_status = 'sent' and q.status not in ('approved', 'sent') then
    perform public.raise_business_error('invalid_state', 'Only approved quotations can be sent to the customer.');
  elsif p_status = 'accepted' and q.status not in ('approved', 'sent') then
    perform public.raise_business_error('invalid_state', 'Only approved or sent quotations can be marked accepted.');
  elsif p_status = 'lost' and q.status not in ('approved', 'sent', 'draft', 'rejected', 'expired') then
    perform public.raise_business_error('invalid_state', 'This quotation cannot be marked lost.');
  elsif p_status not in ('sent', 'accepted', 'lost') then
    perform public.raise_business_error('invalid_state', 'Unsupported status change.');
  end if;
  if p_status = 'lost' and coalesce(trim(p_reason), '') = '' then
    perform public.raise_business_error('validation', 'Please give a reason the quotation was lost.');
  end if;
  update public.quotations set status = p_status,
         sent_at = case when p_status = 'sent' then coalesce(sent_at, now()) else sent_at end,
         accepted_at = case when p_status = 'accepted' then now() else accepted_at end,
         lost_reason = case when p_status = 'lost' then trim(p_reason) else lost_reason end
   where id = p_id;
  if p_status = 'lost' and q.lead_id is not null
     and not exists (select 1 from public.quotations o where o.lead_id = q.lead_id and o.id <> p_id
                     and o.status not in ('lost', 'expired', 'superseded', 'rejected')) then
    update public.leads set stage = 'lost', lost_reason = 'Quotation lost: ' || trim(p_reason), probability = 0
     where id = q.lead_id and stage not in ('won', 'lost');
  end if;
end $$;

-- New revision copies the quotation (with costs) into a fresh draft; the old one is superseded.
create or replace function public.revise_quotation(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  q public.quotations;
  v_new uuid;
  v_rev integer;
  l record;
  v_line uuid;
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

  for l in select ql.*, c.unit_cost, c.cost_source, c.supplier_id
             from public.quotation_lines ql left join public.quotation_line_costs c on c.line_id = ql.id
            where ql.quotation_id = p_id order by ql.line_no loop
    insert into public.quotation_lines(quotation_id, line_no, product_id, description, uom_id, qty, unit_price,
      discount_pct, tax_code_id, tax_rate, fulfilment_mode, lead_time_text)
    values (v_new, l.line_no, l.product_id, l.description, l.uom_id, l.qty, l.unit_price, l.discount_pct,
      l.tax_code_id, l.tax_rate, l.fulfilment_mode, l.lead_time_text)
    returning id into v_line;
    insert into public.quotation_line_costs(line_id, quotation_id, unit_cost, cost_source, supplier_id)
    values (v_line, v_new, coalesce(l.unit_cost, 0), coalesce(l.cost_source, 'none'), l.supplier_id);
  end loop;
  return v_new;
end $$;

-- Nightly job: approved/sent quotations past validity become expired.
create or replace function public.expire_quotations()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update public.quotations set status = 'expired'
   where status in ('approved', 'sent') and valid_until < current_date;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Sales orders
-- ---------------------------------------------------------------------------
-- Approved / sent / accepted quotation → draft sales order (lines + costs copied).
create or replace function public.convert_quotation_to_order(
  p_quotation_id uuid, p_customer_po_ref text default null, p_required_date date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  q public.quotations;
  v_so uuid;
  v_line uuid;
  v_wh uuid;
  l record;
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
  select default_warehouse_id into v_wh from public.company_settings where id;

  insert into public.sales_orders(doc_no, quotation_id, customer_id, contact_id, billing_address_id, shipping_address_id,
    sales_rep_id, customer_po_ref, order_date, required_date, currency_code, exchange_rate, payment_term_id,
    delivery_term_id, delivery_location, terms_conditions, notes, internal_notes)
  values (public.next_document_number('sales_order'), q.id, q.customer_id, q.contact_id, q.billing_address_id,
    q.shipping_address_id, q.sales_rep_id, nullif(trim(p_customer_po_ref), ''), current_date, p_required_date,
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

-- Update a draft order's header and per-line fulfilment plan.
create or replace function public.update_sales_order_draft(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  so public.sales_orders;
  v_line jsonb;
  sol public.sales_order_lines;
  v_mode public.fulfilment_mode;
begin
  perform public.require_permission('sales_order.edit');
  select * into so from public.sales_orders where id = (p->>'id')::uuid for update;
  if not found then perform public.raise_business_error('not_found', 'Sales order not found.'); end if;
  if not public.can_view_owned(so.sales_rep_id, 'sales_order.view_all') then
    perform public.raise_business_error('forbidden', 'You can only edit your own sales orders.');
  end if;
  if so.status <> 'draft' then
    perform public.raise_business_error('locked', 'Only draft orders can be edited.');
  end if;
  update public.sales_orders set customer_po_ref = nullif(trim(p->>'customer_po_ref'), ''),
         required_date = nullif(p->>'required_date', '')::date,
         delivery_location = nullif(p->>'delivery_location', ''),
         internal_notes = nullif(p->>'internal_notes', '')
   where id = so.id;
  for v_line in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    select * into sol from public.sales_order_lines
     where id = (v_line->>'id')::uuid and sales_order_id = so.id for update;
    if not found then perform public.raise_business_error('validation', 'Unknown order line.'); end if;
    v_mode := coalesce(nullif(v_line->>'fulfilment_mode', ''), sol.fulfilment_mode::text)::public.fulfilment_mode;
    if v_mode = 'stock' and (select item_type from public.products where id = sol.product_id) <> 'stock' then
      perform public.raise_business_error('validation',
        format('Line %s is not a stock item; it must be procured.', sol.line_no));
    end if;
    update public.sales_order_lines set fulfilment_mode = v_mode,
           warehouse_id = case when v_mode = 'stock'
                               then coalesce(nullif(v_line->>'warehouse_id', '')::uuid, sol.warehouse_id,
                                             (select default_warehouse_id from public.company_settings where id))
                               end
     where id = sol.id;
  end loop;
end $$;

-- Credit exposure = open (not yet invoiced) confirmed orders in base currency.
create or replace function public.customer_credit_position(p_customer_id uuid,
  out credit_limit numeric, out open_orders_base numeric, out available numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  select c.credit_limit into credit_limit from public.customers c where c.id = p_customer_id;
  select coalesce(sum(total_base), 0) into open_orders_base from public.sales_orders
   where customer_id = p_customer_id and status in ('confirmed', 'partially_fulfilled', 'fulfilled');
  available := case when credit_limit > 0 then credit_limit - open_orders_base end;
end $$;

-- Draft → confirmed (or pending_approval when a credit or order rule is breached).
create or replace function public.confirm_sales_order(p_id uuid)
returns public.sales_order_status language plpgsql security definer set search_path = public as $$
declare
  so public.sales_orders;
  c public.customers;
  v_pos record;
  r public.approval_rules;
  v_reasons text[] := '{}';
  v_approver text;
  v_val numeric;
begin
  perform public.require_permission('sales_order.confirm');
  select * into so from public.sales_orders where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Sales order not found.'); end if;
  if not public.can_view_owned(so.sales_rep_id, 'sales_order.view_all') then
    perform public.raise_business_error('forbidden', 'You can only confirm your own sales orders.');
  end if;
  if so.status <> 'draft' then
    perform public.raise_business_error('invalid_state', 'Only draft orders can be confirmed.');
  end if;
  if not exists (select 1 from public.sales_order_lines where sales_order_id = p_id and not is_cancelled) then
    perform public.raise_business_error('validation', 'The order has no lines.');
  end if;
  select * into c from public.customers where id = so.customer_id;
  if c.status in ('blocked', 'inactive') then
    perform public.raise_business_error('validation', format('Customer is %s; orders cannot be confirmed.', c.status));
  end if;
  if c.status = 'on_hold' then
    v_reasons := v_reasons || 'Customer account is on hold'::text;
    v_approver := 'sales_order.approve';
  end if;

  select * into v_pos from public.customer_credit_position(so.customer_id);
  for r in select * from public.approval_rules where doc_type = 'sales_order' and is_active loop
    if r.metric = 'credit_exceeded' and v_pos.credit_limit > 0
       and v_pos.open_orders_base + so.total_base > v_pos.credit_limit then
      v_reasons := v_reasons || format('Credit limit exceeded (open %s + this order %s > limit %s %s)',
        to_char(v_pos.open_orders_base, 'FM999,999,990.00'), to_char(so.total_base, 'FM999,999,990.00'),
        to_char(v_pos.credit_limit, 'FM999,999,990.00'), public.base_currency());
      v_approver := r.approver_permission;
    elsif r.metric = 'total_base' then
      v_val := so.total_base;
      if (r.comparison = 'gt' and v_val > r.threshold) or (r.comparison = 'lt' and v_val < r.threshold) then
        v_reasons := v_reasons || format('%s (%s %s)', r.name, to_char(v_val, 'FM999,999,990.00'), public.base_currency());
        v_approver := r.approver_permission;
      end if;
    end if;
  end loop;

  if cardinality(v_reasons) > 0 then
    update public.sales_orders set status = 'pending_approval' where id = p_id;
    insert into public.approval_requests(doc_type, doc_id, doc_no, reasons, approver_permission, requested_by)
    values ('sales_order', p_id, so.doc_no, v_reasons, coalesce(v_approver, 'sales_order.approve'), auth.uid());
    perform public.notify_permission_holders(coalesce(v_approver, 'sales_order.approve'),
      'Sales order awaiting approval', so.doc_no || ': ' || array_to_string(v_reasons, '; '), '/sales-orders/' || p_id);
    return 'pending_approval';
  end if;

  perform public.sales_order_apply_confirmation(p_id);
  return 'confirmed';
end $$;

-- Core of confirmation: reserve stock, split shortfalls into procure lines,
-- raise a purchase requisition for procure lines. Internal — called only by
-- confirm_sales_order and decide_approval (not granted to clients).
create or replace function public.sales_order_apply_confirmation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  so public.sales_orders;
  l public.sales_order_lines;
  v_take numeric;
  v_short numeric;
  v_new_line uuid;
  v_pr uuid;
  v_max_line integer;
  v_pr_lines integer := 0;
begin
  select * into so from public.sales_orders where id = p_id for update;
  if so.status not in ('draft', 'pending_approval') then
    perform public.raise_business_error('invalid_state', 'Order is not awaiting confirmation.');
  end if;

  perform set_config('smp.allow_locked_edit', 'on', true);

  -- 1. Stock lines: reserve what is available, in product order to avoid deadlocks.
  for l in select * from public.sales_order_lines
            where sales_order_id = p_id and fulfilment_mode = 'stock' and not is_cancelled
            order by product_id, line_no loop
    v_take := public.stock_reserve(l.id, l.warehouse_id, l.qty - l.qty_reserved, 'Reserved on order confirmation');

    -- 2. Shortfall: split into a new procure line so the customer's quantity is still covered.
    v_short := l.qty - l.qty_reserved - v_take;
    if v_short > 0 then
      if v_take > 0 then
        update public.sales_order_lines set qty = qty - v_short where id = l.id;
        select max(line_no) + 1 into v_max_line from public.sales_order_lines where sales_order_id = p_id;
        insert into public.sales_order_lines(sales_order_id, line_no, quotation_line_id, product_id, description, uom_id,
          qty, unit_price, discount_pct, tax_code_id, tax_rate, fulfilment_mode, split_from_line_id)
        values (p_id, v_max_line, l.quotation_line_id, l.product_id, l.description, l.uom_id, v_short, l.unit_price,
          l.discount_pct, l.tax_code_id, l.tax_rate, 'procure', l.id)
        returning id into v_new_line;
        insert into public.sales_order_line_costs(line_id, sales_order_id, unit_cost, cost_source, supplier_id)
        select v_new_line, p_id, (d).unit_cost, (d).cost_source, (d).supplier_id
          from (select public.default_unit_cost(l.product_id, 'procure', so.exchange_rate) d) x;
      else
        update public.sales_order_lines set fulfilment_mode = 'procure', warehouse_id = null where id = l.id;
      end if;
    end if;
  end loop;

  -- 3. Procure lines → one purchase requisition for the order.
  if exists (select 1 from public.sales_order_lines
              where sales_order_id = p_id and fulfilment_mode = 'procure' and not is_cancelled
                and qty_requisitioned < qty) then
    insert into public.purchase_requisitions(doc_no, source, sales_order_id, required_date, notes)
    values (public.next_document_number('purchase_requisition'), 'sales_order', p_id, so.required_date,
            'Back-to-back for ' || so.doc_no)
    returning id into v_pr;
    for l in select * from public.sales_order_lines
              where sales_order_id = p_id and fulfilment_mode = 'procure' and not is_cancelled
                and qty_requisitioned < qty order by line_no loop
      insert into public.purchase_requisition_lines(requisition_id, product_id, description, qty, uom_id,
        sales_order_line_id, suggested_supplier_id)
      values (v_pr, l.product_id, l.description, l.qty - l.qty_requisitioned, l.uom_id, l.id,
        (select supplier_id from public.sales_order_line_costs where line_id = l.id));
      update public.sales_order_lines set qty_requisitioned = qty where id = l.id;
      v_pr_lines := v_pr_lines + 1;
    end loop;
    perform public.notify_permission_holders('purchase_requisition.manage', 'New purchase requisition',
      format('%s needs %s item(s) procured', so.doc_no, v_pr_lines), '/sales-orders/' || p_id);
  end if;

  update public.sales_orders set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid() where id = p_id;
  perform set_config('smp.allow_locked_edit', 'off', true);
  perform public.notify_permission_holders('inventory.view', 'Sales order confirmed',
    so.doc_no || ' is confirmed and has stock reserved', '/sales-orders/' || p_id);
end $$;

-- Cancel an order that has not started delivery: release reservations and requisitions.
create or replace function public.cancel_sales_order(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  so public.sales_orders;
  r public.stock_reservations;
begin
  perform public.require_permission('sales_order.cancel');
  select * into so from public.sales_orders where id = p_id for update;
  if not found then perform public.raise_business_error('not_found', 'Sales order not found.'); end if;
  if not public.can_view_owned(so.sales_rep_id, 'sales_order.view_all') then
    perform public.raise_business_error('forbidden', 'You can only cancel your own sales orders.');
  end if;
  if coalesce(trim(p_reason), '') = '' then
    perform public.raise_business_error('validation', 'Please give a reason for cancelling.');
  end if;
  if so.status in ('cancelled', 'invoiced', 'closed', 'fulfilled') then
    perform public.raise_business_error('invalid_state', 'This order can no longer be cancelled.');
  end if;
  if exists (select 1 from public.sales_order_lines where sales_order_id = p_id
             and (qty_delivered > 0 or qty_invoiced > 0 or qty_ordered > 0)) then
    perform public.raise_business_error('invalid_state',
      'Items have already been ordered from suppliers, delivered or invoiced. Cancel those documents first.');
  end if;

  perform set_config('smp.allow_locked_edit', 'on', true);
  for r in select sr.* from public.stock_reservations sr
            join public.sales_order_lines l on l.id = sr.sales_order_line_id
           where l.sales_order_id = p_id and sr.status = 'active'
           order by sr.product_id loop
    perform public.stock_release(r.id, r.qty, 'Order cancelled: ' || trim(p_reason));
  end loop;
  update public.purchase_requisition_lines set is_cancelled = true
   where sales_order_line_id in (select id from public.sales_order_lines where sales_order_id = p_id);
  update public.purchase_requisitions set status = 'cancelled' where sales_order_id = p_id and status = 'open';
  update public.approval_requests set status = 'cancelled', decided_at = now(), decided_by = auth.uid()
   where doc_type = 'sales_order' and doc_id = p_id and status = 'pending';
  update public.sales_orders set status = 'cancelled', cancel_reason = trim(p_reason) where id = p_id;
  perform set_config('smp.allow_locked_edit', 'off', true);
end $$;

create or replace function public.set_sales_order_hold(p_id uuid, p_hold boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare so public.sales_orders;
begin
  perform public.require_permission('sales_order.approve');
  select * into so from public.sales_orders where id = p_id for update;
  if p_hold then
    if so.status not in ('confirmed', 'partially_fulfilled') then
      perform public.raise_business_error('invalid_state', 'Only confirmed orders can be put on hold.');
    end if;
    if coalesce(trim(p_reason), '') = '' then
      perform public.raise_business_error('validation', 'Please give a reason for the hold.');
    end if;
    update public.sales_orders set status = 'on_hold', hold_reason = trim(p_reason) where id = p_id;
  else
    if so.status <> 'on_hold' then
      perform public.raise_business_error('invalid_state', 'Order is not on hold.');
    end if;
    update public.sales_orders set status = case when exists (select 1 from public.sales_order_lines
             where sales_order_id = p_id and qty_delivered > 0) then 'partially_fulfilled' else 'confirmed' end::public.sales_order_status,
           hold_reason = null where id = p_id;
  end if;
end $$;

create or replace function public.sales_order_margin(p_id uuid)
returns table (total_cost numeric, gross_profit numeric, gross_margin_pct numeric, gross_profit_base numeric)
language sql stable security definer set search_path = public as $$
  select round(sum(l.qty * c.unit_cost), 2),
         round(so.net_total - sum(l.qty * c.unit_cost), 2),
         case when so.net_total > 0 then round((so.net_total - sum(l.qty * c.unit_cost)) / so.net_total * 100, 2) end,
         round((so.net_total - sum(l.qty * c.unit_cost)) * so.exchange_rate, 2)
  from public.sales_orders so
  join public.sales_order_lines l on l.sales_order_id = so.id and not l.is_cancelled
  join public.sales_order_line_costs c on c.line_id = l.id
  where so.id = p_id and public.has_permission('sales_order.view_cost')
  group by so.id, so.net_total, so.exchange_rate;
$$;

-- Internal functions must not be callable through the API.
revoke execute on function public.sales_order_apply_confirmation(uuid) from public, anon, authenticated;
revoke execute on function public.quotations_recalc_totals(uuid) from public, anon, authenticated;
revoke execute on function public.sales_orders_recalc_totals(uuid) from public, anon, authenticated;
revoke execute on function public.notify_permission_holders(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.notify_user(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.expire_quotations() from public, anon, authenticated;
revoke execute on function public.attach_standard_triggers(regclass, boolean) from public, anon, authenticated;
revoke execute on function public.next_document_number(text, date) from public, anon, authenticated;
