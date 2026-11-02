-- Branding (after 80_vendor.sql, which creates vendor@smp.test).
\set ON_ERROR_STOP 1
set client_min_messages = warning;
reset role;
select public.test_backend(); select public.grant_platform_admin('vendor@smp.test');

-- Readable before sign-in.
set role anon;
select assert_eq((select count(*) from public.login_branding)::int, 1, 'anon can read branding');
reset role;

select test_as('sales@smp.test');
select expect_error($$select public.save_login_branding('{"company_name":"Hacked"}')$$, 'system provider or a Super Administrator');
select expect_error($$update public.login_branding set company_name = 'x'$$, 'permission denied');

-- Super Administrator: company look and feel, but not the product name/logo.
select test_as('admin@smp.test');
select public.save_login_branding('{"company_name":"Gulf Pump Traders","tagline":"Pumps since 1998","panel_color":"#123456","accent_color":"#aa0000","company_logo_path":"company/logo-1.png","form_image_path":"login/bg.jpg"}');
select assert_eq((select company_name || '|' || panel_color || '|' || accent_color || '|' || company_logo_path from public.login_branding), 'Gulf Pump Traders|#123456|#aa0000|company/logo-1.png', 'admin saved');
select assert_eq((select product_name from public.login_branding), 'Trading Management System', 'product name untouched');
select expect_error($$select public.save_login_branding('{"product_name":"Other"}')$$, 'set by the system provider');
select expect_error($$select public.save_login_branding('{"product_logo_path":"product/x.png"}')$$, 'set by the system provider');
select expect_error($$select public.save_login_branding('{"panel_color":"red"}')$$, '#RRGGBB');
select expect_error($$select public.save_login_branding('{"company_logo_path":"../../etc/passwd"}')$$, 'Upload the image again');
-- Resending the unchanged product name is fine.
select public.save_login_branding((select jsonb_build_object('product_name', product_name, 'notice', 'Staff only') from public.login_branding));

-- Vendor sets the product.
select test_as('vendor@smp.test');
select public.save_login_branding('{"product_name":"NovaTrade ERP","product_logo_path":"product/nova.png"}');
select assert_eq((select product_name || '|' || product_logo_path || '|' || company_name || '|' || notice from public.login_branding), 'NovaTrade ERP|product/nova.png|Gulf Pump Traders|Staff only', 'vendor saved');
select expect_error($$select public.save_login_branding('{"product_name":"X"}')$$, '2–60');

select public.test_backend(); select public.revoke_platform_admin('vendor@smp.test');
select 'ALL BRANDING TESTS PASSED' as result;
