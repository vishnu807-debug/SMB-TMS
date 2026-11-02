import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Branding = {
  productName: string; companyName: string; tagline: string | null; notice: string | null;
  panelColor: string; panelTextColor: string; formColor: string; accentColor: string;
  productLogoPath: string | null; companyLogoPath: string | null; panelImagePath: string | null; formImagePath: string | null;
  productLogoUrl: string | null; companyLogoUrl: string | null; panelImageUrl: string | null; formImageUrl: string | null;
};

const DEFAULTS: Branding = {
  productName: "Trading Management System", companyName: "SMP Trading",
  tagline: "Sales, procurement, inventory, logistics and finance in one connected system.", notice: "Authorised users only. Activity is logged.",
  panelColor: "#0b1b38", panelTextColor: "#ffffff", formColor: "#ffffff", accentColor: "#0f244b",
  productLogoPath: null, companyLogoPath: null, panelImagePath: null, formImagePath: null,
  productLogoUrl: null, companyLogoUrl: null, panelImageUrl: null, formImageUrl: null,
};

/** Login-screen and app branding (readable before sign-in). Falls back to defaults if unavailable. */
export const getBranding = cache(async (): Promise<Branding> => {
  const supabase = await createClient();
  const { data: b } = await supabase.from("login_branding").select("*").maybeSingle();
  if (!b) return DEFAULTS;
  const url = (path: string | null) => (path ? supabase.storage.from("branding").getPublicUrl(path).data.publicUrl : null);
  return {
    productName: b.product_name, companyName: b.company_name, tagline: b.tagline, notice: b.notice,
    panelColor: b.panel_color, panelTextColor: b.panel_text_color, formColor: b.form_color, accentColor: b.accent_color,
    productLogoPath: b.product_logo_path, companyLogoPath: b.company_logo_path, panelImagePath: b.panel_image_path, formImagePath: b.form_image_path,
    productLogoUrl: url(b.product_logo_path), companyLogoUrl: url(b.company_logo_path), panelImageUrl: url(b.panel_image_path), formImageUrl: url(b.form_image_path),
  };
});

/** Logo for printed documents: the one in company settings, otherwise the branding company logo. */
export async function documentLogoUrl(supabase: Awaited<ReturnType<typeof createClient>>, logoPath: string | null | undefined) {
  if (logoPath) return (await supabase.storage.from("product-media").createSignedUrl(logoPath, 120)).data?.signedUrl ?? null;
  return (await getBranding()).companyLogoUrl;
}
