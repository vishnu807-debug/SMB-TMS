-- =============================================================================
-- 0021 Branding: login screen, company logo and product name
--   * The software vendor (platform administrator) sets the product name and
--     product logo.
--   * The vendor or the client's Super Administrator sets the company name and
--     logo, login-screen colours, background images and texts.
--   * The login screen is shown before sign-in, so these settings (and the
--     images, in the public "branding" bucket) are readable without signing in.
--     Nothing confidential belongs here.
-- =============================================================================

create table public.login_branding (
  id                boolean primary key default true check (id),
  product_name      text not null default 'Trading Management System' check (length(trim(product_name)) between 2 and 60),
  product_logo_path text,
  company_name      text not null default 'SMP Trading' check (length(trim(company_name)) between 2 and 80),
  company_logo_path text,
  tagline           text check (tagline is null or length(tagline) <= 200),
  notice            text check (notice is null or length(notice) <= 160),
  panel_color       text not null default '#0b1b38' check (panel_color ~ '^#[0-9a-fA-F]{6}$'),
  panel_text_color  text not null default '#ffffff' check (panel_text_color ~ '^#[0-9a-fA-F]{6}$'),
  panel_image_path  text,
  form_color        text not null default '#ffffff' check (form_color ~ '^#[0-9a-fA-F]{6}$'),
  form_image_path   text,
  accent_color      text not null default '#0f244b' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id)
);
insert into public.login_branding(company_name, tagline, notice)
select coalesce(nullif(trim(trade_name), ''), 'SMP Trading'),
       'Sales, procurement, inventory, logistics and finance in one connected system.',
       'Authorised users only. Activity is logged.'
from (select (select trade_name from public.company_settings limit 1) as trade_name) s;
select public.attach_standard_triggers('public.login_branding', false);

alter table public.login_branding enable row level security;
revoke insert, update, delete, truncate on public.login_branding from anon, authenticated;
grant select on public.login_branding to anon, authenticated;
create policy login_branding_read on public.login_branding for select to anon, authenticated using (true);

-- Vendor or the client's Super Administrator (with a valid session).
create or replace function public.can_edit_branding()
returns boolean language sql stable security definer set search_path = public as $$
  select public.i_am_platform_admin() or (public.session_is_valid() and public.is_super_admin(auth.uid()));
$$;
grant execute on function public.can_edit_branding() to authenticated;

-- Image paths must point at this bucket's folders: login/…, company/…, product/… .
create or replace function public.save_login_branding(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  b public.login_branding;
  v_vendor boolean := public.i_am_platform_admin();
  k text;
begin
  if not public.can_edit_branding() then
    perform public.raise_business_error('forbidden', 'Only the system provider or a Super Administrator can change the branding.');
  end if;
  select * into b from public.login_branding for update;
  -- The product name and logo belong to the vendor.
  if not v_vendor and ((p ? 'product_name' and p->>'product_name' is distinct from b.product_name)
                    or (p ? 'product_logo_path' and nullif(p->>'product_logo_path', '') is distinct from b.product_logo_path)) then
    perform public.raise_business_error('forbidden', 'The product name and product logo are set by the system provider.');
  end if;
  foreach k in array array['panel_color', 'panel_text_color', 'form_color', 'accent_color'] loop
    if p ? k and coalesce(p->>k, '') !~ '^#[0-9a-fA-F]{6}$' then
      perform public.raise_business_error('validation', 'Colours must be in the form #RRGGBB.');
    end if;
  end loop;
  if (p ? 'product_logo_path' and nullif(p->>'product_logo_path', '') is not null and p->>'product_logo_path' !~ '^product/[A-Za-z0-9._-]+$')
     or (p ? 'company_logo_path' and nullif(p->>'company_logo_path', '') is not null and p->>'company_logo_path' !~ '^company/[A-Za-z0-9._-]+$')
     or (p ? 'panel_image_path' and nullif(p->>'panel_image_path', '') is not null and p->>'panel_image_path' !~ '^login/[A-Za-z0-9._-]+$')
     or (p ? 'form_image_path' and nullif(p->>'form_image_path', '') is not null and p->>'form_image_path' !~ '^login/[A-Za-z0-9._-]+$') then
    perform public.raise_business_error('validation', 'Upload the image again.');
  end if;
  if p ? 'company_name' and coalesce(length(trim(p->>'company_name')), 0) not between 2 and 80 then
    perform public.raise_business_error('validation', 'Enter the company name (2–80 characters).');
  end if;
  if p ? 'product_name' and coalesce(length(trim(p->>'product_name')), 0) not between 2 and 60 then
    perform public.raise_business_error('validation', 'Enter the product name (2–60 characters).');
  end if;

  update public.login_branding set
    product_name      = case when p ? 'product_name' then trim(p->>'product_name') else product_name end,
    product_logo_path = case when p ? 'product_logo_path' then nullif(p->>'product_logo_path', '') else product_logo_path end,
    company_name      = case when p ? 'company_name' then trim(p->>'company_name') else company_name end,
    company_logo_path = case when p ? 'company_logo_path' then nullif(p->>'company_logo_path', '') else company_logo_path end,
    tagline           = case when p ? 'tagline' then nullif(trim(p->>'tagline'), '') else tagline end,
    notice            = case when p ? 'notice' then nullif(trim(p->>'notice'), '') else notice end,
    panel_color       = coalesce(p->>'panel_color', panel_color),
    panel_text_color  = coalesce(p->>'panel_text_color', panel_text_color),
    panel_image_path  = case when p ? 'panel_image_path' then nullif(p->>'panel_image_path', '') else panel_image_path end,
    form_color        = coalesce(p->>'form_color', form_color),
    form_image_path   = case when p ? 'form_image_path' then nullif(p->>'form_image_path', '') else form_image_path end,
    accent_color      = coalesce(p->>'accent_color', accent_color),
    updated_at = now(), updated_by = auth.uid();
end $$;
revoke execute on function public.save_login_branding(jsonb) from public, anon;
grant execute on function public.save_login_branding(jsonb) to authenticated;

-- Public bucket: anyone may view the images (they are shown before sign-in);
-- only the vendor / Super Administrator may add or remove them, and only the
-- vendor may touch the product/ folder.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('branding', 'branding', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
    on conflict (id) do nothing;
    execute $p$create policy branding_select on storage.objects for select to authenticated
      using (bucket_id = 'branding' and public.can_edit_branding())$p$;
    execute $p$create policy branding_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'branding' and public.can_edit_branding()
                  and ((storage.foldername(name))[1] in ('login', 'company')
                       or ((storage.foldername(name))[1] = 'product' and public.i_am_platform_admin())))$p$;
    execute $p$create policy branding_delete on storage.objects for delete to authenticated
      using (bucket_id = 'branding' and public.can_edit_branding()
             and ((storage.foldername(name))[1] in ('login', 'company')
                  or ((storage.foldername(name))[1] = 'product' and public.i_am_platform_admin())))$p$;
  end if;
end $$;
