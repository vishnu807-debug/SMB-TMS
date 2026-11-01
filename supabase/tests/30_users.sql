-- =============================================================================
-- User management & authentication — behaviour tests (after 10 and 20).
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;
reset role;

-- A newly invited employee (Supabase Auth creates auth.users; the trigger makes the profile).
insert into auth.users (email, raw_user_meta_data) values ('newhire@smp.test', '{"full_name":"New Hire"}');

-- =============================================================================
-- 1. Admin creates the employee record, department and roles
-- =============================================================================
select test_as('admin@smp.test');
select public.admin_update_user(jsonb_build_object(
  'id', (select id from public.profiles where email = 'newhire@smp.test'),
  'full_name', 'Aisha Rahman', 'job_title', 'Sales Executive', 'employee_code', 'emp-014',
  'department_id', (select id from public.departments where code = 'SALES'),
  'manager_id', (select id from public.profiles where email = 'salesmgr@smp.test')));
select public.admin_set_user_roles((select id from public.profiles where email = 'newhire@smp.test'), array['sales_executive']);
select assert_eq((select employee_code from public.profiles where email = 'newhire@smp.test'), 'EMP-014', 'employee code upper-cased');
select assert_eq((select role_codes from public.v_users where email = 'newhire@smp.test'), array['sales_executive'], 'role assigned');
select expect_error($$select public.admin_set_user_roles((select id from public.profiles where email = 'newhire@smp.test'), array['no_such_role'])$$, 'Unknown');
-- The only Super Administrator cannot remove their own role.
select expect_error($$select public.admin_set_user_roles(auth.uid(), array['managing_director'])$$, 'Super Administrator must remain');
select expect_error($$select public.admin_set_user_active(auth.uid(), false, 'test')$$, 'your own account');

-- =============================================================================
-- 2. Users can edit only their own name/phone; nothing else
-- =============================================================================
select test_as('newhire@smp.test');
update public.profiles set phone = '+971 50 123 4567' where id = auth.uid();
select assert_eq((select phone from public.profiles where id = auth.uid()), '+971 50 123 4567', 'own phone updated');
select expect_error($$update public.profiles set job_title = 'Director' where id = auth.uid()$$, 'administrator');
update public.profiles set full_name = 'Hacked' where email = 'sales@smp.test';   -- RLS: matches no rows
select assert_eq((select full_name from public.profiles where email = 'sales@smp.test'), 'Sales Executive', 'cannot edit others');
select expect_error($$insert into public.user_roles (user_id, role_id) select auth.uid(), id from public.roles where code = 'super_admin'$$, 'permission denied');
select expect_error($$select public.admin_set_user_roles(auth.uid(), array['super_admin'])$$, 'do not have permission');
select assert_eq(public.has_permission('quotation.create'), true, 'role permission works');
select assert_eq(public.has_permission('inventory.view_valuation'), false, 'no valuation by default');

-- =============================================================================
-- 3. Management grants and denies extra permissions per user
-- =============================================================================
select test_as('md@smp.test');
select public.admin_set_user_permission((select id from public.profiles where email = 'newhire@smp.test'),
  'inventory.view_valuation', 'grant', 'Needs stock values for key account pricing', now() + interval '30 days');
select expect_error($$select public.admin_set_user_permission((select id from public.profiles where email = 'newhire@smp.test'),
  'inventory.adjust', 'grant', 'testing')$$, 'only grant permissions you hold');
select expect_error($$select public.admin_set_user_permission((select id from public.profiles where email = 'newhire@smp.test'),
  'user.manage', 'grant', 'testing')$$, 'Super Administrator');
select expect_error($$select public.admin_set_user_permission((select id from public.profiles where email = 'admin@smp.test'),
  'quotation.view', 'deny', 'testing')$$, 'Super Administrator');
select expect_error($$select public.admin_set_user_permission(auth.uid(), 'quotation.view', 'deny', 'testing')$$, 'own permissions');
select public.admin_set_user_permission((select id from public.profiles where email = 'newhire@smp.test'),
  'quotation.create', 'deny', 'On probation: quotations prepared by manager');
select assert_eq((select source from public.user_effective_permissions((select id from public.profiles where email = 'newhire@smp.test'))
                   where code = 'inventory.view_valuation') like 'Granted to this user until%', true, 'grant shown with expiry');
select assert_eq((select granted from public.user_effective_permissions((select id from public.profiles where email = 'newhire@smp.test'))
                   where code = 'quotation.create'), false, 'deny shown');

select test_as('newhire@smp.test');
select assert_eq(public.has_permission('inventory.view_valuation'), true, 'extra grant applies');
select assert_eq(public.has_permission('quotation.create'), false, 'deny overrides role');
select assert_eq('quotation.create' = any (array(select public.my_permissions())), false, 'my_permissions honours deny');
select expect_error($$select public.save_quotation('{}'::jsonb)$$, 'quotation.create');

-- Expired grants stop working by themselves.
reset role;
update public.user_permissions set expires_at = now() - interval '1 minute'
 where permission_id = (select id from public.permissions where code = 'inventory.view_valuation');
select test_as('newhire@smp.test');
select assert_eq(public.has_permission('inventory.view_valuation'), false, 'expired grant ignored');

select test_as('md@smp.test');
select public.admin_remove_user_permission((select id from public.profiles where email = 'newhire@smp.test'), 'quotation.create');
select test_as('newhire@smp.test');
select assert_eq(public.has_permission('quotation.create'), true, 'deny removed');

-- =============================================================================
-- 4. Sign out everywhere: tokens issued before the revocation stop working
-- =============================================================================
select test_as('admin@smp.test');
select public.revoke_user_sessions((select id from public.profiles where email = 'newhire@smp.test'));
select assert_eq((select count(*) from public.auth_events where event_type = 'sessions_revoked')::int, 1, 'revocation logged');
reset role;
-- Simulate an old access token (issued 10 minutes ago).
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where email = 'newhire@smp.test'), false);
select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where email = 'newhire@smp.test'),
       'iat', extract(epoch from now() - interval '10 minutes')::bigint)::text, false);
set role authenticated;
select assert_eq(public.has_permission('quotation.view'), false, 'old token rejected after revocation');
select assert_eq((select count(*) from public.quotations)::int, 0, 'RLS returns nothing for an old token');
-- A fresh sign-in gets a new token and works again.
select test_as('newhire@smp.test');
select assert_eq(public.has_permission('quotation.view'), true, 'new token works');

-- =============================================================================
-- 5. Deactivation removes all access immediately
-- =============================================================================
select test_as('admin@smp.test');
select expect_error($$select public.admin_set_user_active((select id from public.profiles where email = 'newhire@smp.test'), false)$$, 'reason');
select public.admin_set_user_active((select id from public.profiles where email = 'newhire@smp.test'), false, 'Left the company');
select test_as('newhire@smp.test');
select assert_eq(public.has_permission('quotation.view'), false, 'inactive user has no permissions');
select assert_eq((select count(*) from public.products)::int, 0, 'inactive user sees no data');
select test_as('admin@smp.test');
select public.admin_set_user_active((select id from public.profiles where email = 'newhire@smp.test'), true);
select assert_eq((select deactivation_reason from public.profiles where email = 'newhire@smp.test'), null::text, 'reactivated');

-- =============================================================================
-- 6. Role matrix
-- =============================================================================
select public.admin_set_role_permissions('customer_support_executive',
  array(select p.code from public.permissions p join public.role_permissions rp on rp.permission_id = p.id
         join public.roles r on r.id = rp.role_id where r.code = 'customer_support_executive') || 'quotation.create'::text);
select assert_eq((select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id
                   join public.permissions p on p.id = rp.permission_id
                   where r.code = 'customer_support_executive' and p.code = 'quotation.create')::int, 1, 'role permission added');
select expect_error($$select public.admin_set_role_permissions('super_admin', array['quotation.view'])$$, 'every permission');
select test_as('md@smp.test');
select expect_error($$select public.admin_set_role_permissions('sales_executive', array['quotation.view'])$$, 'do not have permission');

-- Audit trail captured the role and permission changes.
reset role;
select assert_eq((select count(*) from public.audit_log where table_name = 'user_permissions')::int >= 3, true, 'permission changes audited');
select assert_eq((select count(*) from public.auth_events where event_type in ('role_changed', 'permission_changed', 'user_deactivated', 'user_reactivated'))::int >= 5,
                 true, 'security events logged');
select 'ALL USER MANAGEMENT TESTS PASSED' as result;
