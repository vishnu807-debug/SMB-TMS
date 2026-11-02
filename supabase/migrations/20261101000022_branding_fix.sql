-- =============================================================================
-- 0022 Fix: saving the branding failed on hosted Supabase.
--   Supabase rejects UPDATE statements without a WHERE clause (pg-safeupdate),
--   which the single-row update in save_login_branding (0021) used.
-- =============================================================================
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
  select * into b from public.login_branding where id for update;
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
    updated_at = now(), updated_by = auth.uid()
  where id;
end $$;
