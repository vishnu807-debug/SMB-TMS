import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ShipmentForm } from "@/components/logistics/shipment-form";
import { ShipmentActions } from "@/components/logistics/shipment-actions";
import { formatDate, formatDateTime, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Shipment" };

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("delivery.view");
  const supabase = await createClient();
  const [{ data: s }, { data: notes }, { data: free }] = await Promise.all([
    supabase.from("shipments").select("*").eq("id", id).maybeSingle(),
    supabase.from("delivery_notes").select("id, doc_no, delivery_date, delivery_address, status, received_by_name, customer:customers(name)").eq("shipment_id", id).order("doc_no"),
    supabase.from("delivery_notes").select("id, doc_no, delivery_date, delivery_address, customer:customers(name)").eq("status", "draft").is("shipment_id", null).order("delivery_date"),
  ]);
  if (!s) notFound();
  const manage = can(user, "shipment.manage");
  const planned = s.status === "planned";
  const toDraft = (d: any) => ({ id: d.id, doc_no: d.doc_no, customer: d.customer?.name ?? "", delivery_date: d.delivery_date, address: d.delivery_address });
  const mine = (notes ?? []).filter((n) => n.status === "draft");

  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3"><span className="font-mono">{s.doc_no}</span> <StatusBadge status={s.status} /></span>}
        description={`${humanize(s.mode)} · ${formatDate(s.shipment_date)}${s.vehicle_no ? ` · ${s.vehicle_no}` : ""}${s.carrier_name ? ` · ${s.carrier_name}` : ""}${s.driver_name ? ` · ${s.driver_name}` : ""}`}
        back={{ href: "/logistics?tab=shipments", label: "Shipments" }}
        actions={<ShipmentActions id={id} canDispatch={manage && planned} />} />
      {s.departed_at && <p className="mb-4 text-sm text-slate-600">Left {formatDateTime(s.departed_at)}{s.completed_at && ` · completed ${formatDateTime(s.completed_at)}`}</p>}
      {manage && s.status !== "completed" && s.status !== "cancelled" ? (
        <ShipmentForm drafts={[...mine, ...(free ?? [])].map(toDraft)} editableNotes={planned}
          initial={{ id, shipment_date: s.shipment_date, mode: s.mode, carrier_name: s.carrier_name ?? "", vehicle_no: s.vehicle_no ?? "", driver_name: s.driver_name ?? "",
            driver_phone: s.driver_phone ?? "", tracking_no: s.tracking_no ?? "", notes: s.notes ?? "", delivery_note_ids: mine.map((n) => n.id) }} />
      ) : null}
      <Card className="mt-6">
        <CardHeader><CardTitle>Delivery notes</CardTitle></CardHeader>
        <Table>
          <THead><TR><TH>Delivery note</TH><TH>Customer</TH><TH>Address</TH><TH>Status</TH><TH>Received by</TH></TR></THead>
          <TBody>
            {(notes ?? []).length === 0 && <EmptyRow colSpan={5}>No delivery notes on this shipment.</EmptyRow>}
            {(notes ?? []).map((n: any) => (
              <TR key={n.id}><TD><Link href={`/logistics/deliveries/${n.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{n.doc_no}</Link></TD>
                <TD>{n.customer?.name}</TD><TD className="max-w-xs truncate">{n.delivery_address ?? "—"}</TD><TD><StatusBadge status={n.status} /></TD><TD>{n.received_by_name ?? "—"}</TD></TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
