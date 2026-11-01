"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";

const uuid = z.string().uuid();
const optUuid = z.union([z.literal(""), z.null(), z.string().uuid()]).transform((v) => v || undefined).optional();
const optDate = z.union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).transform((v) => v || undefined).optional();

const delivery = z.object({
  id: optUuid,
  sales_order_id: uuid,
  warehouse_id: z.string().uuid("Choose the warehouse the goods leave from"),
  shipment_id: optUuid,
  delivery_address_id: optUuid,
  delivery_address: z.string().trim().max(500).optional(),
  contact_name: z.string().trim().max(120).optional(),
  contact_phone: z.string().trim().max(40).optional(),
  delivery_date: optDate,
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(z.object({ sales_order_line_id: uuid, qty: z.coerce.number().min(0, "Quantities cannot be negative"), notes: z.string().trim().max(500).optional() }))
    .min(1, "Add at least one item."),
});

const revalidate = (id?: string) => {
  revalidatePath("/logistics");
  if (id) revalidatePath(`/logistics/deliveries/${id}`);
  revalidatePath("/sales-orders");
};

export async function saveDeliveryNote(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = delivery.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_delivery_note", { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  revalidate(data as string);
  return { ok: true, data: { id: data as string } };
}

export async function runDeliveryAction(id: string, action: "dispatch" | "cancel", reason?: string): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = action === "dispatch"
    ? await supabase.rpc("dispatch_delivery_note", { p_id: id })
    : await supabase.rpc("cancel_delivery_note", { p_id: id, p_reason: reason ?? "" });
  if (error) return { ok: false, error: userMessage(error) };
  revalidate(id);
  revalidatePath("/inventory");
  return { ok: true };
}

const pod = z.object({
  received_by_name: z.string().trim().min(1, "Enter the name of the person who received the goods").max(120),
  delivered_at: z.string().optional(),
  pod_notes: z.string().trim().max(1000).optional(),
  pod_path: z.string().max(300).optional(),
});

export async function confirmDelivery(id: string, payload: unknown): Promise<ActionResult> {
  const parsed = pod.safeParse(payload);
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const p = { ...parsed.data, delivered_at: parsed.data.delivered_at ? new Date(parsed.data.delivered_at).toISOString() : undefined };
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_delivery", { p_id: id, p });
  if (error) return { ok: false, error: userMessage(error) };
  revalidate(id);
  return { ok: true };
}

const shipment = z.object({
  id: optUuid,
  shipment_date: optDate,
  mode: z.enum(["own_vehicle", "courier", "freight_forwarder", "customer_collection"]),
  carrier_name: z.string().trim().max(120).optional(),
  vehicle_no: z.string().trim().max(30).optional(),
  driver_name: z.string().trim().max(120).optional(),
  driver_phone: z.string().trim().max(40).optional(),
  tracking_no: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
  delivery_note_ids: z.array(uuid).max(100).optional(),
});

export async function saveShipment(payload: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = shipment.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_shipment", { p: parsed.data });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/logistics");
  revalidatePath(`/logistics/shipments/${data}`);
  return { ok: true, data: { id: data as string } };
}

export async function runShipmentAction(id: string, action: "dispatch" | "cancel"): Promise<ActionResult> {
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc(action === "dispatch" ? "dispatch_shipment" : "cancel_shipment", { p_id: id });
  if (error) return { ok: false, error: userMessage(error) };
  revalidatePath("/logistics");
  revalidatePath(`/logistics/shipments/${id}`);
  revalidatePath("/sales-orders");
  return { ok: true };
}
