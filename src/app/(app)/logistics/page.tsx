import Link from "next/link";
import type { Metadata } from "next";
import { Plus, Truck } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { cn, formatDate, formatQty, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Logistics" };
const TABS = [["ready", "Ready to deliver"], ["deliveries", "Delivery notes"], ["shipments", "Shipments"]] as const;

export default async function LogisticsPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  const user = await requirePermission("delivery.view");
  const sp = await searchParams;
  const tab = sp.tab ?? "ready";
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  let dq = supabase.from("delivery_notes").select("id, doc_no, delivery_date, status, received_by_name, customer:customers(name), so:sales_orders(id, doc_no), warehouse:warehouses(code), shipment:shipments(id, doc_no), lines:delivery_note_lines(qty)")
    .order("delivery_date", { ascending: false }).order("doc_no", { ascending: false }).limit(200);
  if (sp.status) dq = dq.eq("status", sp.status);
  const [{ data: ready }, { data: notes }, { data: shipments }, { data: counts }] = await Promise.all([
    supabase.from("v_deliverable_lines").select("*").order("required_date", { ascending: true, nullsFirst: false }),
    tab === "deliveries" ? dq : Promise.resolve({ data: [] as any[] }),
    tab === "shipments" ? supabase.from("shipments").select("id, doc_no, shipment_date, mode, vehicle_no, driver_name, carrier_name, status, notes:delivery_notes(id, status)").order("shipment_date", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("delivery_notes").select("status").in("status", ["draft", "dispatched"]),
  ]);

  // Group ready lines by order.
  const orders = new Map<string, { id: string; doc_no: string; customer: string; required: string | null; lines: number; ready: number; open: number; warehouses: Set<string> }>();
  (ready ?? []).forEach((r: any) => {
    const o = orders.get(r.sales_order_id) ?? { id: r.sales_order_id, doc_no: r.sales_order_no, customer: r.customer_name, required: r.required_date, lines: 0, ready: 0, open: 0, warehouses: new Set<string>() };
    o.lines += 1; o.ready += Number(r.qty_ready); o.open += Number(r.qty_open);
    if (r.warehouse_code && Number(r.qty_ready) > 0) o.warehouses.add(r.warehouse_code);
    orders.set(r.sales_order_id, o);
  });
  const orderList = [...orders.values()];
  const manage = can(user, "delivery.manage");

  return (
    <>
      <PageHeader title="Logistics" description="Deliveries to customers from reserved stock, vehicle trips and proof of delivery."
        actions={can(user, "shipment.manage") && <Link href="/logistics/shipments/new" className={buttonVariants({ variant: "outline" })}><Truck /> Plan shipment</Link>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Orders ready to deliver" value={orderList.filter((o) => o.ready > 0).length} />
        <StatCard label="Orders overdue" value={orderList.filter((o) => o.required && o.required < today).length} tone="danger" />
        <StatCard label="Draft delivery notes" value={(counts ?? []).filter((c) => c.status === "draft").length} />
        <StatCard label="Out for delivery" value={(counts ?? []).filter((c) => c.status === "dispatched").length} tone="warning" hint="Waiting for proof of delivery" />
      </div>
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/logistics?tab=${k}`} className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-medium",
            tab === k ? "border-navy-700 text-navy-800" : "border-transparent text-slate-500 hover:text-slate-800")}>{label}</Link>
        ))}
      </div>

      {tab === "ready" && (
        <Card>
          <Table>
            <THead><TR><TH>Sales order</TH><TH>Customer</TH><TH>Required by</TH><TH numeric>Open lines</TH><TH numeric>Qty ready / open</TH><TH>Stock at</TH><TH /></TR></THead>
            <TBody>
              {orderList.length === 0 && <EmptyRow colSpan={7}>No confirmed orders waiting for delivery.</EmptyRow>}
              {orderList.map((o) => (
                <TR key={o.id}>
                  <TD><Link href={`/sales-orders/${o.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{o.doc_no}</Link></TD>
                  <TD>{o.customer}</TD>
                  <TD className={o.required && o.required < today ? "font-medium text-red-700" : ""}>{formatDate(o.required)}</TD>
                  <TD numeric>{o.lines}</TD>
                  <TD numeric className={o.ready >= o.open ? "text-emerald-700" : o.ready > 0 ? "text-amber-700" : "text-slate-400"}>{formatQty(o.ready)} / {formatQty(o.open)}</TD>
                  <TD>{[...o.warehouses].join(", ") || "—"}</TD>
                  <TD className="text-right">{manage && o.ready > 0 && <Link href={`/logistics/deliveries/new?order=${o.id}`} className={buttonVariants({ size: "sm" })}><Plus /> Delivery note</Link>}
                    {o.ready === 0 && <span className="text-xs text-slate-500">Awaiting stock</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {tab === "deliveries" && (
        <Card>
          <form className="flex gap-3 border-b border-slate-200 p-4">
            <input type="hidden" name="tab" value="deliveries" />
            <Select name="status" defaultValue={sp.status ?? ""} className="w-44">
              <option value="">All statuses</option>{["draft", "dispatched", "delivered", "cancelled"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </Select>
            <button className={buttonVariants({ variant: "outline" })}>Filter</button>
          </form>
          <Table>
            <THead><TR><TH>Delivery note</TH><TH>Customer</TH><TH>Order</TH><TH>Date</TH><TH>From</TH><TH numeric>Qty</TH><TH>Shipment</TH><TH>Status</TH></TR></THead>
            <TBody>
              {(notes ?? []).length === 0 && <EmptyRow colSpan={8}>No delivery notes.</EmptyRow>}
              {(notes ?? []).map((d: any) => (
                <TR key={d.id}>
                  <TD><Link href={`/logistics/deliveries/${d.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{d.doc_no}</Link></TD>
                  <TD>{d.customer?.name}</TD>
                  <TD><Link href={`/sales-orders/${d.so?.id}`} className="font-mono text-xs hover:underline">{d.so?.doc_no}</Link></TD>
                  <TD>{formatDate(d.delivery_date)}</TD><TD>{d.warehouse?.code}</TD>
                  <TD numeric>{formatQty(d.lines.reduce((a: number, l: any) => a + Number(l.qty), 0))}</TD>
                  <TD>{d.shipment ? <Link href={`/logistics/shipments/${d.shipment.id}`} className="font-mono text-xs hover:underline">{d.shipment.doc_no}</Link> : "—"}</TD>
                  <TD><StatusBadge status={d.status} />{d.received_by_name && <p className="text-xs text-slate-500">{d.received_by_name}</p>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {tab === "shipments" && (
        <Card>
          <Table>
            <THead><TR><TH>Shipment</TH><TH>Date</TH><TH>Mode</TH><TH>Vehicle / carrier</TH><TH>Driver</TH><TH numeric>Delivery notes</TH><TH>Status</TH></TR></THead>
            <TBody>
              {(shipments ?? []).length === 0 && <EmptyRow colSpan={7}>No shipments.</EmptyRow>}
              {(shipments ?? []).map((s: any) => (
                <TR key={s.id}>
                  <TD><Link href={`/logistics/shipments/${s.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{s.doc_no}</Link></TD>
                  <TD>{formatDate(s.shipment_date)}</TD><TD>{humanize(s.mode)}</TD>
                  <TD>{s.vehicle_no ?? s.carrier_name ?? "—"}</TD><TD>{s.driver_name ?? "—"}</TD>
                  <TD numeric>{s.notes?.filter((n: any) => n.status !== "cancelled").length ?? 0}</TD>
                  <TD><StatusBadge status={s.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
