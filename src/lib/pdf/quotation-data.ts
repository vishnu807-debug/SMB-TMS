import "server-only";
import { createClient } from "@/lib/supabase/server";
import { renderQuotationPdf } from "./quotation-pdf";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Loads a quotation through RLS and renders its PDF (costs are never loaded). Null when not visible. */
export async function buildQuotationPdf(supabase: Supabase, id: string) {
  const [{ data: q }, { data: lines }, { data: company }, { data: docs }] = await Promise.all([
    supabase.from("quotations").select(`*, customer:customers(name, trn), contact:customer_contacts(name, email, mobile),
      bill:customer_addresses!quotations_billing_address_id_fkey(line1, line2, city, emirate, po_box, country),
      ship:customer_addresses!quotations_shipping_address_id_fkey(line1, line2, city, emirate, po_box, country),
      rep:profiles!quotations_sales_rep_id_fkey(full_name), pterm:payment_terms(name), dterm:delivery_terms(code, name)`).eq("id", id).maybeSingle(),
    supabase.from("quotation_lines").select("id, line_no, description, qty, unit_price, discount_pct, tax_rate, net_amount, lead_time_text, uom:units_of_measure(code), product:products(sku), qp:quote_products(brand, model_no, technical_specs)")
      .eq("quotation_id", id).order("line_no"),
    supabase.from("company_settings").select("*").single(),
    supabase.from("quotation_documents").select("id, file_name, kind, storage_path, product_attachment:product_attachments(storage_path)")
      .eq("quotation_id", id).eq("include_in_share", true).neq("kind", "customer_confirmation").order("created_at"),
  ]);
  if (!q) return null;
  let logoUrl: string | null = null;
  if (company?.logo_path) {
    const { data } = await supabase.storage.from("product-media").createSignedUrl(company.logo_path, 120);
    logoUrl = data?.signedUrl ?? null;
  }
  const enclosures = (docs ?? []).map((d) => d.file_name);
  const pdf = await renderQuotationPdf({ company: { ...company, logoUrl } as any, quotation: q, lines: lines ?? [], enclosures });
  return { quotation: q, pdf, docs: docs ?? [] };
}
