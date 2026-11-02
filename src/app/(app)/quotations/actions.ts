"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";

const uuid = z.string().uuid();
const optUuid = z.union([z.literal(""), z.null(), z.string().uuid()]).transform((v) => v || undefined).optional();

export async function getCustomerForQuote(customerId: string) {
  if (!uuid.safeParse(customerId).success) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("customers")
    .select("id, name, status, currency_code, payment_term_id, delivery_term_id, default_tax_code_id, contacts:customer_contacts(id, name, is_primary), addresses:customer_addresses(id, kind, label, line1, city, is_default)")
    .eq("id", customerId).maybeSingle();
  return data;
}

export async function getRate(currency: string): Promise<number | null> {
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("rate_to_base", { p_currency: currency });
  return data === null ? null : Number(data);
}

export async function getLineDefaults(productId: string, currency: string, rate: number | null) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("quote_line_defaults", { p_product_id: productId, p_currency: currency, p_rate: rate });
  if (error) return { error: userMessage(error) };
  const d = (data as any[])?.[0];
  return d ? {
    description: d.description as string, unit_price: d.unit_price === null ? null : Number(d.unit_price), tax_code_id: d.tax_code_id as string | null,
    available: d.available_qty === null ? null : Number(d.available_qty), unit_cost: d.unit_cost === null ? null : Number(d.unit_cost),
    item_type: d.item_type as string,
  } : { error: "Product not found." };
}

const money = {
  description: z.string().trim().max(2000).optional(),
  qty: z.coerce.number().positive("Quantities must be greater than zero"),
  unit_price: z.coerce.number().min(0, "Prices cannot be negative"),
  discount_pct: z.coerce.number().min(0).max(100, "Discount cannot exceed 100%"),
  tax_code_id: optUuid,
  lead_time_text: z.string().trim().max(80).optional(), unit_cost: z.union([z.literal(""), z.null(), z.coerce.number().min(0)]).optional(),
};
const catalogueLine = z.object({
  ...money, product_id: uuid, quote_product_id: optUuid, fulfilment_mode: z.enum(["stock", "procure"]),
  description: z.string().trim().min(1, "Each line needs a description").max(2000),
});
const spec = z.object({ name: z.string().trim().max(80), value: z.string().trim().max(500) });
const newProductLine = z.object({
  ...money,
  quote_product: z.object({
    id: optUuid,
    name: z.string().trim().min(2, "Enter the new product's name").max(200),
    description: z.string().trim().max(4000).optional(),
    brand: z.string().trim().max(80).optional(),
    model_no: z.string().trim().max(80).optional(),
    technical_specs: z.array(spec).max(60, "At most 60 specification lines").optional(),
    uom_id: z.string().uuid("Select the unit of measurement"),
  }),
});
const line = z.union([catalogueLine, newProductLine]);
const schema = z.object({
  id: optUuid, customer_id: uuid, lead_id: optUuid, contact_id: optUuid, billing_address_id: optUuid, shipping_address_id: optUuid,
  sales_rep_id: optUuid, subject: z.string().trim().max(200).optional(), customer_reference: z.string().trim().max(80).optional(),
  quotation_date: z.string(), valid_until: z.string(), currency_code: z.string().length(3),
  exchange_rate: z.union([z.literal(""), z.null(), z.coerce.number().positive()]).optional(),
  payment_term_id: optUuid, delivery_term_id: optUuid, delivery_time: z.string().trim().max(120).optional(),
  delivery_location: z.string().trim().max(200).optional(), terms_conditions: z.string().max(10000),
  notes: z.string().max(4000).optional(), internal_notes: z.string().max(4000).optional(),
  lines: z.array(line).min(1, "Add at least one item.").max(200),
});

export type SavedLine = { line_no: number; product_id: string | null; quote_product_id: string | null };

export async function saveQuotation(payload: unknown): Promise<ActionResult<{ id: string; lines: SavedLine[] }>> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    // For a line, report the problem from the branch that matches it (catalogue or new product).
    let msg = i.message;
    if (i.code === "invalid_union") {
      const isNew = !!(payload as any)?.lines?.[i.path[1] as number]?.quote_product;
      msg = ((i as any).errors?.[isNew ? 1 : 0]?.[0]?.message as string | undefined) ?? msg;
    }
    return { ok: false, error: i.path[0] === "lines" && typeof i.path[1] === "number" ? `Line ${i.path[1] + 1}: ${msg}` : msg };
  }
  if (parsed.data.valid_until < parsed.data.quotation_date) return { ok: false, error: "The validity date must be on or after the quotation date." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_quotation", { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  const { data: lines } = await supabase.from("quotation_lines").select("line_no, product_id, quote_product_id").eq("quotation_id", data as string).order("line_no");
  revalidatePath("/quotations");
  return { ok: true, data: { id: data as string, lines: (lines ?? []) as SavedLine[] } };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
const docSchema = z.object({
  quotation_id: uuid,
  kind: z.enum(["datasheet", "drawing", "certificate", "supporting", "customer_confirmation", "other"]).optional(),
  product_id: optUuid, quote_product_id: optUuid, include_in_share: z.boolean().optional(),
  storage_path: z.string().max(400).optional(), file_name: z.string().trim().max(255).optional(),
  mime_type: z.string().max(120).optional(), size_bytes: z.number().int().positive().optional(),
  product_attachment_id: optUuid,
});

export async function addQuotationDocument(p: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = docSchema.safeParse(p);
  if (!parsed.success) return { ok: false, error: "Invalid document." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_quotation_document", { p: parsed.data });
  if (error) {
    // Do not leave an orphaned upload behind.
    if (parsed.data.storage_path) await supabase.storage.from("quotation-docs").remove([parsed.data.storage_path]);
    return { ok: false, error: userMessage(error) };
  }
  revalidatePath(`/quotations/${parsed.data.quotation_id}`);
  return { ok: true, data: { id: data as string } };
}

export async function removeQuotationDocument(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid document." };
  const supabase = await createClient();
  const { data: doc } = await supabase.from("quotation_documents").select("quotation_id").eq("id", id).maybeSingle();
  const { data: path, error } = await supabase.rpc("remove_quotation_document", { p_id: id });
  if (error) return { ok: false, error: userMessage(error) };
  // The file is deleted only when no other revision still lists it.
  if (path) await supabase.storage.from("quotation-docs").remove([path as string]);
  if (doc) revalidatePath(`/quotations/${doc.quotation_id}`);
  return { ok: true };
}

export async function setQuotationDocumentShared(id: string, share: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid document." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_quotation_document_shared", { p_id: id, p_share: share });
  if (error) return { ok: false, error: userMessage(error) };
  return { ok: true };
}

/** Catalogue documents of a product that can be reused on a quotation. */
export async function getProductDocuments(productId: string) {
  if (!uuid.safeParse(productId).success) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("product_attachments").select("id, file_name, kind")
    .eq("product_id", productId).neq("kind", "image").order("kind").order("file_name");
  return data ?? [];
}

/** Short-lived download link for a quotation document (RLS decides who may read it). */
export async function quotationDocumentUrl(id: string): Promise<ActionResult<{ url: string }>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid document." };
  const supabase = await createClient();
  const { data: d } = await supabase.from("quotation_documents").select("storage_path, product_attachment:product_attachments(storage_path), file_name").eq("id", id).maybeSingle();
  if (!d) return { ok: false, error: "Document not found." };
  const att = d.product_attachment as unknown as { storage_path: string } | null;
  const [bucket, path] = d.storage_path ? ["quotation-docs", d.storage_path] : ["product-media", att?.storage_path ?? ""];
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 120, { download: d.file_name });
  if (error || !data) return { ok: false, error: "The file could not be opened. You may not have access to it." };
  return { ok: true, data: { url: data.signedUrl } };
}

// ---------------------------------------------------------------------------
// Customer confirmation
// ---------------------------------------------------------------------------
const confirmation = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the confirmation date"),
  method: z.enum(["purchase_order", "email", "signed_quotation", "phone", "other"], { message: "Select how the customer confirmed" }),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(2000).optional(),
});

export async function recordCustomerConfirmation(id: string, p: unknown): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid quotation." };
  const parsed = confirmation.safeParse(p);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_customer_confirmation", { p_id: id, p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/quotations/${id}`);
  revalidatePath("/quotations");
  return { ok: true };
}

type QuoteAction = "submit" | "approve" | "reject" | "sent" | "accepted" | "lost" | "reopen" | "revise" | "convert";

export async function quotationAction(id: string, action: QuoteAction, extra: { reason?: string; poRef?: string; requiredDate?: string } = {}):
  Promise<ActionResult<{ redirect?: string; status?: string }>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid quotation." };
  const supabase = await createClient();
  let result: ActionResult<{ redirect?: string; status?: string }> = { ok: true };
  switch (action) {
    case "submit": {
      const { data, error } = await supabase.rpc("submit_quotation", { p_id: id });
      if (error) return { ok: false, error: userMessage(error) };
      result = { ok: true, data: { status: data as string } };
      break;
    }
    case "approve":
    case "reject": {
      const { data: req } = await supabase.from("approval_requests").select("id")
        .eq("doc_type", "quotation").eq("doc_id", id).eq("status", "pending").maybeSingle();
      if (!req) return { ok: false, error: "There is no pending approval for this quotation." };
      if (action === "reject" && !extra.reason?.trim()) return { ok: false, error: "Please give a reason for rejecting." };
      const { error } = await supabase.rpc("decide_approval", { p_request_id: req.id, p_approve: action === "approve", p_comment: extra.reason ?? null });
      if (error) return { ok: false, error: userMessage(error) };
      break;
    }
    case "sent": case "accepted": case "lost": {
      if (action === "lost" && !extra.reason?.trim()) return { ok: false, error: "Please give a reason." };
      const { error } = await supabase.rpc("set_quotation_status", { p_id: id, p_status: action, p_reason: extra.reason ?? null });
      if (error) return { ok: false, error: userMessage(error) };
      break;
    }
    case "reopen": {
      const { error } = await supabase.rpc("reopen_quotation", { p_id: id });
      if (error) return { ok: false, error: userMessage(error) };
      break;
    }
    case "revise": {
      const { data, error } = await supabase.rpc("revise_quotation", { p_id: id });
      if (error) return { ok: false, error: userMessage(error) };
      result = { ok: true, data: { redirect: `/quotations/${data}/edit` } };
      break;
    }
    case "convert": {
      const { data, error } = await supabase.rpc("convert_quotation_to_order", {
        p_quotation_id: id, p_customer_po_ref: extra.poRef || null, p_required_date: extra.requiredDate || null,
      });
      if (error) return { ok: false, error: userMessage(error) };
      result = { ok: true, data: { redirect: `/sales-orders/${data}` } };
      break;
    }
  }
  revalidatePath(`/quotations/${id}`);
  revalidatePath("/quotations");
  return result;
}
