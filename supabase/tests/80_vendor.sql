-- =============================================================================
-- Vendor console — behaviour tests (after 10–70).
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
reset role;

insert into auth.users (email, raw_user_meta_data) values ('vendor@smp.test', '{"full_name":"Provider Support"}');

-- Only the backend can grant vendor access.
select test_as('admin@smp.test');
select expect_error($$select public.grant_platform_admin('admin@smp.test')$$, 'permission denied');
select expect_error($$insert into public.platform_admins(user_id) select id from public.profiles where email = 'admin@smp.test'$$, 'permission denied');
select assert_eq(public.i_am_platform_admin(), false, 'client super admin is not the vendor');
select expect_error($$select public.vendor_set_modules(array['sales'], 'PO-1')$$, 'Only the system provider');
select expect_error($$select public.vendor_installation_summary()$$, 'Only the system provider');
select assert_eq((select count(*) from public.module_change_log)::int, 0, 'client cannot read the change log');

select public.test_backend();
select expect_error($$select public.grant_platform_admin('nobody@smp.test')$$, 'Create the user first');
select public.grant_platform_admin('vendor@smp.test', 'Vendor support');

-- The vendor account is hidden from and protected against the client's admins.
select test_as('admin@smp.test');
select assert_eq((select count(*) from public.v_users where email = 'vendor@smp.test')::int, 0, 'hidden from user management');
select expect_error(format('select public.admin_set_user_active(%L, false, %L)', (select id from public.profiles where email = 'vendor@smp.test'), 'x'), 'managed by the provider');
select expect_error(format('select public.admin_set_user_roles(%L, array[''super_admin''])', (select id from public.profiles where email = 'vendor@smp.test')), 'managed by the provider');

-- The vendor switches the client to Sales + Procurement + Finance.
select test_as('vendor@smp.test');
select assert_eq(public.i_am_platform_admin(), true, 'vendor recognised');
select assert_eq(public.has_permission('invoice.view'), false, 'vendor gets no business data by default');
select assert_eq((public.vendor_installation_summary()->>'total_users')::int > 0, true, 'summary works');
select expect_error($$select public.vendor_set_modules(array['sales'], '')$$, 'licence or order reference');
select expect_error($$select public.vendor_set_modules(array['logistics'], 'PO-1')$$, 'Logistics needs Sales');
select expect_error($$select public.vendor_set_modules(array['einvoicing','sales'], 'PO-1')$$, 'needs Finance');
select expect_error($$select public.vendor_set_modules(array['sales','bogus'], 'PO-1')$$, 'Unknown module');
select assert_eq(public.vendor_set_modules(array['sales','procurement','finance'], 'Licence SO-2026-114')::int, 2, 'inventory and logistics switched off');
select assert_eq((select string_agg(code, ',' order by sort_order) from public.system_modules where is_enabled), 'core,sales,procurement,finance', 'set applied');
select assert_eq((select count(*) from public.module_change_log where reference = 'Licence SO-2026-114' and changed_by_label = 'vendor@smp.test')::int, 2, 'logged with vendor and reference');
select assert_eq(public.vendor_set_modules(array['sales','procurement','finance'], 'same again')::int, 0, 'no-op');
select assert_eq(public.vendor_set_modules(array['sales','inventory','procurement','logistics','finance'], 'Licence SO-2026-120')::int, 2, 'back on');

-- Deactivated or revoked vendors lose access.
select public.test_backend();
select public.revoke_platform_admin('vendor@smp.test');
select test_as('vendor@smp.test');
select assert_eq(public.i_am_platform_admin(), false, 'revoked');
select expect_error($$select public.vendor_set_modules(array['sales'], 'PO-9')$$, 'Only the system provider');
select test_as('admin@smp.test');
select assert_eq((select count(*) from public.v_users where email = 'vendor@smp.test')::int, 1, 'visible again once revoked');

select public.test_backend();
select 'ALL VENDOR TESTS PASSED' as result;
