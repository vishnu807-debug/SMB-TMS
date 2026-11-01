"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";
import { DOC_KINDS, isDocKind, type DocKind } from "@/lib/inventory-config";

const uuid = z.string().uuid();
const num = z.coerce.number().finite();

const line = z.object({
  product_id: uuid,
  qty: num.optional(),
  unit_cost: num.min(0).optional(),
  unit_cost_base: num.min(0).optional(),
  mode: z.enum(["change", "count"]).optional(),
  qty_change: num.optional(),
  counted_qty: num.min(0).optional(),
  sales_order_line_id: uuid.optional(),
  purchase_order_line_id: uuid.optional(),
  notes: z.string().max(500).optional(),
});

const payloads: Record<DocKind, z.ZodTypeAny> = {
  receipts: z.object({
    id: uuid.optional(), warehouse_id: uuid, supplier_id: uuid.optional(), purchase_order_id: uuid.optional(), receipt_date: z.string().optional(),
    supplier_reference: z.string().max(80).optional(), currency_code: z.string().length(3).optional(), exchange_rate: num.positive().optional(),
    notes: z.string().max(2000).optional(), lines: z.array(line).min(1, "Add at least one item."),
  }),
  issues: z.object({
    id: uuid.optional(), warehouse_id: uuid, issue_type: z.enum(["internal_use", "sample", "return_to_supplier", "other"]),
    supplier_id: uuid.optional(), issued_to: z.string().max(120).optional(), reference: z.string().max(80).optional(),
    issue_date: z.string().optional(), allow_negative: z.boolean().optional(), negative_reason: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(), lines: z.array(line).min(1, "Add at least one item."),
  }),
  transfers: z.object({
    id: uuid.optional(), from_warehouse_id: uuid, to_warehouse_id: uuid, transfer_date: z.string().optional(),
    notes: z.string().max(2000).optional(), lines: z.array(line).min(1, "Add at least one item."),
  }),
  adjustments: z.object({
    id: uuid.optional(), warehouse_id: uuid,
    reason: z.enum(["physical_count", "damaged", "expired", "lost_or_stolen", "found", "data_correction", "opening_balance", "other"]),
    adjustment_date: z.string().optional(), allow_negative: z.boolean().optional(), notes: z.string().max(2000).optional(),
    lines: z.array(line).min(1, "Add at least one item."),
  }),
};

/** Saves a draft stock document. All validation is repeated in the database function. */
export async function saveStockDocument(kind: string, payload: unknown): Promise<ActionResult<{ id: string }>> {
  if (!isDocKind(kind)) return { ok: false, error: "Unknown document type." };
  const parsed = payloads[kind].safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.path[0] === "lines" && issue.path.length > 1 ? `Line ${Number(issue.path[1]) + 1}: ${issue.message}` : issue.message };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(DOC_KINDS[kind].saveRpc, { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/inventory/${kind}`);
  return { ok: true, data: { id: data as string } };
}

const ACTIONS = {
  receipts: { post: "post_goods_receipt" },
  issues: { post: "post_goods_issue" },
  transfers: { dispatch: "dispatch_stock_transfer", receive: "receive_stock_transfer" },
  adjustments: { submit: "submit_stock_adjustment" },
} as Record<DocKind, Record<string, string>>;

export async function runDocumentAction(kind: string, id: string, action: string, comment?: string): Promise<ActionResult> {
  if (!isDocKind(kind) || !uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  let error;
  if (action === "cancel") {
    ({ error } = await supabase.rpc("cancel_inventory_document", { p_type: DOC_KINDS[kind].docType, p_id: id }));
  } else if (kind === "adjustments" && (action === "approve" || action === "reject")) {
    const { data: req } = await supabase.from("approval_requests").select("id")
      .eq("doc_type", "stock_adjustment").eq("doc_id", id).eq("status", "pending").maybeSingle();
    if (!req) return { ok: false, error: "There is no pending approval for this adjustment." };
    if (action === "reject" && !comment?.trim()) return { ok: false, error: "Please give a reason for rejecting." };
    ({ error } = await supabase.rpc("decide_approval", { p_request_id: req.id, p_approve: action === "approve", p_comment: comment ?? null }));
  } else {
    const rpc = ACTIONS[kind][action];
    if (!rpc) return { ok: false, error: "Unknown action." };
    ({ error } = await supabase.rpc(rpc, { p_id: id }));
  }
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath(`/inventory/${kind}/${id}`);
  revalidatePath(`/inventory/${kind}`);
  revalidatePath("/inventory");
  revalidatePath("/purchase-orders");
  return { ok: true };
}

/** Current physical / reserved / available for products in one warehouse (shown while editing lines). */
export async function getAvailability(warehouseId: string, productIds: string[]) {
  if (!uuid.safeParse(warehouseId).success || productIds.length === 0) return {};
  const supabase = await createClient();
  const { data } = await supabase.from("v_inventory_position")
    .select("product_id, physical_qty, reserved_qty, available_qty")
    .eq("warehouse_id", warehouseId).in("product_id", productIds.filter((p) => uuid.safeParse(p).success));
  return Object.fromEntries((data ?? []).map((r) => [r.product_id, { physical: Number(r.physical_qty), reserved: Number(r.reserved_qty), available: Number(r.available_qty) }]));
}

/** Open direct-procurement order lines for a product, for back-to-back receipts. */
export async function openProcureLines(productId: string) {
  if (!uuid.safeParse(productId).success) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("sales_order_lines")
    .select("id, qty, qty_received, line_no, sales_order:sales_orders!inner(doc_no, status, customer:customers(name))")
    .eq("product_id", productId).eq("fulfilment_mode", "procure").eq("is_cancelled", false)
    .in("sales_order.status", ["confirmed", "partially_fulfilled", "on_hold"]);
  return (data ?? [])
    .filter((l: any) => Number(l.qty_received) < Number(l.qty))
    .map((l: any) => ({
      id: l.id as string,
      label: `${l.sales_order.doc_no} · line ${l.line_no} · ${l.sales_order.customer?.name ?? ""} · awaiting ${Number(l.qty) - Number(l.qty_received)}`,
    }));
}

export async function releaseReservation(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const parsed = z.object({
    reservation_id: uuid, qty: z.coerce.number().positive("Enter a quantity."), reason: z.string().trim().min(3, "Give a reason."),
  }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("release_stock_reservation", {
    p_reservation_id: parsed.data.reservation_id, p_qty: parsed.data.qty, p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/inventory/reservations");
  revalidatePath("/inventory");
  return { ok: true, message: "Reservation released." };
}
