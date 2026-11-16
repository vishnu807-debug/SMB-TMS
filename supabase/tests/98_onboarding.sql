-- Client onboarding (last: it renames the company and changes modules).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
reset role;
select test_as('admin@smp.test');
select expect_error($$select public.onboard_client('{"legal_name":"X Co"}')$$, 'permission denied');
select public.test_backend();
insert into auth.users (email, raw_user_meta_data) values ('it@oilmark.test', '{"full_name":"Oilmark IT"}');
select expect_error($$select public.onboard_client('{}')$$, 'legal_name');
select expect_error($$select public.onboard_client('{"legal_name":"Oilmark International LLC","admin_email":"nobody@oilmark.test"}')$$, 'Create it first');
select expect_error($$select public.onboard_client('{"legal_name":"Oilmark International LLC","modules":["logistics"]}')$$, 'needs Sales');
select public.onboard_client('{"legal_name":"Oilmark International LLC","trade_name":"Oilmark","admin_email":"it@oilmark.test",
  "vendor_email":"vendor@smp.test","product_name":"Nexora","modules":["sales","procurement","finance"]}');
select assert_eq((select legal_name || '|' || trade_name from public.company_settings), 'Oilmark International LLC|Oilmark', 'company');
select assert_eq((select quotation_terms like '%property of Oilmark%' and quotation_terms not like '%SMP%' from public.company_settings), true, 'terms renamed');
select assert_eq((select company_name || '|' || product_name from public.login_branding), 'Oilmark|Nexora', 'branding');
select assert_eq(public.is_super_admin((select id from public.profiles where email = 'it@oilmark.test')), true, 'admin role');
select assert_eq(public.is_platform_admin((select id from public.profiles where email = 'vendor@smp.test')), true, 'vendor access');
select assert_eq((select string_agg(code, ',' order by sort_order) from public.system_modules where is_enabled), 'core,sales,procurement,finance', 'modules');
-- Running again is safe.
select public.onboard_client('{"legal_name":"Oilmark International LLC","trade_name":"Oilmark","admin_email":"it@oilmark.test","modules":["sales","procurement","finance"]}');
select assert_eq((select count(*) from public.user_roles ur join public.profiles p on p.id = ur.user_id where p.email = 'it@oilmark.test')::int, 1, 'idempotent');
select 'ALL ONBOARDING TESTS PASSED' as result;
