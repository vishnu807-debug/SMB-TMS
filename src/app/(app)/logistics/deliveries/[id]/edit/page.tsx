import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { DeliveryForm } from "@/components/logistics/delivery-form";
import { loadDeliveryForm } from "@/lib/logistics/loader";

export const metadata: Metadata = { title: "Edit delivery note" };

export default async function EditDeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("delivery.manage");
  const supabase = await createClient();
  const [{ data: d }, { data: lines }] = await Promise.all([
    supabase.from("delivery_notes").select("*").eq("id", id).maybeSingle(),
    supabase.from("delivery_note_lines").select("sales_order_line_id, qty").eq("delivery_note_id", id),
  ]);
  if (!d) notFound();
  if (d.status !== "draft") redirect(`/logistics/deliveries/${id}`);
  const data = await loadDeliveryForm(d.sales_order_id, id);
  const initial = {
    id, warehouse_id: d.warehouse_id, delivery_date: d.delivery_date, shipment_id: d.shipment_id ?? "", delivery_address_id: d.delivery_address_id ?? "",
    delivery_address: d.delivery_address_id ? "" : d.delivery_address ?? "", contact_name: d.contact_name ?? "", contact_phone: d.contact_phone ?? "", notes: d.notes ?? "",
    qty: Object.fromEntries((lines ?? []).map((l) => [l.sales_order_line_id, String(Number(l.qty))])),
  };
  return (
    <>
      <PageHeader title={`Edit ${d.doc_no}`} back={{ href: `/logistics/deliveries/${id}`, label: d.doc_no }} />
      {"error" in data ? <Alert tone="warning">{data.error}</Alert> : <DeliveryForm {...data} initial={initial} />}
    </>
  );
}
