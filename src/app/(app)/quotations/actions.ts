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

const line = z.object({
  product_id: uuid, description: z.string().trim().min(1, "Each line needs a description").max(2000),
  qty: z.coerce.number().positive("Quantities must be greater than zero"),
  unit_price: z.coerce.number().min(0, "Prices cannot be negative"),
  discount_pct: z.coerce.number().min(0).max(100, "Discount cannot exceed 100%"),
  tax_code_id: optUuid, fulfilment_mode: z.enum(["stock", "procure"]),
  lead_time_text: z.string().trim().max(80).optional(), unit_cost: z.union([z.literal(""), z.null(), z.coerce.number().min(0)]).optional(),
});
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

export async function saveQuotation(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i.path[0] === "lines" && typeof i.path[1] === "number" ? `Line ${i.path[1] + 1}: ${i.message}` : i.message };
  }
  if (parsed.data.valid_until < parsed.data.quotation_date) return { ok: false, error: "The validity date must be on or after the quotation date." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_quotation", { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/quotations");
  return { ok: true, data: { id: data as string } };
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
