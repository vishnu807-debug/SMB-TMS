import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { buildQuotationPdf } from "@/lib/pdf/quotation-data";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.isActive) return new NextResponse("Unauthorised", { status: 401 });
  if (!user.permissions.has("quotation.view")) return new NextResponse("Forbidden", { status: 403 });

  // RLS limits this to quotations the user may see.
  const built = await buildQuotationPdf(await createClient(), id);
  if (!built) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(built.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${built.quotation.doc_no}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
