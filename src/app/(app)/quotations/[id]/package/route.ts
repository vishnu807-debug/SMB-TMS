import { NextResponse, type NextRequest } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { buildQuotationPdf } from "@/lib/pdf/quotation-data";

export const runtime = "nodejs";

/** ZIP for the customer: the quotation PDF plus every document ticked "For customer". */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user?.isActive) return new NextResponse("Unauthorised", { status: 401 });
  if (!user.permissions.has("quotation.view")) return new NextResponse("Forbidden", { status: 403 });

  const supabase = await createClient();
  const built = await buildQuotationPdf(supabase, id);
  if (!built) return new NextResponse("Not found", { status: 404 });

  const files: Record<string, Uint8Array> = { [`${built.quotation.doc_no}.pdf`]: new Uint8Array(built.pdf) };
  const missing: string[] = [];
  const used = new Set(Object.keys(files).map((f) => f.toLowerCase()));
  for (const d of built.docs) {
    const att = d.product_attachment as unknown as { storage_path: string } | null;
    const [bucket, path] = d.storage_path ? ["quotation-docs", d.storage_path] : ["product-media", att?.storage_path];
    if (!path) { missing.push(d.file_name); continue; }
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error || !data) { missing.push(d.file_name); continue; }
    // Unique names inside the ZIP.
    let name = d.file_name.replace(/[\\/:*?"<>|]+/g, "-");
    for (let n = 2; used.has(`documents/${name}`.toLowerCase()); n++) name = d.file_name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
    used.add(`documents/${name}`.toLowerCase());
    files[`documents/${name}`] = new Uint8Array(await data.arrayBuffer());
  }
  if (missing.length) files["MISSING-FILES.txt"] = strToU8(`These documents could not be included:\r\n${missing.join("\r\n")}\r\n`);
  const zip = zipSync(files, { level: 6 });
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${built.quotation.doc_no}-for-customer.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}
