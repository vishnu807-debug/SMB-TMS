import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { renderPurchaseOrderPdf } from "@/lib/pdf/purchase-order-pdf";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.isActive) return new NextResponse("Unauthorised", { status: 401 });
  if (!user.permissions.has("purchase_order.view")) return new NextResponse("Forbidden", { status: 403 });

  const supabase = await createClient();
  const [{ data: po }, { data: lines }, { data: company }] = await Promise.all([
    supabase.from("purchase_orders").select(`*, supplier:suppliers(name, trn, address, city, country), contact:supplier_contacts(name, email, phone),
      warehouse:warehouses(name, code, address), pterm:payment_terms(name), dterm:delivery_terms(code, name),
      creator:profiles!purchase_orders_created_by_fkey(full_name), approver:profiles!purchase_orders_approved_by_fkey(full_name)`).eq("id", id).maybeSingle(),
    supabase.from("purchase_order_lines").select("id, line_no, description, qty, unit_cost, tax_rate, net_amount, product:products(sku, model_no, uom:units_of_measure(code))")
      .eq("purchase_order_id", id).eq("is_cancelled", false).order("line_no"),
    supabase.from("company_settings").select("*").single(),
  ]);
  if (!po) return new NextResponse("Not found", { status: 404 });

  let logoUrl: string | null = null;
  if (company?.logo_path) {
    const { data } = await supabase.storage.from("product-media").createSignedUrl(company.logo_path, 120);
    logoUrl = data?.signedUrl ?? null;
  }
  const pdf = await renderPurchaseOrderPdf({ company: { ...company, logoUrl } as any, po, lines: lines ?? [] });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${po.doc_no}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
