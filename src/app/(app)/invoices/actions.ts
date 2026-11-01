"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";
import { dispatchEinvoices } from "@/lib/einvoicing/dispatch";

const uuid = z.string().uuid();
const optUuid = z.union([z.literal(""), z.null(), z.string().uuid()]).transform((v) => v || undefined).optional();
const optDate = z.union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).transform((v) => v || undefined).optional();

const refresh = (id?: string) => {
  revalidatePath("/invoices");
  if (id) revalidatePath(`/invoices/${id}`);
  revalidatePath("/sales-orders");
};

export async function createInvoiceFromOrder(orderId: string, deliveryNoteIds?: string[]): Promise<ActionResult<{ id: string }>> {
  if (!uuid.safeParse(orderId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_invoice_from_deliveries", {
    p_sales_order_id: orderId, p_delivery_note_ids: deliveryNoteIds?.length ? deliveryNoteIds : null,
  });
  if (error) return { ok: false, error: userMessage(error) };
  refresh();
  return { ok: true, data: { id: data as string } };
}

const draft = z.object({
  id: optUuid,
  customer_id: optUuid,
  currency_code: z.string().length(3).optional(),
  exchange_rate: z.union([z.literal(""), z.coerce.number().positive()]).transform((v) => (v === "" ? undefined : v)).optional(),
  invoice_date: optDate,
  supply_date: optDate,
  due_date: optDate,
  payment_term_id: optUuid,
  customer_reference: z.string().trim().max(120).optional(),
  billing_address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  terms: z.string().max(8000).optional(),
  lines: z.array(z.object({
    id: optUuid, product_id: optUuid, description: z.string().trim().max(1000).optional(), uom_code: z.string().max(20).optional(),
    qty: z.coerce.number().min(0, "Quantities cannot be negative"),
    unit_price: z.union([z.literal(""), z.coerce.number().min(0)]).transform((v) => (v === "" ? undefined : v)).optional(),
    tax_code_id: optUuid,
  })).max(300).optional(),
});

export async function saveInvoiceDraft(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = draft.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_invoice_draft", { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  refresh(data as string);
  return { ok: true, data: { id: data as string } };
}

export async function runInvoiceAction(id: string, action: "post" | "delete" | "void" | "retry_einvoice", reason?: string): Promise<ActionResult<{ docNo?: string }>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  let res;
  if (action === "post") res = await supabase.rpc("post_invoice", { p_id: id });
  else if (action === "delete") res = await supabase.rpc("delete_invoice_draft", { p_id: id });
  else if (action === "void") res = await supabase.rpc("void_invoice", { p_id: id, p_reason: reason ?? "" });
  else res = await supabase.rpc("retry_einvoice", { p_invoice_id: id });
  if (res.error) return { ok: false, error: userMessage(res.error) };
  // Send to the e-invoicing provider straight away (no-op unless enabled and configured).
  if (action === "post" || action === "retry_einvoice") await dispatchEinvoices(5).catch((e) => console.error("e-invoice dispatch", e));
  refresh(id);
  return { ok: true, data: { docNo: typeof res.data === "string" ? res.data : undefined } };
}

export async function createCreditNote(invoiceId: string, payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = z.object({
    reason: z.string().trim().min(3, "Enter the reason for the credit note").max(500),
    lines: z.array(z.object({ invoice_line_id: uuid, qty: z.coerce.number().min(0), unit_price: z.coerce.number().min(0).optional() })).optional(),
  }).safeParse(payload);
  if (!uuid.safeParse(invoiceId).success) return { ok: false, error: "Invalid request." };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_credit_note", { p_invoice_id: invoiceId, p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  refresh(invoiceId);
  return { ok: true, data: { id: data as string } };
}
