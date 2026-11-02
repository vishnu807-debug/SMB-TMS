"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";

const uuid = z.string().uuid();
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(2, "Enter the product name").max(200),
    sku: z.string().trim().max(40).regex(/^$|^[A-Za-z0-9][A-Za-z0-9._/-]{1,39}$/, "SKU may contain letters, numbers, dot, dash, slash and underscore").optional(),
    item_type: z.enum(["stock", "non_stock", "service"]),
    category_id: z.union([z.literal(""), uuid]).optional(),
    description: z.string().trim().max(4000).optional(),
    note: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal("link"), product_id: uuid, note: z.string().trim().max(500).optional() }),
]);

const safeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(-80);

/**
 * Adds a new product from a confirmed quotation to the catalogue (or links it to an existing
 * product). The database enforces confirmation, permission and one-time promotion; afterwards
 * the item's datasheets are copied to the product so they appear in the catalogue too.
 */
export async function promoteQuoteProduct(id: string, payload: unknown): Promise<ActionResult<{ productId: string; sku: string; copied: number; copyErrors: string[] }>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid item." };
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data: productId, error } = await supabase.rpc("promote_quote_product", { p_quote_product_id: id, p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };

  const copyErrors: string[] = [];
  let copied = 0;
  if (parsed.data.action === "create") {
    const { data: docs } = await supabase.from("quotation_documents").select("storage_path, file_name, mime_type, size_bytes, kind")
      .eq("quote_product_id", id).not("storage_path", "is", null);
    const seen = new Set<string>();
    for (const d of docs ?? []) {
      if (!d.storage_path || seen.has(d.storage_path)) continue;
      seen.add(d.storage_path);
      const { data: blob, error: dl } = await supabase.storage.from("quotation-docs").download(d.storage_path);
      if (dl || !blob) { copyErrors.push(d.file_name); continue; }
      const path = `products/${productId}/${crypto.randomUUID()}-${safeName(d.file_name)}`;
      const { error: up } = await supabase.storage.from("product-media").upload(path, blob, { contentType: d.mime_type ?? "application/pdf", upsert: false });
      if (up) { copyErrors.push(d.file_name); continue; }
      const { error: ins } = await supabase.from("product_attachments").insert({
        product_id: productId, kind: ["datasheet", "drawing", "certificate"].includes(d.kind) ? d.kind : "other",
        file_name: d.file_name, storage_path: path, mime_type: d.mime_type, size_bytes: d.size_bytes,
      });
      if (ins) { await supabase.storage.from("product-media").remove([path]); copyErrors.push(d.file_name); continue; }
      copied++;
    }
  }
  const [{ data: product }, { data: qp }] = await Promise.all([
    supabase.from("products").select("sku").eq("id", productId as string).single(),
    supabase.from("quote_products").select("quotation_id").eq("id", id).single(),
  ]);
  revalidatePath("/products/pending");
  revalidatePath("/products");
  if (qp) revalidatePath(`/quotations/${qp.quotation_id}`);
  return { ok: true, data: { productId: productId as string, sku: product?.sku ?? "", copied, copyErrors } };
}
