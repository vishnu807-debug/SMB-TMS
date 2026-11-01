"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { updateOrderDraft } from "@/app/(app)/sales-orders/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { formatQty } from "@/lib/utils";

type Line = { id: string; line_no: number; description: string; sku: string; qty: number; uom: string; item_type: string; fulfilment_mode: "stock" | "procure"; warehouse_id: string | null; available: number };

export function FulfilmentPlan({ order, lines, warehouses }: {
  order: { id: string; customer_po_ref: string | null; required_date: string | null; delivery_location: string | null; internal_notes: string | null };
  lines: Line[]; warehouses: { id: string; code: string; name: string }[];
}) {
  const router = useRouter();
  const [h, setH] = useState({ customer_po_ref: order.customer_po_ref ?? "", required_date: order.required_date ?? "", delivery_location: order.delivery_location ?? "", internal_notes: order.internal_notes ?? "" });
  const [plan, setPlan] = useState(lines.map((l) => ({ id: l.id, fulfilment_mode: l.fulfilment_mode, warehouse_id: l.warehouse_id ?? "" })));
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = () => start(async () => {
    const r = await updateOrderDraft({ id: order.id, ...h, lines: plan });
    setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
    if (r.ok) router.refresh();
  });
  return (
    <Card>
      <CardHeader><CardTitle>Draft order — check the fulfilment plan before confirming</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Customer PO number" htmlFor="po"><Input id="po" value={h.customer_po_ref} onChange={(e) => setH({ ...h, customer_po_ref: e.target.value })} /></Field>
          <Field label="Required by" htmlFor="rd"><Input id="rd" type="date" value={h.required_date} onChange={(e) => setH({ ...h, required_date: e.target.value })} /></Field>
          <Field label="Delivery location" htmlFor="dl"><Input id="dl" value={h.delivery_location} onChange={(e) => setH({ ...h, delivery_location: e.target.value })} /></Field>
        </div>
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500"><tr><th className="py-1">Line</th><th>Qty</th><th>Available now</th><th>Fulfil by</th><th>Warehouse</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map((l, i) => {
              const p = plan[i];
              return (
                <tr key={l.id}>
                  <td className="py-2 pr-2">{l.line_no}. {l.description} <span className="font-mono text-xs text-slate-500">{l.sku}</span></td>
                  <td className="tabular-nums">{formatQty(l.qty)} {l.uom}</td>
                  <td className={`tabular-nums ${l.available >= l.qty ? "text-emerald-700" : "text-amber-700"}`}>{l.item_type === "stock" ? formatQty(l.available) : "—"}</td>
                  <td className="pr-2">
                    <Select value={p.fulfilment_mode} disabled={l.item_type !== "stock"} className="h-8 w-36"
                      onChange={(e) => setPlan(plan.map((x, j) => j === i ? { ...x, fulfilment_mode: e.target.value as "stock" | "procure" } : x))}>
                      <option value="stock">From stock</option><option value="procure">Procure</option>
                    </Select>
                  </td>
                  <td>
                    {p.fulfilment_mode === "stock" ? (
                      <Select value={p.warehouse_id} className="h-8 w-44" onChange={(e) => setPlan(plan.map((x, j) => j === i ? { ...x, warehouse_id: e.target.value } : x))}>
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                      </Select>
                    ) : <span className="text-xs text-slate-500">Purchase requisition on confirmation</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-slate-500">On confirmation, available stock is reserved line by line. If a stock line is short, the shortfall is automatically split into a procurement line.</p>
        <div className="flex items-center justify-end gap-3">
          {msg && <Alert tone={msg.ok ? "success" : "error"}>{msg.text}</Alert>}
          <Button variant="outline" onClick={save} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Save plan</Button>
        </div>
      </CardContent>
    </Card>
  );
}
