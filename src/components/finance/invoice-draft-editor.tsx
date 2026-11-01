"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { saveInvoiceDraft } from "@/app/(app)/invoices/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { formatMoney, formatQty } from "@/lib/utils";

export type DraftLine = {
  id?: string; key: string; fromDelivery: boolean; description: string; uom_code: string; qty: string; max?: number;
  unit_price: string; discount_pct: number; tax_code_id: string;
};
type Tax = { id: string; code: string; rate: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function InvoiceDraftEditor({ invoice, lines: initialLines, taxCodes, paymentTerms, isNew, customers, currencies, baseCurrency }: {
  invoice: Record<string, any>; lines: DraftLine[]; taxCodes: Tax[]; paymentTerms: { id: string; name: string }[];
  isNew?: boolean; customers?: { id: string; name: string; currency_code: string }[]; currencies?: { code: string }[]; baseCurrency: string;
}) {
  const router = useRouter();
  const defTax = taxCodes.find((t) => t.code === "SR")?.id ?? taxCodes[0]?.id ?? "";
  const [h, setH] = useState<Record<string, any>>(invoice);
  const [lines, setLines] = useState<DraftLine[]>(initialLines);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: string, v: any) => setH((x) => ({ ...x, [k]: v }));
  const setLine = (k: string, p: Partial<DraftLine>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const addExtra = () => setLines([...lines, { key: crypto.randomUUID(), fromDelivery: false, description: "", uom_code: "", qty: "1", unit_price: "", discount_pct: 0, tax_code_id: defTax }]);

  const totals = useMemo(() => lines.reduce((t, l) => {
    const gross = r2((Number(l.qty) || 0) * (Number(l.unit_price) || 0));
    const net = r2(gross - r2(gross * l.discount_pct / 100));
    const tax = r2(net * Number(taxCodes.find((x) => x.id === l.tax_code_id)?.rate ?? 0) / 100);
    return { net: t.net + net, tax: t.tax + tax };
  }, { net: 0, tax: 0 }), [lines, taxCodes]);

  const save = () => start(async () => {
    setError(null);
    const r = await saveInvoiceDraft({
      id: isNew ? undefined : h.id, customer_id: isNew ? h.customer_id : undefined, currency_code: isNew ? h.currency_code : undefined,
      exchange_rate: isNew && h.currency_code !== baseCurrency ? h.exchange_rate : undefined,
      invoice_date: h.invoice_date, supply_date: h.supply_date, due_date: h.due_date, payment_term_id: h.payment_term_id,
      customer_reference: h.customer_reference, billing_address: h.billing_address, notes: h.notes, terms: h.terms,
      lines: lines.map((l) => ({ id: l.id, description: l.description, uom_code: l.uom_code, qty: l.qty || 0, unit_price: l.fromDelivery ? undefined : l.unit_price, tax_code_id: l.tax_code_id })),
    });
    if (!r.ok) return setError(r.error);
    if (isNew) router.push(`/invoices/${r.data!.id}`);
    router.refresh();
  });

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Invoice details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {isNew && (
            <>
              <Field label="Customer" required className="md:col-span-2">
                <Select value={h.customer_id ?? ""} onChange={(e) => { const c = customers?.find((x) => x.id === e.target.value); setH((x) => ({ ...x, customer_id: e.target.value, currency_code: c?.currency_code ?? x.currency_code })); }}>
                  <option value="">Select customer…</option>
                  {customers?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Currency">
                <Select value={h.currency_code} onChange={(e) => set("currency_code", e.target.value)}>
                  {currencies?.map((c) => <option key={c.code}>{c.code}</option>)}
                </Select>
              </Field>
              {h.currency_code !== baseCurrency && (
                <Field label={`Rate (1 ${h.currency_code} = ? ${baseCurrency})`} hint="Blank = latest rate">
                  <Input type="number" step="0.000001" min="0" value={h.exchange_rate ?? ""} onChange={(e) => set("exchange_rate", e.target.value)} />
                </Field>
              )}
            </>
          )}
          <Field label="Invoice date" required><Input type="date" max={new Date().toISOString().slice(0, 10)} value={h.invoice_date ?? ""} onChange={(e) => set("invoice_date", e.target.value)} /></Field>
          <Field label="Date of supply" hint="Defaults to the last delivery date"><Input type="date" value={h.supply_date ?? ""} onChange={(e) => set("supply_date", e.target.value)} /></Field>
          <Field label="Payment terms">
            <Select value={h.payment_term_id ?? ""} onChange={(e) => set("payment_term_id", e.target.value)}>
              <option value="">—</option>{paymentTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Due date" hint="Blank = from payment terms"><Input type="date" min={h.invoice_date} value={h.due_date ?? ""} onChange={(e) => set("due_date", e.target.value)} /></Field>
          <Field label="Customer PO / reference"><Input value={h.customer_reference ?? ""} onChange={(e) => set("customer_reference", e.target.value)} maxLength={120} /></Field>
          <Field label="Billing address" className="md:col-span-3"><Input value={h.billing_address ?? ""} onChange={(e) => set("billing_address", e.target.value)} maxLength={500} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Lines</CardTitle><Button size="sm" variant="outline" onClick={addExtra}><Plus /> Extra charge</Button></CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2 text-left">Description</th><th className="w-32 px-3 py-2 text-right">Qty</th><th className="w-32 px-3 py-2 text-right">Unit price</th>
                <th className="w-20 px-3 py-2 text-right">Disc.</th><th className="w-28 px-3 py-2 text-left">VAT</th><th className="w-32 px-3 py-2 text-right">Net</th><th className="w-10" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">No lines.</td></tr>}
              {lines.map((l) => {
                const gross = r2((Number(l.qty) || 0) * (Number(l.unit_price) || 0));
                return (
                  <tr key={l.key} className="align-top">
                    <td className="px-3 py-2">{l.fromDelivery ? <p className="pt-2">{l.description}</p>
                      : <Input value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} placeholder="e.g. Delivery charges" maxLength={1000} />}</td>
                    <td className="px-3 py-2"><Input type="number" min="0" step="0.001" max={l.max} className="text-right" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                      {l.max != null && <p className="mt-1 text-right text-xs text-slate-500">max {formatQty(l.max)} {l.uom_code}</p>}</td>
                    <td className="px-3 py-2">{l.fromDelivery ? <p className="pt-2 text-right tabular-nums">{formatMoney(l.unit_price)}</p>
                      : <Input type="number" min="0" step="0.01" className="text-right" value={l.unit_price} onChange={(e) => setLine(l.key, { unit_price: e.target.value })} />}</td>
                    <td className="px-3 py-2 pt-4 text-right">{l.discount_pct ? `${l.discount_pct}%` : "—"}</td>
                    <td className="px-3 py-2">{l.fromDelivery ? <p className="pt-2">{taxCodes.find((t) => t.id === l.tax_code_id)?.code}</p>
                      : <Select value={l.tax_code_id} onChange={(e) => setLine(l.key, { tax_code_id: e.target.value })}>{taxCodes.map((t) => <option key={t.id} value={t.id}>{t.code} {Number(t.rate)}%</option>)}</Select>}</td>
                    <td className="px-3 py-2 pt-4 text-right tabular-nums">{formatMoney(r2(gross - r2(gross * l.discount_pct / 100)))}</td>
                    <td className="px-1 py-2"><Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 /></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-start justify-between gap-4 border-t border-slate-100 px-5 py-4">
          <p className="max-w-md text-xs text-slate-500">Delivered items keep the prices on the sales order. Reduce a quantity to invoice part of a delivery; remove a line to leave it for a later invoice.</p>
          <dl className="w-64 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Net</dt><dd className="tabular-nums">{formatMoney(totals.net, h.currency_code)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">VAT</dt><dd className="tabular-nums">{formatMoney(totals.tax, h.currency_code)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(totals.net + totals.tax, h.currency_code)}</dd></div>
          </dl>
        </div>
      </Card>
      <Card>
        <CardHeader><CardTitle>Notes & terms (printed)</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Notes"><Textarea rows={3} value={h.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={2000} /></Field>
          <Field label="Terms"><Textarea rows={3} value={h.terms ?? ""} onChange={(e) => set("terms", e.target.value)} maxLength={8000} /></Field>
        </CardContent>
      </Card>
      <div className="flex justify-end"><Button onClick={save} disabled={busy}>{busy && <Loader2 className="animate-spin" />} {isNew ? "Create draft" : "Save draft"}</Button></div>
    </div>
  );
}
