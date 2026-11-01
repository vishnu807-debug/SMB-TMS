"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";

const uuid = z.string().uuid();
const optUuid = z.union([z.literal(""), z.null(), z.string().uuid()]).transform((v) => v || undefined).optional();
const optDate = z.union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).transform((v) => v || undefined).optional();
const line = z.object({
  product_id: uuid,
  description: z.string().trim().min(1, "Enter a description").max(1000),
  qty: z.coerce.number().positive("Quantity must be greater than zero"),
  unit_cost: z.coerce.number().min(0, "Unit cost cannot be negative"),
  tax_code_id: optUuid,
  requisition_line_id: optUuid,
  supplier_quotation_line_id: optUuid,
});
const schema = z.object({
  id: optUuid,
  supplier_id: uuid,
  supplier_contact_id: optUuid,
  supplier_quotation_id: optUuid,
  supplier_reference: z.string().trim().max(80).optional(),
  warehouse_id: uuid,
  order_date: optDate,
  expected_date: optDate,
  currency_code: z.string().length(3),
  exchange_rate: z.union([z.literal(""), z.coerce.number().positive()]).transform((v) => (v === "" ? undefined : v)).optional(),
  payment_term_id: optUuid,
  delivery_term_id: optUuid,
  terms_conditions: z.string().max(8000).optional(),
  notes: z.string().trim().max(4000).optional(),
  lines: z.array(line).min(1, "Add at least one item.").max(200),
});

export async function savePurchaseOrder(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return { ok: false, error: i.path[0] === "lines" && i.path.length > 1 ? `Line ${Number(i.path[1]) + 1}: ${i.message}` : i.message };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_purchase_order", { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/purchase-orders");
  return { ok: true, data: { id: data as string } };
}

/** Latest price for a product: this supplier's price list first, then the product's purchase price. */
export async function supplierCost(supplierId: string, productId: string) {
  if (!uuid.safeParse(supplierId).success || !uuid.safeParse(productId).success) return null;
  const supabase = await createClient();
  const [{ data: sp }, { data: p }] = await Promise.all([
    supabase.from("supplier_products").select("last_cost, currency_code").eq("supplier_id", supplierId).eq("product_id", productId).maybeSingle(),
    supabase.from("products").select("name, purchase_price, currency_code, tax_code_id").eq("id", productId).maybeSingle(),
  ]);
  return {
    description: p?.name ?? "",
    tax_code_id: p?.tax_code_id ?? null,
    cost: sp ? Number(sp.last_cost) : p?.purchase_price != null ? Number(p.purchase_price) : null,
    currency: sp?.currency_code ?? p?.currency_code ?? null,
  };
}

const ACTIONS: Record<string, string> = {
  submit: "submit_purchase_order", reopen: "reopen_purchase_order", send: "mark_purchase_order_sent",
};

export async function runPurchaseOrderAction(id: string, action: string, comment?: string): Promise<ActionResult<{ message?: string }>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  let error;
  let message: string | undefined;
  if (action in ACTIONS) {
    const res = await supabase.rpc(ACTIONS[action], { p_id: id });
    error = res.error;
    if (action === "submit" && res.data === "pending_approval") message = "Sent for approval.";
  } else if (action === "cancel" || action === "close") {
    if (!comment?.trim()) return { ok: false, error: `Please give a reason for ${action === "cancel" ? "cancelling" : "closing"}.` };
    ({ error } = await supabase.rpc(action === "cancel" ? "cancel_purchase_order" : "close_purchase_order", { p_id: id, p_reason: comment }));
  } else if (action === "approve" || action === "reject") {
    const { data: req } = await supabase.from("approval_requests").select("id").eq("doc_type", "purchase_order").eq("doc_id", id).eq("status", "pending").maybeSingle();
    if (!req) return { ok: false, error: "There is no pending approval for this purchase order." };
    if (action === "reject" && !comment?.trim()) return { ok: false, error: "Please give a reason for rejecting." };
    ({ error } = await supabase.rpc("decide_approval", { p_request_id: req.id, p_approve: action === "approve", p_comment: comment ?? null }));
  } else return { ok: false, error: "Unknown action." };
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchase-orders");
  revalidatePath("/procurement");
  return { ok: true, data: { message } };
}
