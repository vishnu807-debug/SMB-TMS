"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";

const uuid = z.string().uuid();
const optUuid = z.union([z.literal(""), z.null(), z.string().uuid()]).transform((v) => v || undefined).optional();
const optDate = z.union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).transform((v) => v || undefined).optional();
const allocations = z.array(z.object({ invoice_id: uuid, amount: z.coerce.number().min(0) })).max(200);

const schema = z.object({
  customer_id: uuid,
  payment_date: optDate,
  method: z.enum(["bank_transfer", "cheque", "cash", "card", "pdc", "other"]),
  bank_account_id: optUuid,
  reference: z.string().trim().max(80).optional(),
  cheque_date: optDate,
  currency_code: z.string().length(3),
  exchange_rate: z.union([z.literal(""), z.coerce.number().positive()]).transform((v) => (v === "" ? undefined : v)).optional(),
  amount: z.coerce.number().positive("Enter the amount received"),
  notes: z.string().trim().max(1000).optional(),
  allocations,
});

/** Open invoices of a customer, for allocation. */
export async function openInvoices(customerId: string) {
  if (!uuid.safeParse(customerId).success) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("v_receivables").select("id, doc_no, invoice_date, due_date, currency_code, total, balance, days_overdue")
    .eq("customer_id", customerId).order("due_date");
  return data ?? [];
}

export async function recordPayment(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const p = { ...parsed.data, allocations: parsed.data.allocations.filter((a) => a.amount > 0) };
  if (p.allocations.reduce((a, x) => a + x.amount, 0) > p.amount + 0.001) return { ok: false, error: "The allocations are more than the amount received." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_customer_payment", { p });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/payments"); revalidatePath("/invoices");
  return { ok: true, data: { id: data as string } };
}

export async function allocatePayment(paymentId: string, payload: unknown): Promise<ActionResult> {
  const parsed = allocations.safeParse(payload);
  if (!uuid.safeParse(paymentId).success || !parsed.success) return { ok: false, error: "Invalid allocation." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("allocate_customer_payment", { p_payment_id: paymentId, p_allocations: parsed.data.filter((a) => a.amount > 0) });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/payments/${paymentId}`); revalidatePath("/invoices");
  return { ok: true };
}

export async function voidPayment(paymentId: string, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(paymentId).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_customer_payment", { p_id: paymentId, p_reason: reason });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/payments/${paymentId}`); revalidatePath("/payments"); revalidatePath("/invoices");
  return { ok: true };
}
