-- =============================================================================
-- 0019 Vendor console
--   A "system provider" (platform administrator) account belongs to the software
--   vendor, not to the client. It can open the Vendor Console inside the app and
--   switch the client's licensed modules on or off.
--
--   * Vendor accounts are granted in the backend only (SQL editor / service role):
--       select public.grant_platform_admin('support@your-company.com', 'Vendor support');
--     Nobody inside the app — not even the client's Super Administrator — can grant,
--     edit, deactivate or see them in User management.
--   * A vendor account does not get access to the client's business data unless the
--     client gives it a role.
--   * Every module change is recorded with who made it and the licence reference.
-- =============================================================================

create table public.platform_admins (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  note       text,
  granted_at timestamptz not null default now(),
  granted_by text not null default current_user
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

create table public.module_change_log (
  id          bigint generated always as identity primary key,
  changed_at  timestamptz not null default now(),
  module_code text not null references public.system_modules(code),
  enabled     boolean not null,
  changed_by  uuid references public.profiles(id) on delete set null,
  changed_by_label text not null,   -- vendor's email, or "backend: <role/note>"
  reference   text                  -- licence / order reference or reason
);
create index module_change_log_at on public.module_change_log(changed_at desc);
alter table public.module_change_log enable row level security;
revoke all on public.module_change_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who is a vendor (platform administrator)?
-- ---------------------------------------------------------------------------
create or replace function public.is_platform_admin(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (
    select 1 from public.platform_admins pa join public.profiles p on p.id = pa.user_id
     where pa.user_id = p_user and p.is_active);
$$;
revoke execute on function public.is_platform_admin(uuid) from public, anon, authenticated;

-- For the signed-in user (with a valid, un-revoked session).
create or replace function public.i_am_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.session_is_valid() and public.is_platform_admin(auth.uid());
$$;
revoke execute on function public.i_am_platform_admin() from public, anon;
grant execute on function public.i_am_platform_admin() to authenticated;

create policy module_change_log_read on public.module_change_log for select to authenticated
  using (public.i_am_platform_admin());
grant select on public.module_change_log to authenticated;

-- ---------------------------------------------------------------------------
-- Granting / removing vendor access — backend only.
-- The person must already exist as a user (Supabase → Authentication → Add user).
-- ---------------------------------------------------------------------------
create or replace function public.grant_platform_admin(p_email text, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if auth.uid() is not null then
    raise exception using errcode = 'P0001', hint = 'forbidden', message = 'Vendor access is granted in the backend only.';
  end if;
  select id into v from public.profiles where lower(email) = lower(trim(p_email));
  if v is null then
    raise exception 'No user with email %. Create the user first in Supabase → Authentication → Users.', p_email;
  end if;
  insert into public.platform_admins(user_id, note) values (v, nullif(trim(p_note), ''))
  on conflict (user_id) do update set note = excluded.note;
  -- The account must be able to sign in.
  perform set_config('smp.user_admin', 'on', true);
  update public.profiles set is_active = true, deactivated_at = null, deactivated_by = null, deactivation_reason = null where id = v;
  perform set_config('smp.user_admin', 'off', true);
  return format('%s now has vendor console access.', p_email);
end $$;

create or replace function public.revoke_platform_admin(p_email text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    raise exception using errcode = 'P0001', hint = 'forbidden', message = 'Vendor access is managed in the backend only.';
  end if;
  delete from public.platform_admins where user_id = (select id from public.profiles where lower(email) = lower(trim(p_email)));
  if not found then return format('%s had no vendor access.', p_email); end if;
  return format('Vendor access removed from %s.', p_email);
end $$;
revoke execute on function public.grant_platform_admin(text, text), public.revoke_platform_admin(text) from public, anon, authenticated;
grant execute on function public.grant_platform_admin(text, text), public.revoke_platform_admin(text) to service_role;

-- ---------------------------------------------------------------------------
-- Changing the licensed modules
-- ---------------------------------------------------------------------------
-- Shared by the backend function and the vendor console: apply the full set of
-- modules the client has bought in one go, checking dependencies within that set.
create or replace function public.apply_module_set(p_codes text[], p_reference text, p_by uuid, p_label text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_target text[] := array(select distinct c from unnest(coalesce(p_codes, '{}') || array['core']) c);
  v_bad text; v_missing text; v_changed integer := 0; m record;
begin
  select string_agg(c, ', ') into v_bad from unnest(v_target) c where c not in (select code from public.system_modules);
  if v_bad is not null then
    perform public.raise_business_error('validation', format('Unknown module: %s.', v_bad));
  end if;
  select string_agg(format('%s needs %s', s.name, r.name), '; ') into v_missing
    from public.system_modules s cross join unnest(s.requires) req join public.system_modules r on r.code = req
   where s.code = any (v_target) and req <> all (v_target);
  if v_missing is not null then
    perform public.raise_business_error('validation', v_missing || '.');
  end if;

  for m in select code from public.system_modules where not is_core and is_enabled is distinct from (code = any (v_target)) for update loop
    update public.system_modules set is_enabled = (code = any (v_target)), changed_at = now(), changed_by = p_label where code = m.code;
    insert into public.module_change_log(module_code, enabled, changed_by, changed_by_label, reference)
    values (m.code, m.code = any (v_target), p_by, p_label, nullif(trim(p_reference), ''));
    v_changed := v_changed + 1;
  end loop;
  return v_changed;
end $$;
revoke execute on function public.apply_module_set(text[], text, uuid, text) from public, anon, authenticated;

-- Vendor console (signed-in platform administrators only).
create or replace function public.vendor_set_modules(p_codes text[], p_reference text)
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not public.i_am_platform_admin() then
    perform public.raise_business_error('forbidden', 'Only the system provider can change the licensed modules.');
  end if;
  if coalesce(length(trim(p_reference)), 0) < 3 then
    perform public.raise_business_error('validation', 'Enter the licence or order reference for this change.');
  end if;
  return public.apply_module_set(p_codes, p_reference, auth.uid(),
    (select email from public.profiles where id = auth.uid()));
end $$;
revoke execute on function public.vendor_set_modules(text[], text) from public, anon;
grant execute on function public.vendor_set_modules(text[], text) to authenticated;

-- The backend switch (from 0018) now also writes the change log.
create or replace function public.set_module_enabled(p_code text, p_enabled boolean, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare m public.system_modules; v_missing text; v_dependants text;
begin
  if auth.uid() is not null then
    raise exception using errcode = 'P0001', hint = 'forbidden',
      message = 'Modules are configured by the system provider in the backend, not from the application.';
  end if;
  select * into m from public.system_modules where code = p_code for update;
  if not found then raise exception 'Unknown module %. Valid: %', p_code, (select string_agg(code, ', ' order by sort_order) from public.system_modules); end if;
  if m.is_core then raise exception 'The core module is always on.'; end if;
  if m.is_enabled = p_enabled then return format('%s is already %s.', m.name, case when p_enabled then 'on' else 'off' end); end if;
  if p_enabled then
    select string_agg(s.name, ', ') into v_missing from public.system_modules s where s.code = any (m.requires) and not s.is_enabled;
    if v_missing is not null then raise exception '% needs % to be switched on first.', m.name, v_missing; end if;
  else
    select string_agg(s.name, ', ') into v_dependants from public.system_modules s where p_code = any (s.requires) and s.is_enabled;
    if v_dependants is not null then raise exception '% is used by % — switch that off first.', m.name, v_dependants; end if;
  end if;
  update public.system_modules set is_enabled = p_enabled, changed_at = now(),
    changed_by = coalesce(nullif(trim(p_note), ''), current_user) where code = p_code;
  insert into public.module_change_log(module_code, enabled, changed_by_label, reference)
  values (p_code, p_enabled, 'backend: ' || current_user, nullif(trim(p_note), ''));
  return format('%s switched %s.', m.name, case when p_enabled then 'ON' else 'OFF' end);
end $$;
revoke execute on function public.set_module_enabled(text, boolean, text) from public, anon, authenticated;
grant execute on function public.set_module_enabled(text, boolean, text) to service_role;

-- Installation overview for the console.
create or replace function public.vendor_installation_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.i_am_platform_admin() then
    perform public.raise_business_error('forbidden', 'Only the system provider can open the vendor console.');
  end if;
  return jsonb_build_object(
    'company', (select coalesce(trade_name, legal_name) from public.company_settings limit 1),
    'active_users', (select count(*) from public.profiles p where p.is_active and not exists (select 1 from public.platform_admins pa where pa.user_id = p.id)),
    'total_users', (select count(*) from public.profiles p where not exists (select 1 from public.platform_admins pa where pa.user_id = p.id)),
    'departments', (select count(*) from public.departments),
    'last_sign_in', (select max(last_sign_in_at) from public.profiles p where not exists (select 1 from public.platform_admins pa where pa.user_id = p.id)));
end $$;
revoke execute on function public.vendor_installation_summary() from public, anon;
grant execute on function public.vendor_installation_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- Keep vendor accounts out of the client's hands
-- ---------------------------------------------------------------------------
create or replace function public.assert_can_manage_user(p_user uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = p_user) then
    perform public.raise_business_error('not_found', 'User not found.');
  end if;
  if exists (select 1 from public.platform_admins where user_id = p_user) and p_user is distinct from auth.uid() then
    perform public.raise_business_error('forbidden', 'This is the system provider''s support account and is managed by the provider.');
  end if;
  if public.is_super_admin(p_user) and not public.is_super_admin(auth.uid()) then
    perform public.raise_business_error('forbidden', 'Only a Super Administrator can change another Super Administrator.');
  end if;
end $$;

-- User management lists the client's own staff only.
create or replace view public.v_users as
select p.id, p.full_name, p.email, p.phone, p.job_title, p.employee_code, p.is_active, p.last_sign_in_at,
       p.deactivated_at, p.deactivation_reason, p.created_at,
       d.id as department_id, d.name as department_name, m.full_name as manager_name, p.manager_id,
       coalesce((select array_agg(r.name order by r.sort_order) from public.user_roles ur join public.roles r on r.id = ur.role_id
                  where ur.user_id = p.id), '{}') as role_names,
       coalesce((select array_agg(r.code order by r.sort_order) from public.user_roles ur join public.roles r on r.id = ur.role_id
                  where ur.user_id = p.id), '{}') as role_codes,
       (select count(*) from public.user_permissions up where up.user_id = p.id
          and (up.expires_at is null or up.expires_at > now())) as extra_permissions
from public.profiles p
left join public.departments d on d.id = p.department_id
left join public.profiles m on m.id = p.manager_id
where public.has_permission('user.view')
  and not exists (select 1 from public.platform_admins pa where pa.user_id = p.id);
