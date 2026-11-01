"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { saveDeliveryNote } from "@/app/(app)/logistics/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { formatQty } from "@/lib/utils";

export type DeliverableLine = {
  sales_order_line_id: string; line_no: number; sku: string; description: string; uom_code: string; item_type: string;
  qty: number; qty_delivered: number; open: number; reservedByWarehouse: Record<string, number>;
};
export type DeliveryFormProps = {
  order: { id: string; doc_no: string; customer: string };
  lines: DeliverableLine[];
  warehouses: { id: string; code: string; name: string }[];
  addresses: { id: string; label: string }[];
  shipments: { id: string; label: string }[];
  initial?: Record<string, any> & { qty?: Record<string, string> };
};

export function DeliveryForm({ order, lines, warehouses, addresses, shipments, initial }: DeliveryFormProps) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  // Default to the warehouse holding most of this order's reserved stock.
  const bestWh = useMemo(() => {
    const totals: Record<string, number> = {};
    lines.forEach((l) => Object.entries(l.reservedByWarehouse).forEach(([w, q]) => (totals[w] = (totals[w] ?? 0) + q)));
    return Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] ?? warehouses[0]?.id ?? "";
  }, [lines, warehouses]);
  const [h, setH] = useState<Record<string, any>>({ warehouse_id: bestWh, delivery_date: today, delivery_address_id: addresses[0]?.id ?? "", ...initial });
  const ready = (l: DeliverableLine, wh: string) => Math.min(l.open, l.item_type === "stock" ? l.reservedByWarehouse[wh] ?? 0 : l.open);
  const [qty, setQty] = useState<Record<string, string>>(() => initial?.qty ?? Object.fromEntries(lines.map((l) => [l.sales_order_line_id, String(ready(l, bestWh) || "")])));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: string, v: any) => setH((x) => ({ ...x, [k]: v }));

  const changeWarehouse = (wh: string) => {
    set("warehouse_id", wh);
    if (!initial?.id) setQty(Object.fromEntries(lines.map((l) => [l.sales_order_line_id, String(ready(l, wh) || "")])));
  };
  const submit = () => start(async () => {
    setError(null);
    const r = await saveDeliveryNote({ ...h, id: initial?.id, sales_order_id: order.id, qty: undefined, doc_no: undefined, status: undefined,
      lines: lines.map((l) => ({ sales_order_line_id: l.sales_order_line_id, qty: qty[l.sales_order_line_id] || 0 })).filter((l) => Number(l.qty) > 0) });
    if (!r.ok) return setError(r.error);
    router.push(`/logistics/deliveries/${r.data!.id}`);
    router.refresh();
  });

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Delivery for <Link href={`/sales-orders/${order.id}`} className="font-mono text-navy-800 hover:underline">{order.doc_no}</Link> · {order.customer}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="From warehouse" htmlFor="warehouse_id" required>
            <Select id="warehouse_id" value={h.warehouse_id} onChange={(e) => changeWarehouse(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
            </Select>
          </Field>
          <Field label="Delivery date" htmlFor="delivery_date" required>
            <Input id="delivery_date" type="date" value={h.delivery_date} onChange={(e) => set("delivery_date", e.target.value)} />
          </Field>
          <Field label="Shipment / vehicle trip" htmlFor="shipment_id" hint="Optional — group several notes on one trip">
            <Select id="shipment_id" value={h.shipment_id ?? ""} onChange={(e) => set("shipment_id", e.target.value)}>
              <option value="">— None —</option>
              {shipments.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Delivery address" htmlFor="delivery_address_id" className="md:col-span-2">
            <Select id="delivery_address_id" value={h.delivery_address_id ?? ""} onChange={(e) => set("delivery_address_id", e.target.value)}>
              <option value="">Other (type below)</option>
              {addresses.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </Select>
          </Field>
          <Field label="Site contact" htmlFor="contact_name"><Input id="contact_name" value={h.contact_name ?? ""} onChange={(e) => set("contact_name", e.target.value)} maxLength={120} /></Field>
          {!h.delivery_address_id && (
            <Field label="Address / site location" htmlFor="delivery_address" className="md:col-span-2">
              <Input id="delivery_address" value={h.delivery_address ?? ""} onChange={(e) => set("delivery_address", e.target.value)} maxLength={500} placeholder="Project site, plot no., Google Maps link…" />
            </Field>
          )}
          <Field label="Contact phone" htmlFor="contact_phone"><Input id="contact_phone" value={h.contact_phone ?? ""} onChange={(e) => set("contact_phone", e.target.value)} maxLength={40} /></Field>
          <Field label="Notes for the driver" htmlFor="notes" className="md:col-span-3"><Textarea id="notes" rows={2} value={h.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={2000} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Items</CardTitle></CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-2 text-left">#</th><th className="px-4 py-2 text-left">Item</th><th className="px-4 py-2 text-right">Ordered</th>
                <th className="px-4 py-2 text-right">Delivered</th><th className="px-4 py-2 text-right">Reserved here</th><th className="w-36 px-4 py-2 text-right">Deliver now</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => {
                const max = ready(l, h.warehouse_id);
                return (
                  <tr key={l.sales_order_line_id}>
                    <td className="px-4 py-2 text-slate-400">{l.line_no}</td>
                    <td className="px-4 py-2"><span className="font-mono text-xs text-slate-500">{l.sku}</span> {l.description}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.qty)} <span className="text-xs text-slate-400">{l.uom_code}</span></td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatQty(l.qty_delivered)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{l.item_type === "stock" ? formatQty(l.reservedByWarehouse[h.warehouse_id] ?? 0) : "n/a"}</td>
                    <td className="px-4 py-2">
                      <Input type="number" min="0" max={max} step="0.001" className="text-right" value={qty[l.sales_order_line_id] ?? ""}
                        onChange={(e) => setQty((q) => ({ ...q, [l.sales_order_line_id]: e.target.value }))} />
                      {max < l.open && <p className="mt-1 text-right text-xs text-amber-700">{formatQty(max)} ready of {formatQty(l.open)}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Only stock reserved for this order can be delivered. Stock leaves the warehouse when the note is dispatched.</p>
      </Card>
      <div className="flex justify-end gap-2">
        <Link href={initial?.id ? `/logistics/deliveries/${initial.id}` : "/logistics"} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Save draft</Button>
      </div>
    </div>
  );
}
