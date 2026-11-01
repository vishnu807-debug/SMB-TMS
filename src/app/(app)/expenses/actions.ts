"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";

const uuid = z.string().uuid();
const schema = z.object({
  id: z.union([z.literal(""), z.string().uuid()]).transform((v) => v || undefined).optional(),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the expense date"),
  category_id: z.string().uuid("Choose a category"),
  description: z.string().trim().min(3, "Describe the expense").max(500),
  vendor_name: z.string().trim().max(120).optional(),
  vendor_trn: z.string().trim().regex(/^$|^\d{15}$/, "The vendor TRN must be 15 digits").optional(),
  receipt_no: z.string().trim().max(60).optional(),
  amount: z.coerce.number().positive("Enter the amount before VAT"),
  vat_amount: z.coerce.number().min(0).optional(),
  paid_by: z.enum(["employee", "company"]),
  sales_order_id: z.union([z.literal(""), z.string().uuid()]).transform((v) => v || undefined).optional(),
  notes: z.string().trim().max(1000).optional(),
});
const refresh = (id?: string) => { revalidatePath("/expenses"); if (id) revalidatePath(`/expenses/${id}`); };

export async function saveExpense(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_expense", { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  refresh(data as string);
  return { ok: true, data: { id: data as string } };
}

export async function setExpenseReceipt(id: string, path: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_expense_receipt", { p_id: id, p_path: path });
  if (error) return { ok: false, error: userMessage(error) };
  refresh(id);
  return { ok: true };
}

export async function runExpenseAction(id: string, action: "submit" | "cancel" | "approve" | "reject" | "pay", extra?: { comment?: string; bank_account_id?: string; reference?: string; paid_at?: string }): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  let error;
  if (action === "submit") ({ error } = await supabase.rpc("submit_expense", { p_id: id }));
  else if (action === "cancel") ({ error } = await supabase.rpc("cancel_expense", { p_id: id }));
  else if (action === "pay") ({ error } = await supabase.rpc("mark_expense_paid", { p_id: id, p: { bank_account_id: extra?.bank_account_id, reference: extra?.reference, paid_at: extra?.paid_at } }));
  else {
    const { data: req } = await supabase.from("approval_requests").select("id").eq("doc_type", "expense").eq("doc_id", id).eq("status", "pending").maybeSingle();
    if (!req) return { ok: false, error: "There is no pending approval for this claim." };
    if (action === "reject" && !extra?.comment?.trim()) return { ok: false, error: "Please give a reason for rejecting." };
    ({ error } = await supabase.rpc("decide_approval", { p_request_id: req.id, p_approve: action === "approve", p_comment: extra?.comment ?? null }));
  }
  if (error) return { ok: false, error: userMessage(error) };
  refresh(id);
  return { ok: true };
}
