-- =============================================================================
-- RESET — removes everything the SMP migrations created, so `supabase db push`
-- can install the system from scratch.
--
-- !! DELETES ALL SMP DATA in this project (customers, orders, invoices, users'
-- !! roles…). Use only on a new project or a test project. Never on a live system.
--
-- Run in Supabase → SQL Editor → New query → paste → Run.
-- Login accounts (Authentication → Users) and uploaded files are kept.
-- =============================================================================

-- Storage access rules created by the migrations (if those files ran before)
do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists product_media_read   on storage.objects;
    drop policy if exists product_media_insert on storage.objects;
    drop policy if exists product_media_update on storage.objects;
    drop policy if exists product_media_delete on storage.objects;
    drop policy if exists delivery_pod_read    on storage.objects;
    drop policy if exists delivery_pod_insert  on storage.objects;
    drop policy if exists finance_docs_read    on storage.objects;
    drop policy if exists finance_docs_insert  on storage.objects;
  end if;
end $$;

-- Trigger that creates a profile for every new login
drop trigger if exists on_auth_user_created on auth.users;

-- All tables, views and functions of the application
drop schema if exists public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

-- Forget which migration files were applied, so db push applies all of them again
do $$
begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    delete from supabase_migrations.schema_migrations;
  end if;
end $$;

select 'Database cleared — now run: npx supabase db push' as next_step;
