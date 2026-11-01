-- =============================================================================
-- SMP Trading Management System — 0001 Foundation
-- Identity & access, reference data, document numbering, audit logging.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

create or replace function public.set_created_by()
returns trigger language plpgsql as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;

-- Raise a business error the app can show to users. SQLSTATE P0001 + a
-- readable message; HINT carries a machine code for the UI.
create or replace function public.raise_business_error(p_code text, p_message text)
returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code;
end $$;

-- ---------------------------------------------------------------------------
-- Identity & access
-- ---------------------------------------------------------------------------
create table public.departments (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null default '',
  email         citext not null unique,
  phone         text,
  job_title     text,
  department_id uuid references public.departments(id),
  avatar_path   text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,          -- e.g. quotation.approve
  module      text not null,
  description text not null
);

create table public.role_permissions (
  role_id       uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_roles (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles(id),
  primary key (user_id, role_id)
);
create index on public.user_roles(role_id);

-- Permission check used by RLS policies and every business function.
-- super_admin implicitly holds every permission. Inactive users hold none.
create or replace function public.has_permission(p_code text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles p on p.id = ur.user_id and p.is_active
    join public.roles r on r.id = ur.role_id
    left join public.role_permissions rp on rp.role_id = r.id
    left join public.permissions pm on pm.id = rp.permission_id
    where ur.user_id = auth.uid()
      and (r.code = 'super_admin' or pm.code = p_code)
  );
$$;

create or replace function public.require_permission(p_code text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then
    perform public.raise_business_error('not_authenticated', 'You must be signed in.');
  end if;
  if not public.has_permission(p_code) then
    perform public.raise_business_error('forbidden',
      format('You do not have permission to perform this action (%s).', p_code));
  end if;
end $$;

-- Returns the caller's permission codes (for the UI to show/hide actions).
create or replace function public.my_permissions()
returns setof text
language sql stable security definer set search_path = public as $$
  select distinct pm.code
  from public.user_roles ur
  join public.profiles p on p.id = ur.user_id and p.is_active
  join public.roles r on r.id = ur.role_id
  join public.permissions pm
    on r.code = 'super_admin'
    or pm.id in (select permission_id from public.role_permissions where role_id = r.id)
  where ur.user_id = auth.uid();
$$;

-- Create a profile automatically when a Supabase Auth user is created.
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table public.currencies (
  code       char(3) primary key,
  name       text not null,
  symbol     text not null,
  decimals   smallint not null default 2 check (decimals between 0 and 4),
  is_active  boolean not null default true
);

create table public.exchange_rates (
  id            uuid primary key default gen_random_uuid(),
  currency_code char(3) not null references public.currencies(code),
  rate_date     date not null,
  rate_to_base  numeric(18,6) not null check (rate_to_base > 0),
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  unique (currency_code, rate_date)
);

create table public.tax_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,      -- SR, ZR, EX, OS
  name        text not null,
  rate        numeric(5,2) not null check (rate >= 0 and rate <= 100),
  is_default  boolean not null default false,
  is_active   boolean not null default true
);
create unique index tax_codes_one_default on public.tax_codes(is_default) where is_default;

create table public.payment_terms (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  days       integer not null default 0 check (days >= 0),
  description text,
  is_active  boolean not null default true
);

create table public.delivery_terms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,      -- EXW, FOB, CIF, DAP, DDP, LOCAL
  name        text not null,
  description text,
  is_active   boolean not null default true
);

create table public.units_of_measure (
  id        uuid primary key default gen_random_uuid(),
  code      text not null unique,
  name      text not null,
  is_active boolean not null default true
);

create table public.warehouses (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  address    text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- Single-row company profile.
create table public.company_settings (
  id                     boolean primary key default true check (id),
  legal_name             text not null default 'SMP General Trading LLC',
  trade_name             text,
  trn                    text,
  address                text,
  city                   text,
  country                text not null default 'United Arab Emirates',
  phone                  text,
  email                  text,
  website                text,
  logo_path              text,
  base_currency          char(3) not null default 'AED' references public.currencies(code),
  default_warehouse_id   uuid references public.warehouses(id),
  quotation_validity_days integer not null default 30 check (quotation_validity_days between 1 and 365),
  quotation_terms        text not null default '',
  bank_details           text,
  updated_at             timestamptz not null default now(),
  updated_by             uuid
);
create trigger company_settings_updated_at before update on public.company_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Document numbering — gap-free per (doc_type, year), row-locked.
-- year = 0 for non-yearly series (customer codes, SKUs).
-- ---------------------------------------------------------------------------
create table public.document_sequences (
  doc_type    text not null,
  year        integer not null,
  prefix      text not null,
  padding     smallint not null default 5,
  next_value  bigint not null default 1 check (next_value > 0),
  primary key (doc_type, year)
);

create table public.document_sequence_templates (
  doc_type text primary key,
  prefix   text not null,
  yearly   boolean not null default true,
  padding  smallint not null default 5
);

create or replace function public.next_document_number(p_doc_type text, p_date date default current_date)
returns text
language plpgsql security definer set search_path = public as $$
declare
  t      public.document_sequence_templates;
  v_year integer;
  v_val  bigint;
  v_seq  public.document_sequences;
begin
  select * into t from public.document_sequence_templates where doc_type = p_doc_type;
  if not found then
    perform public.raise_business_error('config', format('No numbering series configured for %s.', p_doc_type));
  end if;
  v_year := case when t.yearly then extract(year from p_date)::int else 0 end;

  insert into public.document_sequences (doc_type, year, prefix, padding)
  values (p_doc_type, v_year, t.prefix, t.padding)
  on conflict (doc_type, year) do nothing;

  update public.document_sequences
     set next_value = next_value + 1
   where doc_type = p_doc_type and year = v_year
  returning * into v_seq;
  v_val := v_seq.next_value - 1;

  return case when t.yearly
    then format('%s-%s-%s', v_seq.prefix, v_year, lpad(v_val::text, v_seq.padding, '0'))
    else format('%s-%s', v_seq.prefix, lpad(v_val::text, v_seq.padding, '0'))
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Audit log — append-only, written by trigger on every business table.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  table_name  text not null,
  record_id   uuid,
  action      text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  changed_fields text[],
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index audit_log_record_idx on public.audit_log(table_name, record_id, changed_at desc);
create index audit_log_user_idx on public.audit_log(changed_by, changed_at desc);

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
begin
  if tg_op in ('UPDATE','DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    select array_agg(key order by key) into v_changed
    from jsonb_each(v_new) n
    where n.key not in ('updated_at','updated_by')
      and n.value is distinct from v_old -> n.key;
    if v_changed is null then
      return new;  -- nothing meaningful changed
    end if;
  end if;
  insert into public.audit_log(table_name, record_id, action, old_data, new_data, changed_fields, changed_by)
  values (tg_table_name,
          case when coalesce(v_new->>'id', v_old->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               then coalesce(v_new->>'id', v_old->>'id')::uuid end,
          tg_op, v_old, v_new, v_changed, auth.uid());
  return coalesce(new, old);
end $$;

-- Audit log is immutable for everyone, admins included.
create or replace function public.audit_log_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- Helper: attach the standard triggers to a business table.
create or replace function public.attach_standard_triggers(p_table regclass, p_has_updated boolean default true)
returns void language plpgsql as $$
begin
  execute format('create trigger %I after insert or update or delete on %s for each row execute function public.audit_trigger()',
                 replace(p_table::text, 'public.', '') || '_audit', p_table);
  if p_has_updated then
    execute format('create trigger %I before update on %s for each row execute function public.set_updated_at()',
                   replace(p_table::text, 'public.', '') || '_updated_at', p_table);
    execute format('create trigger %I before insert on %s for each row execute function public.set_created_by()',
                   replace(p_table::text, 'public.', '') || '_created_by', p_table);
  end if;
end $$;

select public.attach_standard_triggers('public.company_settings', false);
select public.attach_standard_triggers('public.tax_codes', false);
select public.attach_standard_triggers('public.payment_terms', false);
select public.attach_standard_triggers('public.user_roles', false);
select public.attach_standard_triggers('public.role_permissions', false);

-- ---------------------------------------------------------------------------
-- Notifications (bell icon). Inserted by business functions.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  title      text not null,
  body       text,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, read_at, created_at desc);

create or replace function public.notify_permission_holders(p_permission text, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications(user_id, title, body, link)
  select distinct p.id, p_title, p_body, p_link
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id
  join public.roles r on r.id = ur.role_id
  left join public.role_permissions rp on rp.role_id = r.id
  left join public.permissions pm on pm.id = rp.permission_id
  where p.is_active
    and (r.code = 'super_admin' or pm.code = p_permission)
    and p.id is distinct from auth.uid();
end $$;

create or replace function public.notify_user(p_user uuid, p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is not null and p_user is distinct from auth.uid() then
    insert into public.notifications(user_id, title, body, link) values (p_user, p_title, p_body, p_link);
  end if;
end $$;
