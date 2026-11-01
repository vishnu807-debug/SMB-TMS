import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DeliverableLine, DeliveryFormProps } from "@/components/logistics/delivery-form";

/** Everything the delivery note form needs for one sales order. */
export async function loadDeliveryForm(orderId: string, editingId?: string): Promise<Omit<DeliveryFormProps, "initial"> | { error: string }> {
  const supabase = await createClient();
  const { data: so } = await supabase.from("sales_orders").select("id, doc_no, status, customer_id, shipping_address_id, customer:customers(name)").eq("id", orderId).maybeSingle();
  if (!so) return { error: "Sales order not found." };
  if (!["confirmed", "partially_fulfilled"].includes(so.status)) return { error: `${so.doc_no} is ${so.status.replace(/_/g, " ")} — only confirmed orders can be delivered.` };
  const [{ data: lines }, { data: res }, { data: drafts }, { data: wh }, { data: addr }, { data: shp }] = await Promise.all([
    supabase.from("sales_order_lines").select("id, line_no, description, qty, qty_delivered, is_cancelled, product:products(sku, item_type, uom:units_of_measure(code))").eq("sales_order_id", orderId).order("line_no"),
    supabase.from("stock_reservations").select("sales_order_line_id, warehouse_id, qty").eq("status", "active"),
    supabase.from("delivery_note_lines").select("sales_order_line_id, qty, note:delivery_notes!inner(id, status, sales_order_id)").eq("note.status", "draft").eq("note.sales_order_id", orderId),
    supabase.from("warehouses").select("id, code, name").eq("is_active", true).order("code"),
    supabase.from("customer_addresses").select("id, kind, label, line1, city, emirate, is_default").eq("customer_id", so.customer_id).order("is_default", { ascending: false }),
    supabase.from("shipments").select("id, doc_no, shipment_date, vehicle_no, carrier_name, driver_name").eq("status", "planned").order("shipment_date"),
  ]);
  const pending: Record<string, number> = {};
  (drafts ?? []).forEach((d: any) => { if (d.note?.id !== editingId) pending[d.sales_order_line_id] = (pending[d.sales_order_line_id] ?? 0) + Number(d.qty); });
  const ids = new Set((lines ?? []).map((l) => l.id));
  const resBy: Record<string, Record<string, number>> = {};
  (res ?? []).filter((r) => ids.has(r.sales_order_line_id)).forEach((r) => {
    resBy[r.sales_order_line_id] = { ...(resBy[r.sales_order_line_id] ?? {}), [r.warehouse_id]: Number(r.qty) };
  });
  const out: DeliverableLine[] = (lines ?? []).filter((l: any) => !l.is_cancelled).map((l: any) => ({
    sales_order_line_id: l.id, line_no: l.line_no, sku: l.product?.sku ?? "", description: l.description, uom_code: l.product?.uom?.code ?? "",
    item_type: l.product?.item_type ?? "stock", qty: Number(l.qty), qty_delivered: Number(l.qty_delivered),
    open: Math.max(Number(l.qty) - Number(l.qty_delivered) - (pending[l.id] ?? 0), 0), reservedByWarehouse: resBy[l.id] ?? {},
  })).filter((l) => l.open > 0 || editingId);
  // Shipping addresses first (the order's own address on top).
  const addresses = (addr ?? []).sort((a: any, b: any) => (a.id === so.shipping_address_id ? -1 : b.id === so.shipping_address_id ? 1 : a.kind === "shipping" ? -1 : 1))
    .map((a: any) => ({ id: a.id, label: [a.label, a.line1, a.city, a.emirate].filter(Boolean).join(", ") }));
  return {
    order: { id: so.id, doc_no: so.doc_no, customer: (so.customer as any)?.name ?? "" },
    lines: out, warehouses: wh ?? [], addresses,
    shipments: (shp ?? []).map((s) => ({ id: s.id, label: `${s.doc_no} · ${s.shipment_date}${s.vehicle_no ? ` · ${s.vehicle_no}` : ""}${s.carrier_name ? ` · ${s.carrier_name}` : ""}${s.driver_name ? ` · ${s.driver_name}` : ""}` })),
  };
}
