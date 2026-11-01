-- =============================================================================
-- 0014 User management & authentication
--   * Profile fields for administration (employee code, manager, status trail)
--   * Extra permissions per user — grant or deny, optionally until a date
--   * Session revocation enforced in the DATABASE (old tokens stop working)
--   * Sign-in event log (successes, failures, resets, revocations)
--   * Admin functions with escalation and lock-out protection
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column employee_code        text unique,
  add column manager_id           uuid references public.profiles(id),
  add column last_sign_in_at      timestamptz,
  add column deactivated_at       timestamptz,
  add column deactivated_by       uuid references public.profiles(id),
  add column deactivation_reason  text,
  add column sessions_revoked_at  timestamptz,
  add column created_by           uuid references public.profiles(id),
  add constraint profiles_not_own_manager check (manager_id is distinct from id),
  add constraint profiles_deactivation check (is_active or deactivated_at is not null);
create index profiles_department_idx on public.profiles(department_id);
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.audit_trigger();
alter table public.roles add column if not exists is_active boolean not null default true;
select public.attach_standard_triggers('public.roles', false);

-- ---------------------------------------------------------------------------
-- Extra permissions per user
-- ---------------------------------------------------------------------------
create type public.permission_effect as enum ('grant', 'deny');

create table public.user_permissions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  effect        public.permission_effect not null default 'grant',
  reason        text not null check (length(trim(reason)) >= 3),
  expires_at    timestamptz,
  granted_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  unique (user_id, permission_id)
);
create index on public.user_permissions(user_id);
select public.attach_standard_triggers('public.user_permissions', false);

-- ---------------------------------------------------------------------------
-- Sign-in and security events
-- ---------------------------------------------------------------------------
create table public.auth_events (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  email       citext,
  event_type  text not null check (event_type in ('sign_in', 'sign_in_failed', 'sign_out', 'password_reset_requested',
                'password_changed', 'sessions_revoked', 'user_invited', 'user_deactivated', 'user_reactivated',
                'account_locked', 'role_changed', 'permission_changed')),
  ip          inet,
  user_agent  text,
  details     jsonb not null default '{}'::jsonb,
  actor_id    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index auth_events_user_idx on public.auth_events(user_id, created_at desc);
create index auth_events_email_type_idx on public.auth_events(email, event_type, created_at desc);
create trigger auth_events_no_update before update or delete on public.auth_events
  for each row execute function public.audit_log_immutable();

create or replace function public.log_auth_event(p_user uuid, p_email text, p_type text, p_details jsonb default '{}',
  p_ip inet default null, p_user_agent text default null)
returns void language sql security definer set search_path = public as $$
  insert into public.auth_events(user_id, email, event_type, details, ip, user_agent, actor_id)
  values (p_user, coalesce(p_email, (select email from public.profiles where id = p_user)), p_type,
          coalesce(p_details, '{}'), p_ip, left(p_user_agent, 300), auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Effective permissions
--   1. inactive user, or a token issued before "sign out everywhere" → nothing
--   2. super_admin → everything
--   3. an unexpired per-user DENY → no
--   4. a role permission or an unexpired per-user GRANT → yes
-- ---------------------------------------------------------------------------
create or replace function public.session_is_valid()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
      and (p.sessions_revoked_at is null
           or coalesce((auth.jwt()->>'iat')::numeric, 0) >= floor(extract(epoch from p.sessions_revoked_at)))
  );
$$;

create or replace function public.has_permission(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.session_is_valid() and (
    exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
             where ur.user_id = auth.uid() and r.code = 'super_admin')
    or (
      not exists (select 1 from public.user_permissions up join public.permissions pm on pm.id = up.permission_id
                   where up.user_id = auth.uid() and pm.code = p_code and up.effect = 'deny'
                     and (up.expires_at is null or up.expires_at > now()))
      and (
        exists (select 1 from public.user_roles ur
                  join public.roles r on r.id = ur.role_id and r.is_active
                  join public.role_permissions rp on rp.role_id = r.id
                  join public.permissions pm on pm.id = rp.permission_id
                 where ur.user_id = auth.uid() and pm.code = p_code)
        or exists (select 1 from public.user_permissions up join public.permissions pm on pm.id = up.permission_id
                    where up.user_id = auth.uid() and pm.code = p_code and up.effect = 'grant'
                      and (up.expires_at is null or up.expires_at > now()))
      )
    )
  );
$$;

create or replace function public.my_permissions()
returns setof text language sql stable security definer set search_path = public as $$
  select code from public.permissions where public.has_permission(code) order by code;
$$;

-- Where each of a user's permissions comes from (for the admin screen).
create or replace function public.user_effective_permissions(p_user uuid)
returns table (code text, module text, description text, granted boolean, source text)
language plpgsql stable security definer set search_path = public as $$
declare v_super boolean;
begin
  perform public.require_permission('user.view');
  select exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                  where ur.user_id = p_user and r.code = 'super_admin') into v_super;
  return query
  select pm.code, pm.module, pm.description,
    case
      when v_super then true
      when d.id is not null then false
      else (rp.roles is not null or g.id is not null)
    end,
    case
      when v_super then 'Super Administrator'
      when d.id is not null then 'Denied for this user' || coalesce(' until ' || to_char(d.expires_at, 'DD Mon YYYY'), '')
      when g.id is not null then 'Granted to this user' || coalesce(' until ' || to_char(g.expires_at, 'DD Mon YYYY'), '')
             || coalesce(' (also role: ' || rp.roles || ')', '')
      when rp.roles is not null then 'Role: ' || rp.roles
      else null
    end
  from public.permissions pm
  left join lateral (select string_agg(r.name, ', ' order by r.sort_order) roles
                       from public.user_roles ur join public.roles r on r.id = ur.role_id and r.is_active
                       join public.role_permissions x on x.role_id = r.id
                      where ur.user_id = p_user and x.permission_id = pm.id) rp on true
  left join public.user_permissions g on g.user_id = p_user and g.permission_id = pm.id and g.effect = 'grant'
                                       and (g.expires_at is null or g.expires_at > now())
  left join public.user_permissions d on d.user_id = p_user and d.permission_id = pm.id and d.effect = 'deny'
                                       and (d.expires_at is null or d.expires_at > now())
  order by pm.module, pm.code;
end $$;

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
create or replace function public.is_super_admin(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                  where ur.user_id = p_user and r.code = 'super_admin');
$$;

create or replace function public.assert_super_admins_remain(p_excluding uuid default null)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
                   join public.profiles p on p.id = ur.user_id
                  where r.code = 'super_admin' and p.is_active and p.id is distinct from p_excluding) then
    perform public.raise_business_error('lockout', 'At least one active Super Administrator must remain.');
  end if;
end $$;

-- Only Super Administrators may manage other Super Administrators.
create or replace function public.assert_can_manage_user(p_user uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = p_user) then
    perform public.raise_business_error('not_found', 'User not found.');
  end if;
  if public.is_super_admin(p_user) and not public.is_super_admin(auth.uid()) then
    perform public.raise_business_error('forbidden', 'Only a Super Administrator can change another Super Administrator.');
  end if;
end $$;

-- Users may edit only their own name, phone and photo; everything else goes
-- through the admin functions below (which set smp.user_admin for the change).
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('smp.user_admin', true), '') = 'on' then
    return new;
  end if;
  if (to_jsonb(new) - array['full_name', 'phone', 'avatar_path', 'updated_at', 'updated_by'])
     is distinct from (to_jsonb(old) - array['full_name', 'phone', 'avatar_path', 'updated_at', 'updated_by']) then
    raise exception using errcode = 'P0001', hint = 'forbidden',
      message = 'Only an administrator can change this information.';
  end if;
  if new.id <> auth.uid() then
    raise exception using errcode = 'P0001', hint = 'forbidden', message = 'You can only edit your own profile.';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Admin functions
-- ---------------------------------------------------------------------------
-- Profile & department details (called after the user is invited via Supabase Auth).
create or replace function public.admin_update_user(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid := (p->>'id')::uuid;
begin
  perform public.require_permission('user.manage');
  perform public.assert_can_manage_user(v_id);
  if coalesce(length(trim(p->>'full_name')), 0) < 2 then
    perform public.raise_business_error('validation', 'Enter the employee''s full name.');
  end if;
  if nullif(p->>'manager_id', '')::uuid = v_id then
    perform public.raise_business_error('validation', 'A user cannot be their own manager.');
  end if;
  if nullif(trim(p->>'employee_code'), '') is not null and exists
     (select 1 from public.profiles where employee_code = upper(trim(p->>'employee_code')) and id <> v_id) then
    perform public.raise_business_error('duplicate', 'Another user already has this employee code.');
  end if;
  perform set_config('smp.user_admin', 'on', true);
  update public.profiles set full_name = trim(p->>'full_name'), phone = nullif(trim(p->>'phone'), ''),
         job_title = nullif(trim(p->>'job_title'), ''), employee_code = nullif(upper(trim(p->>'employee_code')), ''),
         department_id = nullif(p->>'department_id', '')::uuid, manager_id = nullif(p->>'manager_id', '')::uuid,
         created_by = coalesce(created_by, auth.uid())
   where id = v_id;
  perform set_config('smp.user_admin', 'off', true);
end $$;

create or replace function public.admin_set_user_roles(p_user uuid, p_role_codes text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_before text[];
  v_after  text[] := coalesce(p_role_codes, '{}');
begin
  perform public.require_permission('user.manage');
  perform public.assert_can_manage_user(p_user);
  if p_user = auth.uid() and not public.is_super_admin(auth.uid()) then
    perform public.raise_business_error('forbidden', 'You cannot change your own roles.');
  end if;
  if exists (select 1 from unnest(v_after) c where not exists (select 1 from public.roles where code = c and is_active)) then
    perform public.raise_business_error('validation', 'Unknown or inactive role.');
  end if;
  if 'super_admin' = any (v_after) and not public.is_super_admin(auth.uid()) then
    perform public.raise_business_error('forbidden', 'Only a Super Administrator can grant the Super Administrator role.');
  end if;
  select coalesce(array_agg(r.code order by r.code), '{}') into v_before
    from public.user_roles ur join public.roles r on r.id = ur.role_id where ur.user_id = p_user;

  delete from public.user_roles ur using public.roles r
   where ur.role_id = r.id and ur.user_id = p_user and r.code <> all (v_after);
  insert into public.user_roles(user_id, role_id, granted_by)
  select p_user, r.id, auth.uid() from public.roles r where r.code = any (v_after)
  on conflict do nothing;
  perform public.assert_super_admins_remain();

  if v_before is distinct from (select array_agg(c order by c) from unnest(v_after) c) then
    perform public.log_auth_event(p_user, null, 'role_changed', jsonb_build_object('from', v_before, 'to', v_after));
  end if;
end $$;

create or replace function public.admin_set_user_active(p_user uuid, p_active boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_was boolean;
begin
  perform public.require_permission('user.manage');
  perform public.assert_can_manage_user(p_user);
  if p_user = auth.uid() then
    perform public.raise_business_error('forbidden', 'You cannot deactivate your own account.');
  end if;
  select is_active into v_was from public.profiles where id = p_user for update;
  if v_was = p_active then return; end if;
  if not p_active and coalesce(trim(p_reason), '') = '' then
    perform public.raise_business_error('validation', 'Please give a reason for deactivating this user.');
  end if;
  perform set_config('smp.user_admin', 'on', true);
  update public.profiles set is_active = p_active,
         deactivated_at = case when p_active then null else now() end,
         deactivated_by = case when p_active then null else auth.uid() end,
         deactivation_reason = case when p_active then null else trim(p_reason) end,
         sessions_revoked_at = case when p_active then sessions_revoked_at else now() end
   where id = p_user;
  perform set_config('smp.user_admin', 'off', true);
  if not p_active then
    perform public.assert_super_admins_remain();
    perform public.delete_auth_sessions(p_user);
  end if;
  perform public.log_auth_event(p_user, null, case when p_active then 'user_reactivated' else 'user_deactivated' end,
    jsonb_build_object('reason', p_reason));
end $$;

-- Grant or deny one permission to one user. You can only grant what you hold yourself.
create or replace function public.admin_set_user_permission(p_user uuid, p_code text, p_effect public.permission_effect,
  p_reason text, p_expires_at timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_perm uuid;
begin
  if not (public.has_permission('user.grant_permissions') or public.has_permission('user.manage')) then
    perform public.raise_business_error('forbidden', 'You do not have permission to change user permissions.');
  end if;
  perform public.assert_can_manage_user(p_user);
  select id into v_perm from public.permissions where code = p_code;
  if v_perm is null then perform public.raise_business_error('validation', 'Unknown permission.'); end if;
  if p_user = auth.uid() and not public.is_super_admin(auth.uid()) then
    perform public.raise_business_error('forbidden', 'You cannot change your own permissions.');
  end if;
  if split_part(p_code, '.', 1) in ('user', 'role', 'session', 'settings', 'audit') and not public.is_super_admin(auth.uid()) then
    perform public.raise_business_error('forbidden', 'Administration permissions can only be changed by a Super Administrator.');
  end if;
  if p_effect = 'grant' and not public.has_permission(p_code) then
    perform public.raise_business_error('forbidden', 'You can only grant permissions you hold yourself.');
  end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then
    perform public.raise_business_error('validation', 'Please give a reason (it is kept in the audit log).');
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    perform public.raise_business_error('validation', 'The expiry must be in the future.');
  end if;
  insert into public.user_permissions(user_id, permission_id, effect, reason, expires_at, granted_by)
  values (p_user, v_perm, p_effect, trim(p_reason), p_expires_at, auth.uid())
  on conflict (user_id, permission_id) do update
    set effect = excluded.effect, reason = excluded.reason, expires_at = excluded.expires_at,
        granted_by = excluded.granted_by, created_at = now();
  perform public.log_auth_event(p_user, null, 'permission_changed',
    jsonb_build_object('permission', p_code, 'effect', p_effect, 'expires_at', p_expires_at, 'reason', p_reason));
end $$;

create or replace function public.admin_remove_user_permission(p_user uuid, p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.has_permission('user.grant_permissions') or public.has_permission('user.manage')) then
    perform public.raise_business_error('forbidden', 'You do not have permission to change user permissions.');
  end if;
  perform public.assert_can_manage_user(p_user);
  if p_user = auth.uid() and not public.is_super_admin(auth.uid()) then
    perform public.raise_business_error('forbidden', 'You cannot change your own permissions.');
  end if;
  delete from public.user_permissions up using public.permissions pm
   where up.permission_id = pm.id and up.user_id = p_user and pm.code = p_code;
  perform public.log_auth_event(p_user, null, 'permission_changed', jsonb_build_object('permission', p_code, 'effect', 'removed'));
end $$;

-- Role permission matrix.
create or replace function public.admin_set_role_permissions(p_role_code text, p_codes text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_role uuid;
begin
  perform public.require_permission('role.manage');
  if p_role_code = 'super_admin' then
    perform public.raise_business_error('forbidden', 'The Super Administrator role always has every permission.');
  end if;
  select id into v_role from public.roles where code = p_role_code;
  if v_role is null then perform public.raise_business_error('not_found', 'Role not found.'); end if;
  if not public.is_super_admin(auth.uid()) and exists
     (select 1 from unnest(p_codes) c where split_part(c, '.', 1) in ('user', 'role', 'session', 'settings', 'audit')) then
    perform public.raise_business_error('forbidden', 'Administration permissions can only be assigned by a Super Administrator.');
  end if;
  delete from public.role_permissions rp using public.permissions pm
   where rp.permission_id = pm.id and rp.role_id = v_role and pm.code <> all (coalesce(p_codes, '{}'));
  insert into public.role_permissions(role_id, permission_id)
  select v_role, pm.id from public.permissions pm where pm.code = any (coalesce(p_codes, '{}'))
  on conflict do nothing;
end $$;

create or replace function public.admin_save_role(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  perform public.require_permission('role.manage');
  if coalesce(length(trim(p->>'name')), 0) < 3 then perform public.raise_business_error('validation', 'Enter a role name.'); end if;
  if v_id is null then
    if coalesce(p->>'code', '') !~ '^[a-z][a-z0-9_]{2,40}$' then
      perform public.raise_business_error('validation', 'Role code: lower-case letters, numbers and underscores.');
    end if;
    insert into public.roles(code, name, description, department_id, is_system)
    values (p->>'code', trim(p->>'name'), nullif(trim(p->>'description'), ''), nullif(p->>'department_id', '')::uuid, false)
    returning id into v_id;
  else
    if (select code from public.roles where id = v_id) = 'super_admin' and not coalesce((p->>'is_active')::boolean, true) then
      perform public.raise_business_error('forbidden', 'The Super Administrator role cannot be deactivated.');
    end if;
    update public.roles set name = trim(p->>'name'), description = nullif(trim(p->>'description'), ''),
           department_id = nullif(p->>'department_id', '')::uuid, is_active = coalesce((p->>'is_active')::boolean, true)
     where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------
-- Removes refresh sessions in Supabase Auth (best effort — the iat check in
-- session_is_valid() already invalidates every existing access token).
create or replace function public.delete_auth_sessions(p_user uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  begin
    delete from auth.sessions where user_id = p_user;
  exception when insufficient_privilege or undefined_table then
    null;
  end;
end $$;

create or replace function public.list_user_sessions(p_user uuid)
returns table (id uuid, created_at timestamptz, updated_at timestamptz, user_agent text, ip text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if p_user <> auth.uid() then perform public.require_permission('session.manage'); end if;
  return query select s.id, s.created_at, s.updated_at, s.user_agent, host(s.ip)
                 from auth.sessions s where s.user_id = p_user order by s.updated_at desc nulls last;
end $$;

-- Sign a user out of every device. Admins can do this for others; anyone for themselves.
create or replace function public.revoke_user_sessions(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user <> auth.uid() then
    perform public.require_permission('session.manage');
    perform public.assert_can_manage_user(p_user);
  end if;
  perform set_config('smp.user_admin', 'on', true);
  update public.profiles set sessions_revoked_at = now() where id = p_user;
  perform set_config('smp.user_admin', 'off', true);
  perform public.delete_auth_sessions(p_user);
  perform public.log_auth_event(p_user, null, 'sessions_revoked', '{}');
end $$;

-- Called by the app after a successful sign-in.
create or replace function public.record_sign_in(p_ip inet default null, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  perform set_config('smp.user_admin', 'on', true);
  update public.profiles set last_sign_in_at = now() where id = auth.uid();
  perform set_config('smp.user_admin', 'off', true);
  perform public.log_auth_event(auth.uid(), null, 'sign_in', '{}', p_ip, p_user_agent);
end $$;

create or replace function public.record_own_auth_event(p_type text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_type not in ('sign_out', 'password_changed') then
    perform public.raise_business_error('validation', 'Invalid event.');
  end if;
  perform public.log_auth_event(auth.uid(), null, p_type, '{}');
end $$;

-- Server-only (service role): failed sign-ins and the lock-out check.
create or replace function public.recent_failed_sign_ins(p_email text, p_minutes integer default 15)
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.auth_events
   where email = p_email::citext and event_type = 'sign_in_failed' and created_at > now() - make_interval(mins => p_minutes)
     and created_at > coalesce((select max(created_at) from public.auth_events
                                where email = p_email::citext and event_type = 'sign_in'), '-infinity');
$$;

-- ---------------------------------------------------------------------------
-- Admin view of users
-- ---------------------------------------------------------------------------
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
where public.has_permission('user.view');
revoke all on public.v_users from anon;
grant select on public.v_users to authenticated;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------
alter table public.user_permissions enable row level security;
alter table public.auth_events enable row level security;
revoke insert, update, delete, truncate on public.user_permissions, public.auth_events from anon, authenticated;
create policy user_permissions_read on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or public.has_permission('user.view'));
create policy auth_events_read on public.auth_events for select to authenticated
  using (user_id = auth.uid() or public.has_permission('audit.view'));
-- Role assignment goes through admin_set_user_roles only.
drop policy if exists user_roles_write on public.user_roles;
drop policy if exists user_roles_delete on public.user_roles;
drop policy if exists role_permissions_write on public.role_permissions;
revoke insert, update, delete on public.user_roles, public.role_permissions, public.roles from anon, authenticated;

revoke execute on function public.log_auth_event(uuid, text, text, jsonb, inet, text) from public, anon, authenticated;
revoke execute on function public.delete_auth_sessions(uuid) from public, anon, authenticated;
revoke execute on function public.recent_failed_sign_ins(text, integer) from public, anon, authenticated;
revoke execute on function public.assert_super_admins_remain(uuid) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.log_auth_event(uuid, text, text, jsonb, inet, text) to service_role;
    grant execute on function public.recent_failed_sign_ins(text, integer) to service_role;
  end if;
end $$;
