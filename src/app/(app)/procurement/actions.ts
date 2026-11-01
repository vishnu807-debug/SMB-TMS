"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";

const uuid = z.string().uuid();
const optUuid = z.union([z.literal(""), z.null(), z.string().uuid()]).transform((v) => v || undefined).optional();
const optDate = z.union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).transform((v) => v || undefined).optional();

const requisition = z.object({
  required_date: optDate,
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(z.object({
    product_id: uuid, qty: z.coerce.number().positive("Quantities must be greater than zero"),
    description: z.string().trim().max(1000).optional(), supplier_id: optUuid,
  })).min(1, "Add at least one item.").max(200),
});

export async function createRequisition(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = requisition.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_requisition", { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/procurement");
  return { ok: true, data: { id: data as string } };
}

export async function createReorderRequisition(): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_reorder_requisition");
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/procurement");
  return { ok: true, data: { id: data as string } };
}

export async function cancelRequisitionLine(id: string, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_requisition_line", { p_line: id, p_reason: reason });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/procurement");
  return { ok: true };
}

const quote = z.object({
  id: optUuid,
  supplier_id: uuid,
  requisition_id: optUuid,
  quote_date: optDate,
  valid_until: optDate,
  supplier_reference: z.string().trim().max(80).optional(),
  currency_code: z.string().length(3),
  exchange_rate: z.union([z.literal(""), z.coerce.number().positive()]).transform((v) => (v === "" ? undefined : v)).optional(),
  delivery_days: z.union([z.literal(""), z.coerce.number().int().min(0)]).transform((v) => (v === "" ? undefined : v)).optional(),
  payment_term_id: optUuid,
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(z.object({
    product_id: uuid, requisition_line_id: optUuid,
    qty: z.coerce.number().positive("Enter the quantity quoted"),
    unit_price: z.coerce.number().min(0, "Enter the price"),
    lead_time_days: z.union([z.literal(""), z.coerce.number().int().min(0)]).transform((v) => (v === "" ? undefined : v)).optional(),
    notes: z.string().trim().max(500).optional(),
  })).min(1, "Add at least one priced item.").max(200),
});

export async function saveSupplierQuotation(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = quote.safeParse(payload);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i.path[0] === "lines" && i.path.length > 1 ? `Line ${Number(i.path[1]) + 1}: ${i.message}` : i.message };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_supplier_quotation", { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/procurement");
  return { ok: true, data: { id: data as string } };
}

export async function selectSupplierQuotation(id: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("select_supplier_quotation", { p_id: id });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/procurement");
  return { ok: true };
}
