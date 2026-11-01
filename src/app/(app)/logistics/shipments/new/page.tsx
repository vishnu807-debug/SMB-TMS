import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { ShipmentForm } from "@/components/logistics/shipment-form";

export const metadata: Metadata = { title: "Plan shipment" };

export default async function NewShipmentPage() {
  await requirePermission("shipment.manage");
  const supabase = await createClient();
  const { data } = await supabase.from("delivery_notes").select("id, doc_no, delivery_date, delivery_address, customer:customers(name)").eq("status", "draft").is("shipment_id", null).order("delivery_date");
  const drafts = (data ?? []).map((d: any) => ({ id: d.id, doc_no: d.doc_no, customer: d.customer?.name ?? "", delivery_date: d.delivery_date, address: d.delivery_address }));
  return (
    <>
      <PageHeader title="Plan shipment" back={{ href: "/logistics?tab=shipments", label: "Shipments" }} description="One vehicle or courier trip carrying one or more delivery notes. Dispatching the shipment dispatches all its notes." />
      <ShipmentForm drafts={drafts} />
    </>
  );
}
