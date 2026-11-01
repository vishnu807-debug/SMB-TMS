import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { DeliveryActions } from "@/components/logistics/delivery-actions";
import { formatDate, formatDateTime, formatQty } from "@/lib/utils";

export const metadata: Metadata = { title: "Delivery note" };

export default async function DeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("delivery.view");
  const supabase = await createClient();
  const [{ data: d }, { data: lines }] = await Promise.all([
    supabase.from("delivery_notes").select(`*, so:sales_orders(id, doc_no, customer_po_ref), customer:customers(id, name), warehouse:warehouses(code, name),
      shipment:shipments(id, doc_no, vehicle_no, driver_name, carrier_name, tracking_no, status),
      dispatcher:profiles!delivery_notes_dispatched_by_fkey(full_name), recorder:profiles!delivery_notes_pod_recorded_by_fkey(full_name)`).eq("id", id).maybeSingle(),
    supabase.from("delivery_note_lines").select("*, product:products(id, sku, uom:units_of_measure(code)), sol:sales_order_lines(line_no, qty, qty_delivered)").eq("delivery_note_id", id).order("line_no"),
  ]);
  if (!d) notFound();
  let podUrl: string | null = null;
  if (d.pod_path) podUrl = (await supabase.storage.from("delivery-pod").createSignedUrl(d.pod_path, 300)).data?.signedUrl ?? null;
  const manage = can(user, "delivery.manage");

  const facts: [string, React.ReactNode][] = [
    ["Customer", <Link key="c" href={`/customers/${d.customer?.id}`} className="text-navy-800 hover:underline">{d.customer?.name}</Link>],
    ["Sales order", <Link key="s" href={`/sales-orders/${d.so?.id}`} className="font-mono text-navy-800 hover:underline">{d.so?.doc_no}</Link>],
    ["Customer PO", d.so?.customer_po_ref ?? "—"],
    ["From", `${d.warehouse?.name} (${d.warehouse?.code})`],
    ["Delivery date", formatDate(d.delivery_date)],
    ["Deliver to", d.delivery_address ?? "—"],
    ["Site contact", [d.contact_name, d.contact_phone].filter(Boolean).join(" · ") || "—"],
    ["Shipment", d.shipment ? <Link key="sh" href={`/logistics/shipments/${d.shipment.id}`} className="font-mono text-navy-800 hover:underline">{d.shipment.doc_no}</Link> : "—"],
    ["Dispatched", d.dispatched_at ? `${formatDateTime(d.dispatched_at)} · ${d.dispatcher?.full_name ?? ""}` : "—"],
  ];

  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3"><span className="font-mono">{d.doc_no}</span> <StatusBadge status={d.status} /></span>}
        description={d.customer?.name} back={{ href: "/logistics?tab=deliveries", label: "Delivery notes" }}
        actions={<DeliveryActions id={id} canEdit={manage && d.status === "draft"} canDispatch={manage && d.status === "draft"} canConfirm={manage && d.status === "dispatched"} />} />
      {d.status === "cancelled" && <Alert tone="info" className="mb-6">Cancelled: {d.cancel_reason}</Alert>}
      {d.status === "draft" && <Alert tone="info" className="mb-6">Draft — the stock is still reserved in the warehouse. Dispatch when the goods leave.</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Items</CardTitle></CardHeader>
          <Table>
            <THead><TR><TH>#</TH><TH>Item</TH><TH numeric>This delivery</TH><TH numeric>Order total delivered</TH><TH>Notes</TH></TR></THead>
            <TBody>
              {(lines ?? []).map((l: any) => (
                <TR key={l.id}>
                  <TD className="text-slate-400">{l.line_no}</TD>
                  <TD><span className="font-mono text-xs text-slate-500">{l.product?.sku}</span> {l.description}</TD>
                  <TD numeric className="font-medium">{formatQty(l.qty)} <span className="text-xs text-slate-400">{l.product?.uom?.code}</span></TD>
                  <TD numeric>{formatQty(l.sol?.qty_delivered)} / {formatQty(l.sol?.qty)}</TD>
                  <TD className="text-slate-500">{l.notes ?? ""}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                {facts.map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="shrink-0 text-slate-500">{k}</dt><dd className="text-right">{v}</dd></div>)}
              </dl>
              {d.notes && <p className="mt-4 whitespace-pre-line rounded-md bg-slate-50 p-3 text-sm text-slate-700">{d.notes}</p>}
            </CardContent>
          </Card>
          {d.status === "delivered" && (
            <Card>
              <CardHeader><CardTitle>Proof of delivery</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p><span className="text-slate-500">Received by</span> <span className="font-medium">{d.received_by_name}</span></p>
                <p><span className="text-slate-500">At</span> {formatDateTime(d.delivered_at)}</p>
                {d.pod_notes && <p className="whitespace-pre-line text-slate-700">{d.pod_notes}</p>}
                {podUrl && <a href={podUrl} target="_blank" rel="noreferrer" className="inline-block text-navy-700 underline">View signed note</a>}
                <p className="text-xs text-slate-500">Recorded by {d.recorder?.full_name ?? "—"}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
