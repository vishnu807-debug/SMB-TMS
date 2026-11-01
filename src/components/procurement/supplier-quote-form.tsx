"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { saveSupplierQuotation } from "@/app/(app)/procurement/actions";
import type { ProcurementLookups } from "@/lib/procurement/lookups";
import { ProductPicker, type PickedProduct } from "@/components/inventory/product-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { formatMoney } from "@/lib/utils";

export type QuoteLine = { key: string; product: PickedProduct | null; requisition_line_id?: string; qty: string; unit_price: string; lead_time_days: string; notes: string };
const blank = (): QuoteLine => ({ key: crypto.randomUUID(), product: null, qty: "", unit_price: "", lead_time_days: "", notes: "" });

export function SupplierQuoteForm({ lookups, requisition, initialLines }: {
  lookups: ProcurementLookups; requisition?: { id: string; doc_no: string }; initialLines?: QuoteLine[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [h, setH] = useState<Record<string, string>>({ supplier_id: "", quote_date: today, valid_until: "", currency_code: lookups.baseCurrency, exchange_rate: "", delivery_days: "", payment_term_id: "", supplier_reference: "", notes: "" });
  const [lines, setLines] = useState<QuoteLine[]>(initialLines?.length ? initialLines : [blank()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: string, v: string) => setH((x) => ({ ...x, [k]: v }));
  const setLine = (k: string, p: Partial<QuoteLine>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const pickSupplier = (id: string) => {
    const s = lookups.suppliers.find((x) => x.id === id);
    setH((x) => ({ ...x, supplier_id: id, currency_code: s?.currency_code ?? x.currency_code, payment_term_id: s?.payment_term_id ?? "" }));
  };

  const submit = () => start(async () => {
    setError(null);
    const priced = lines.filter((l) => l.product && l.unit_price !== "");
    const r = await saveSupplierQuotation({
      ...h, requisition_id: requisition?.id, exchange_rate: h.currency_code === lookups.baseCurrency ? "" : h.exchange_rate,
      lines: priced.map((l) => ({ product_id: l.product!.id, requisition_line_id: l.requisition_line_id, qty: l.qty, unit_price: l.unit_price, lead_time_days: l.lead_time_days, notes: l.notes })),
    });
    if (!r.ok) return setError(r.error);
    router.push(requisition ? `/procurement/requisitions/${requisition.id}` : `/procurement/quotes/${r.data!.id}`);
    router.refresh();
  });
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit_price) || 0), 0);

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Quotation from supplier{requisition && <span className="ml-2 font-normal text-slate-500">for {requisition.doc_no}</span>}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Supplier" htmlFor="supplier_id" required className="md:col-span-2">
            <Select id="supplier_id" value={h.supplier_id} onChange={(e) => pickSupplier(e.target.value)}>
              <option value="">Select supplier…</option>
              {lookups.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Supplier's reference" htmlFor="supplier_reference"><Input id="supplier_reference" value={h.supplier_reference} onChange={(e) => set("supplier_reference", e.target.value)} maxLength={80} /></Field>
          <Field label="Quote date" htmlFor="quote_date"><Input id="quote_date" type="date" max={today} value={h.quote_date} onChange={(e) => set("quote_date", e.target.value)} /></Field>
          <Field label="Valid until" htmlFor="valid_until"><Input id="valid_until" type="date" min={h.quote_date} value={h.valid_until} onChange={(e) => set("valid_until", e.target.value)} /></Field>
          <Field label="Delivery (days)" htmlFor="delivery_days"><Input id="delivery_days" type="number" min="0" value={h.delivery_days} onChange={(e) => set("delivery_days", e.target.value)} /></Field>
          <Field label="Currency" htmlFor="currency_code">
            <Select id="currency_code" value={h.currency_code} onChange={(e) => set("currency_code", e.target.value)}>
              {lookups.currencies.map((c) => <option key={c.code}>{c.code}</option>)}
            </Select>
          </Field>
          {h.currency_code !== lookups.baseCurrency && (
            <Field label={`Rate (1 ${h.currency_code} = ? ${lookups.baseCurrency})`} htmlFor="exchange_rate" hint="Blank = latest rate">
              <Input id="exchange_rate" type="number" step="0.000001" min="0" value={h.exchange_rate} onChange={(e) => set("exchange_rate", e.target.value)} />
            </Field>
          )}
          <Field label="Payment terms" htmlFor="payment_term_id">
            <Select id="payment_term_id" value={h.payment_term_id} onChange={(e) => set("payment_term_id", e.target.value)}>
              <option value="">—</option>
              {lookups.paymentTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Notes" htmlFor="notes" className="md:col-span-3"><Textarea id="notes" rows={2} value={h.notes} onChange={(e) => set("notes", e.target.value)} maxLength={2000} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Prices</CardTitle>
          {!requisition && <Button size="sm" variant="outline" onClick={() => setLines([...lines, blank()])}><Plus /> Add item</Button>}</CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="min-w-[260px] px-3 py-2 text-left">Item</th><th className="w-28 px-3 py-2 text-right">Qty</th>
                <th className="w-36 px-3 py-2 text-right">Unit price ({h.currency_code})</th><th className="w-28 px-3 py-2 text-right">Lead time (d)</th>
                <th className="px-3 py-2 text-left">Remarks</th><th className="w-10" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => (
                <tr key={l.key} className="align-top">
                  <td className="px-3 py-2"><ProductPicker value={l.product} stockOnly={false} disabled={!!l.requisition_line_id} onChange={(p) => setLine(l.key, { product: p })} /></td>
                  <td className="px-3 py-2"><Input type="number" min="0" step="0.001" className="text-right" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} /></td>
                  <td className="px-3 py-2"><Input type="number" min="0" step="0.0001" className="text-right" placeholder="Not quoted" value={l.unit_price} onChange={(e) => setLine(l.key, { unit_price: e.target.value })} /></td>
                  <td className="px-3 py-2"><Input type="number" min="0" className="text-right" value={l.lead_time_days} onChange={(e) => setLine(l.key, { lead_time_days: e.target.value })} /></td>
                  <td className="px-3 py-2"><Input value={l.notes} onChange={(e) => setLine(l.key, { notes: e.target.value })} maxLength={500} placeholder="Brand, alternative model…" /></td>
                  <td className="px-1 py-2"><Button variant="ghost" size="icon" aria-label="Remove" disabled={lines.length === 1} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="flex justify-between border-t border-slate-100 px-5 py-3 text-sm">
          <span className="text-xs text-slate-500">Leave the price empty for items the supplier did not quote.</span>
          <span className="font-semibold tabular-nums">Net {formatMoney(total, h.currency_code)}</span>
        </p>
      </Card>
      <div className="flex justify-end gap-2">
        <Link href={requisition ? `/procurement/requisitions/${requisition.id}` : "/procurement?tab=quotes"} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Save quotation</Button>
      </div>
    </div>
  );
}
