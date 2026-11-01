"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";

const uuid = z.string().uuid();
const optUuid = z.union([z.literal(""), z.null(), z.string().uuid()]).transform((v) => v || undefined).optional();
const optDate = z.union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).transform((v) => v || undefined).optional();
const refresh = (id?: string) => { revalidatePath("/payables"); if (id) revalidatePath(`/payables/bills/${id}`); revalidatePath("/purchase-orders"); };

const bill = z.object({
  id: optUuid, supplier_id: uuid, purchase_order_id: optUuid,
  supplier_invoice_no: z.string().trim().min(1, "Enter the supplier's invoice number").max(60),
  supplier_trn: z.string().trim().regex(/^$|^\d{15}$/, "The supplier TRN must be 15 digits").optional(),
  bill_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the invoice date"), due_date: optDate,
  currency_code: z.string().length(3).optional(),
  exchange_rate: z.union([z.literal(""), z.coerce.number().positive()]).transform((v) => (v === "" ? undefined : v)).optional(),
  notes: z.string().trim().max(2000).optional(), attachment_path: z.string().max(300).optional(),
  lines: z.array(z.object({
    purchase_order_line_id: optUuid, product_id: optUuid, description: z.string().trim().max(1000).optional(),
    qty: z.coerce.number().min(0), unit_cost: z.coerce.number().min(0, "Unit cost cannot be negative"), tax_code_id: optUuid,
  })).min(1, "Add at least one line.").max(200),
});

export async function saveBill(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = bill.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_supplier_bill", { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  refresh(data as string);
  return { ok: true, data: { id: data as string } };
}

export async function runBillAction(id: string, action: "submit" | "void" | "approve" | "reject", comment?: string): Promise<ActionResult<{ message?: string }>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  let message: string | undefined;
  let error;
  if (action === "submit") {
    const r = await supabase.rpc("submit_supplier_bill", { p_id: id });
    error = r.error; if (r.data === "pending_approval") message = "Price differs from the purchase order — sent for approval.";
  } else if (action === "void") {
    ({ error } = await supabase.rpc("void_supplier_bill", { p_id: id, p_reason: comment ?? "" }));
  } else {
    const { data: req } = await supabase.from("approval_requests").select("id").eq("doc_type", "supplier_bill").eq("doc_id", id).eq("status", "pending").maybeSingle();
    if (!req) return { ok: false, error: "There is no pending approval for this bill." };
    ({ error } = await supabase.rpc("decide_approval", { p_request_id: req.id, p_approve: action === "approve", p_comment: comment ?? null }));
  }
  if (error) return { ok: false, error: userMessage(error) };
  refresh(id);
  return { ok: true, data: { message } };
}

/** Received-but-unbilled lines of a purchase order, for a new bill. */
export async function poLinesForBill(poId: string) {
  if (!uuid.safeParse(poId).success) return null;
  const supabase = await createClient();
  const [{ data: po }, { data: lines }, { data: pending }] = await Promise.all([
    supabase.from("purchase_orders").select("id, doc_no, supplier_id, currency_code, exchange_rate").eq("id", poId).maybeSingle(),
    supabase.from("purchase_order_lines").select("id, line_no, description, qty, qty_received, qty_billed, unit_cost, tax_code_id, product:products(sku, uom:units_of_measure(code))").eq("purchase_order_id", poId).eq("is_cancelled", false).order("line_no"),
    supabase.from("supplier_bill_lines").select("purchase_order_line_id, qty, bill:supplier_bills!inner(status)").in("bill.status", ["draft", "pending_approval"]),
  ]);
  if (!po) return null;
  const onDrafts: Record<string, number> = {};
  (pending ?? []).forEach((p: any) => { if (p.purchase_order_line_id) onDrafts[p.purchase_order_line_id] = (onDrafts[p.purchase_order_line_id] ?? 0) + Number(p.qty); });
  return {
    po,
    lines: (lines ?? []).map((l: any) => ({ id: l.id, description: l.description, sku: l.product?.sku ?? "", uom: l.product?.uom?.code ?? "", unit_cost: Number(l.unit_cost), tax_code_id: l.tax_code_id,
      ordered: Number(l.qty), received: Number(l.qty_received), billable: Math.max(Number(l.qty_received) - Number(l.qty_billed) - (onDrafts[l.id] ?? 0), 0) })),
  };
}

const supplierPayment = z.object({
  supplier_id: uuid, payment_date: optDate, method: z.enum(["bank_transfer", "cheque", "cash", "card", "pdc", "other"]), bank_account_id: optUuid,
  reference: z.string().trim().max(80).optional(), cheque_date: optDate, currency_code: z.string().length(3),
  exchange_rate: z.union([z.literal(""), z.coerce.number().positive()]).transform((v) => (v === "" ? undefined : v)).optional(),
  amount: z.coerce.number().positive("Enter the amount paid"), notes: z.string().trim().max(1000).optional(),
  allocations: z.array(z.object({ bill_id: uuid, amount: z.coerce.number().min(0) })).max(200),
});

export async function openBills(supplierId: string) {
  if (!uuid.safeParse(supplierId).success) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("v_payables").select("id, doc_no, supplier_invoice_no, bill_date, due_date, currency_code, total, balance, days_overdue").eq("supplier_id", supplierId).order("due_date");
  return data ?? [];
}

export async function recordSupplierPayment(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = supplierPayment.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const p = { ...parsed.data, allocations: parsed.data.allocations.filter((a) => a.amount > 0) };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_supplier_payment", { p });
  if (error) return { ok: false, error: userMessage(error) };
  refresh();
  return { ok: true, data: { id: data as string } };
}

export async function voidSupplierPayment(id: string, reason: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_supplier_payment", { p_id: id, p_reason: reason });
  if (error) return { ok: false, error: userMessage(error) };
  refresh(); revalidatePath(`/payables/payments/${id}`);
  return { ok: true };
}

export async function setBillAttachment(id: string, path: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_bill_attachment", { p_id: id, p_path: path });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/payables/bills/${id}`);
  return { ok: true };
}
