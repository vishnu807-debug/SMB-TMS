"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { saveShipment } from "@/app/(app)/logistics/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { formatDate } from "@/lib/utils";

export type DraftNote = { id: string; doc_no: string; customer: string; delivery_date: string; address: string | null };

export function ShipmentForm({ drafts, initial, editableNotes = true }: { drafts: DraftNote[]; initial?: Record<string, any> & { delivery_note_ids?: string[] }; editableNotes?: boolean }) {
  const router = useRouter();
  const [h, setH] = useState<Record<string, any>>({ mode: "own_vehicle", shipment_date: new Date().toISOString().slice(0, 10), ...initial });
  const [picked, setPicked] = useState<Set<string>>(new Set(initial?.delivery_note_ids ?? []));
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: string, v: string) => setH((x) => ({ ...x, [k]: v }));
  const text = (k: string, label: string, max = 120) => (
    <Field label={label} htmlFor={k}><Input id={k} value={h[k] ?? ""} onChange={(e) => set(k, e.target.value)} maxLength={max} /></Field>
  );
  const submit = () => start(async () => {
    setError(null);
    const payload: Record<string, any> = { ...h, doc_no: undefined, status: undefined };
    if (editableNotes) payload.delivery_note_ids = [...picked];
    const r = await saveShipment(payload);
    if (!r.ok) return setError(r.error);
    router.push(`/logistics/shipments/${r.data!.id}`);
    router.refresh();
  });
  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Trip</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Date" htmlFor="shipment_date" required><Input id="shipment_date" type="date" value={h.shipment_date} onChange={(e) => set("shipment_date", e.target.value)} /></Field>
          <Field label="Mode" htmlFor="mode" required>
            <Select id="mode" value={h.mode} onChange={(e) => set("mode", e.target.value)}>
              <option value="own_vehicle">Own vehicle</option><option value="courier">Courier</option>
              <option value="freight_forwarder">Freight forwarder</option><option value="customer_collection">Customer collection</option>
            </Select>
          </Field>
          {h.mode === "own_vehicle" ? text("vehicle_no", "Vehicle plate no.", 30) : text("carrier_name", "Carrier / company")}
          {text("driver_name", "Driver")}
          {text("driver_phone", "Driver phone", 40)}
          {h.mode !== "own_vehicle" && h.mode !== "customer_collection" && text("tracking_no", "Tracking / AWB no.", 80)}
          <Field label="Notes" htmlFor="notes" className="md:col-span-3"><Textarea id="notes" rows={2} value={h.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={2000} /></Field>
        </CardContent>
      </Card>
      {editableNotes && (
        <Card>
          <CardHeader><CardTitle>Delivery notes on this trip</CardTitle></CardHeader>
          <div className="divide-y divide-slate-100">
            {drafts.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-500">No draft delivery notes waiting. Create delivery notes first, then add them here.</p>}
            {drafts.map((d) => (
              <label key={d.id} className="flex cursor-pointer items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50">
                <input type="checkbox" className="size-4" checked={picked.has(d.id)}
                  onChange={() => setPicked((s) => { const n = new Set(s); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n; })} />
                <span className="font-mono text-xs font-semibold">{d.doc_no}</span><span>{d.customer}</span>
                <span className="truncate text-slate-500">{d.address ?? ""}</span><span className="ml-auto text-slate-500">{formatDate(d.delivery_date)}</span>
              </label>
            ))}
          </div>
        </Card>
      )}
      <div className="flex justify-end gap-2">
        <Link href={initial?.id ? `/logistics/shipments/${initial.id}` : "/logistics?tab=shipments"} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Save shipment</Button>
      </div>
    </div>
  );
}
