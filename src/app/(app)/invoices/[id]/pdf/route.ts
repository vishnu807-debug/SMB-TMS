import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.isActive) return new NextResponse("Unauthorised", { status: 401 });
  if (!user.permissions.has("invoice.view")) return new NextResponse("Forbidden", { status: 403 });
  const supabase = await createClient();
  const [{ data: inv }, { data: lines }, { data: company }] = await Promise.all([
    supabase.from("customer_invoices").select("*, so:sales_orders(doc_no), pterm:payment_terms(name), orig:credit_for_invoice_id(doc_no, invoice_date)").eq("id", id).maybeSingle(),
    supabase.from("customer_invoice_lines").select("*, product:products(sku)").eq("invoice_id", id).order("line_no"),
    supabase.from("company_settings").select("*").single(),
  ]);
  if (!inv) return new NextResponse("Not found", { status: 404 });
  let logoUrl: string | null = null;
  if (company?.logo_path) logoUrl = (await supabase.storage.from("product-media").createSignedUrl(company.logo_path, 120)).data?.signedUrl ?? null;
  const pdf = await renderInvoicePdf({ company: { ...company, logoUrl } as any, inv, lines: lines ?? [], baseCurrency: company?.base_currency ?? "AED" });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${inv.doc_no ?? "draft-invoice"}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
