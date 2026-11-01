"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";

const uuid = z.string().uuid();

const draftSchema = z.object({
  id: uuid,
  customer_po_ref: z.string().trim().max(80).optional(),
  required_date: z.string().optional(),
  delivery_location: z.string().trim().max(200).optional(),
  internal_notes: z.string().max(4000).optional(),
  lines: z.array(z.object({ id: uuid, fulfilment_mode: z.enum(["stock", "procure"]), warehouse_id: z.union([z.literal(""), uuid]).optional() })),
});

export async function updateOrderDraft(payload: unknown): Promise<ActionResult> {
  const parsed = draftSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_sales_order_draft", { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/sales-orders/${parsed.data.id}`);
  return { ok: true, message: "Order updated." };
}

type OrderAction = "confirm" | "approve" | "reject" | "hold" | "release" | "cancel";

export async function orderAction(id: string, action: OrderAction, reason?: string): Promise<ActionResult<{ status?: string }>> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid order." };
  const supabase = await createClient();
  let error;
  let status: string | undefined;
  if (action === "confirm") {
    const r = await supabase.rpc("confirm_sales_order", { p_id: id });
    error = r.error; status = r.data as string;
  } else if (action === "approve" || action === "reject") {
    const { data: req } = await supabase.from("approval_requests").select("id").eq("doc_type", "sales_order").eq("doc_id", id).eq("status", "pending").maybeSingle();
    if (!req) return { ok: false, error: "There is no pending approval for this order." };
    if (action === "reject" && !reason?.trim()) return { ok: false, error: "Please give a reason for rejecting." };
    ({ error } = await supabase.rpc("decide_approval", { p_request_id: req.id, p_approve: action === "approve", p_comment: reason ?? null }));
  } else if (action === "hold" || action === "release") {
    if (action === "hold" && !reason?.trim()) return { ok: false, error: "Please give a reason for the hold." };
    ({ error } = await supabase.rpc("set_sales_order_hold", { p_id: id, p_hold: action === "hold", p_reason: reason ?? null }));
  } else if (action === "cancel") {
    if (!reason?.trim()) return { ok: false, error: "Please give a reason for cancelling." };
    ({ error } = await supabase.rpc("cancel_sales_order", { p_id: id, p_reason: reason }));
  }
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/sales-orders/${id}`);
  revalidatePath("/sales-orders");
  return { ok: true, data: { status } };
}
