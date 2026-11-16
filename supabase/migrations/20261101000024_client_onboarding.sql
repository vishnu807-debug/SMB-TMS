-- =============================================================================
-- 0024 Onboarding a new client installation
--   One backend call (Supabase SQL editor) prepares a freshly created database
--   for a new client: company names, standard terms, the client's first Super
--   Administrator, the vendor's support account and the licensed modules.
--
--   select public.onboard_client('{
--     "legal_name":  "Oilmark International LLC",
--     "trade_name":  "Oilmark",
--     "admin_email": "it@oilmarkintl.com",
--     "vendor_email":"support@your-company.com",
--     "product_name":"Nexora",
--     "modules":     ["sales", "procurement", "finance"]
--   }');
--
--   The admin and vendor accounts must first be created in Supabase →
--   Authentication → Users. It can be run again to correct anything.
-- =============================================================================
create or replace function public.onboard_client(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_legal text := nullif(trim(p->>'legal_name'), '');
  v_trade text := coalesce(nullif(trim(p->>'trade_name'), ''), nullif(trim(p->>'legal_name'), ''));
  v_old_trade text;
  v_admin uuid;
  v_vendor uuid;
  v_role uuid;
  v_mod text;
  v_out text[] := '{}';
begin
  if auth.uid() is not null then
    raise exception using errcode = 'P0001', hint = 'forbidden', message = 'Client onboarding is done in the backend only.';
  end if;
  if v_legal is null or length(v_legal) < 3 then raise exception 'Enter legal_name (the company''s registered name).'; end if;

  -- Company names and standard terms (placeholder "SMP" replaced by the client's name).
  select coalesce(nullif(trim(trade_name), ''), 'SMP') into v_old_trade from public.company_settings where id;
  update public.company_settings set
    legal_name = v_legal, trade_name = v_trade,
    trn = coalesce(nullif(trim(p->>'trn'), ''), trn),
    quotation_terms = replace(replace(quotation_terms, 'SMP General Trading LLC', v_legal), 'SMP', v_trade),
    purchase_order_terms = replace(replace(purchase_order_terms, 'SMP General Trading LLC', v_legal), 'SMP', v_trade),
    invoice_terms = replace(replace(invoice_terms, 'SMP General Trading LLC', v_legal), 'SMP', v_trade)
  where id;
  update public.login_branding set company_name = left(v_trade, 80),
    product_name = coalesce(nullif(left(trim(p->>'product_name'), 60), ''), product_name),
    updated_at = now()
  where id;
  v_out := v_out || format('Company set to %s (%s).', v_legal, v_trade);

  -- First Super Administrator of the client.
  if nullif(trim(p->>'admin_email'), '') is not null then
    select id into v_admin from public.profiles where lower(email) = lower(trim(p->>'admin_email'));
    if v_admin is null then
      raise exception 'No user %. Create it first in Supabase → Authentication → Users (tick Auto Confirm User).', p->>'admin_email';
    end if;
    select id into v_role from public.roles where code = 'super_admin';
    insert into public.user_roles(user_id, role_id) values (v_admin, v_role) on conflict do nothing;
    perform set_config('smp.user_admin', 'on', true);
    update public.profiles set is_active = true, deactivated_at = null, deactivated_by = null, deactivation_reason = null where id = v_admin;
    perform set_config('smp.user_admin', 'off', true);
    v_out := v_out || format('%s is Super Administrator.', p->>'admin_email');
  end if;

  -- The vendor's support account.
  if nullif(trim(p->>'vendor_email'), '') is not null then
    select id into v_vendor from public.profiles where lower(email) = lower(trim(p->>'vendor_email'));
    if v_vendor is null then
      raise exception 'No user %. Create it first in Supabase → Authentication → Users (tick Auto Confirm User).', p->>'vendor_email';
    end if;
    perform public.grant_platform_admin(p->>'vendor_email', 'Vendor support');
    v_out := v_out || format('%s has vendor console access.', p->>'vendor_email');
  end if;

  -- Licensed modules: exactly the ones listed (plus core); requirements are checked.
  if jsonb_typeof(p->'modules') = 'array' then
    perform public.apply_module_set(array(select jsonb_array_elements_text(p->'modules')), 'Client onboarding', null, 'backend: onboarding');
    v_out := v_out || format('Modules on: %s.', (select string_agg(name, ', ' order by sort_order) from public.system_modules where is_enabled));
  end if;
  return array_to_string(v_out, ' ');
end $$;
revoke execute on function public.onboard_client(jsonb) from public, anon, authenticated;
grant execute on function public.onboard_client(jsonb) to service_role;
