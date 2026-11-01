import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { renderDeliveryNotePdf } from "@/lib/pdf/delivery-note-pdf";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.isActive) return new NextResponse("Unauthorised", { status: 401 });
  if (!user.permissions.has("delivery.view")) return new NextResponse("Forbidden", { status: 403 });
  const supabase = await createClient();
  const [{ data: dn }, { data: lines }, { data: company }] = await Promise.all([
    supabase.from("delivery_notes").select("*, so:sales_orders(doc_no, customer_po_ref), customer:customers(name, trn), shipment:shipments(doc_no, vehicle_no, driver_name, carrier_name, tracking_no)").eq("id", id).maybeSingle(),
    supabase.from("delivery_note_lines").select("id, line_no, description, qty, product:products(sku, uom:units_of_measure(code))").eq("delivery_note_id", id).order("line_no"),
    supabase.from("company_settings").select("*").single(),
  ]);
  if (!dn) return new NextResponse("Not found", { status: 404 });
  let logoUrl: string | null = null;
  if (company?.logo_path) logoUrl = (await supabase.storage.from("product-media").createSignedUrl(company.logo_path, 120)).data?.signedUrl ?? null;
  const pdf = await renderDeliveryNotePdf({ company: { ...company, logoUrl } as any, dn, lines: lines ?? [] });
  return new NextResponse(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${dn.doc_no}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
