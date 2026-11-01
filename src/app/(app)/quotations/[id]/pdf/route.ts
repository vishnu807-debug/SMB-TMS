import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { renderQuotationPdf } from "@/lib/pdf/quotation-pdf";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.isActive) return new NextResponse("Unauthorised", { status: 401 });
  if (!user.permissions.has("quotation.view")) return new NextResponse("Forbidden", { status: 403 });

  const supabase = await createClient();
  // RLS limits this to quotations the user may see. Costs are never loaded here.
  const [{ data: q }, { data: lines }, { data: company }] = await Promise.all([
    supabase.from("quotations").select(`*, customer:customers(name, trn), contact:customer_contacts(name, email, mobile),
      bill:customer_addresses!quotations_billing_address_id_fkey(line1, line2, city, emirate, po_box, country),
      ship:customer_addresses!quotations_shipping_address_id_fkey(line1, line2, city, emirate, po_box, country),
      rep:profiles!quotations_sales_rep_id_fkey(full_name), pterm:payment_terms(name), dterm:delivery_terms(code, name)`).eq("id", id).maybeSingle(),
    supabase.from("quotation_lines").select("id, line_no, description, qty, unit_price, discount_pct, tax_rate, net_amount, lead_time_text, product:products(sku, uom:units_of_measure(code))").eq("quotation_id", id).order("line_no"),
    supabase.from("company_settings").select("*").single(),
  ]);
  if (!q) return new NextResponse("Not found", { status: 404 });

  let logoUrl: string | null = null;
  if (company?.logo_path) {
    const { data } = await supabase.storage.from("product-media").createSignedUrl(company.logo_path, 120);
    logoUrl = data?.signedUrl ?? null;
  }
  const pdf = await renderQuotationPdf({ company: { ...company, logoUrl } as any, quotation: q, lines: lines ?? [] });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${q.doc_no}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
