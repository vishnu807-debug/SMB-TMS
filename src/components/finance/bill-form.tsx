"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { poLinesForBill, saveBill } from "@/app/(app)/payables/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { formatMoney, formatQty } from "@/lib/utils";

type Line = { key: string; purchase_order_line_id?: string; description: string; sku?: string; uom?: string; qty: string; unit_cost: string; po_cost?: number; billable?: number; tax_code_id: string };
type Tax = { id: string; code: string; rate: number };
export type BillFormProps = {
  suppliers: { id: string; name: string; currency_code: string; trn: string | null }[];
  openPos: { id: string; doc_no: string; supplier_id: string }[];
  taxCodes: Tax[]; currencies: { code: string }[]; baseCurrency: string;
  initial?: Record<string, any> & { lines?: Line[] };
};
const r2 = (n: number) => Math.round(n * 100) / 100;

export function BillForm({ suppliers, openPos, taxCodes, currencies, baseCurrency, initial }: BillFormProps) {
  const router = useRouter();
  const defTax = taxCodes.find((t) => t.code === "SR")?.id ?? "";
  const [h, setH] = useState<Record<string, any>>({ supplier_id: "", purchase_order_id: "", bill_date: "", currency_code: baseCurrency, ...initial });
  const [lines, setLines] = useState<Line[]>(initial?.lines ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: string, v: any) => setH((x) => ({ ...x, [k]: v }));
  const setLine = (k: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));

  // Picking a PO loads its received-but-unbilled lines.
  useEffect(() => {
    if (!h.purchase_order_id || (initial?.id && h.purchase_order_id === initial.purchase_order_id && lines.length)) return;
    poLinesForBill(h.purchase_order_id).then((r) => {
      if (!r) return;
      setH((x) => ({ ...x, currency_code: r.po.currency_code, exchange_rate: String(r.po.exchange_rate) }));
      setLines(r.lines.filter((l) => l.billable > 0).map((l) => ({ key: l.id, purchase_order_line_id: l.id, description: l.description, sku: l.sku, uom: l.uom,
        qty: String(l.billable), billable: l.billable, unit_cost: String(l.unit_cost), po_cost: l.unit_cost, tax_code_id: l.tax_code_id })));
    });
  }, [h.purchase_order_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => lines.reduce((t, l) => {
    const net = r2((Number(l.qty) || 0) * (Number(l.unit_cost) || 0));
    return { net: t.net + net, tax: t.tax + r2(net * Number(taxCodes.find((x) => x.id === l.tax_code_id)?.rate ?? 0) / 100) };
  }, { net: 0, tax: 0 }), [lines, taxCodes]);
  const supplierPos = openPos.filter((p) => p.supplier_id === h.supplier_id);

  const submit = () => start(async () => {
    setError(null);
    const r = await saveBill({ ...h, exchange_rate: h.currency_code === baseCurrency ? "" : h.exchange_rate ?? "",
      lines: lines.map((l) => ({ purchase_order_line_id: l.purchase_order_line_id, description: l.description, qty: l.qty || 0, unit_cost: l.unit_cost || 0, tax_code_id: l.tax_code_id })) });
    if (!r.ok) return setError(r.error);
    router.push(`/payables/bills/${r.data!.id}`);
    router.refresh();
  });

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Supplier invoice</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Supplier" required className="md:col-span-2">
            <Select value={h.supplier_id} onChange={(e) => { const s = suppliers.find((x) => x.id === e.target.value);
              setH((x) => ({ ...x, supplier_id: e.target.value, purchase_order_id: "", currency_code: s?.currency_code ?? x.currency_code, supplier_trn: s?.trn ?? "" })); setLines([]); }}>
              <option value="">Select supplier…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Purchase order" hint="Bills are matched to goods received on the PO">
            <Select value={h.purchase_order_id ?? ""} onChange={(e) => { set("purchase_order_id", e.target.value); if (!e.target.value) setLines([]); }} disabled={!h.supplier_id}>
              <option value="">No PO (services, utilities…)</option>{supplierPos.map((p) => <option key={p.id} value={p.id}>{p.doc_no}</option>)}
            </Select>
          </Field>
          <Field label="Supplier invoice no." required><Input value={h.supplier_invoice_no ?? ""} onChange={(e) => set("supplier_invoice_no", e.target.value)} maxLength={60} /></Field>
          <Field label="Invoice date" required><Input type="date" max={new Date().toISOString().slice(0, 10)} value={h.bill_date ?? ""} onChange={(e) => set("bill_date", e.target.value)} /></Field>
          <Field label="Due date" hint="Blank = from supplier terms"><Input type="date" value={h.due_date ?? ""} onChange={(e) => set("due_date", e.target.value)} /></Field>
          <Field label="Supplier TRN"><Input value={h.supplier_trn ?? ""} onChange={(e) => set("supplier_trn", e.target.value)} maxLength={15} /></Field>
          <Field label="Currency">
            <Select value={h.currency_code} onChange={(e) => set("currency_code", e.target.value)} disabled={!!h.purchase_order_id}>{currencies.map((c) => <option key={c.code}>{c.code}</option>)}</Select>
          </Field>
          {h.currency_code !== baseCurrency && <Field label={`Rate (1 ${h.currency_code} = ? ${baseCurrency})`}><Input type="number" step="0.000001" min="0" value={h.exchange_rate ?? ""} onChange={(e) => set("exchange_rate", e.target.value)} /></Field>}
          <Field label="Notes" className="md:col-span-3"><Textarea rows={2} value={h.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={2000} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Lines</CardTitle>
          {!h.purchase_order_id && <Button size="sm" variant="outline" onClick={() => setLines([...lines, { key: crypto.randomUUID(), description: "", qty: "1", unit_cost: "", tax_code_id: defTax }])}><Plus /> Add line</Button>}</CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2 text-left">Description</th><th className="w-32 px-3 py-2 text-right">Qty</th><th className="w-32 px-3 py-2 text-right">Unit cost</th>
                <th className="w-24 px-3 py-2 text-right">vs PO</th><th className="w-28 px-3 py-2 text-left">VAT</th><th className="w-32 px-3 py-2 text-right">Net</th><th className="w-10" /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-500">{h.purchase_order_id ? "Nothing received on this PO is waiting to be billed." : "Add the lines from the supplier's invoice."}</td></tr>}
              {lines.map((l) => {
                const v = l.po_cost ? ((Number(l.unit_cost) - l.po_cost) / l.po_cost) * 100 : null;
                return (
                  <tr key={l.key} className="align-top">
                    <td className="px-3 py-2">{l.purchase_order_line_id ? <p className="pt-2"><span className="font-mono text-xs text-slate-500">{l.sku}</span> {l.description}</p>
                      : <Input value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} maxLength={1000} />}</td>
                    <td className="px-3 py-2"><Input type="number" min="0" step="0.001" className="text-right" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                      {l.billable != null && <p className="mt-1 text-right text-xs text-slate-500">{formatQty(l.billable)} {l.uom} received</p>}</td>
                    <td className="px-3 py-2"><Input type="number" min="0" step="0.0001" className="text-right" value={l.unit_cost} onChange={(e) => setLine(l.key, { unit_cost: e.target.value })} />
                      {l.po_cost != null && <p className="mt-1 text-right text-xs text-slate-500">PO {formatMoney(l.po_cost)}</p>}</td>
                    <td className={`px-3 py-2 pt-4 text-right tabular-nums ${v != null && Math.abs(v) > 2 ? "font-medium text-red-700" : "text-slate-500"}`}>{v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`}</td>
                    <td className="px-3 py-2"><Select value={l.tax_code_id} onChange={(e) => setLine(l.key, { tax_code_id: e.target.value })}>{taxCodes.map((t) => <option key={t.id} value={t.id}>{t.code} {Number(t.rate)}%</option>)}</Select></td>
                    <td className="px-3 py-2 pt-4 text-right tabular-nums">{formatMoney(r2((Number(l.qty) || 0) * (Number(l.unit_cost) || 0)))}</td>
                    <td className="px-1 py-2"><Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 /></Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-start justify-between gap-4 border-t border-slate-100 px-5 py-4">
          <p className="max-w-md text-xs text-slate-500">Quantities cannot exceed goods received. Prices more than 2% above the PO, and bills without a PO, go to a manager for approval.</p>
          <dl className="w-64 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Net</dt><dd className="tabular-nums">{formatMoney(totals.net, h.currency_code)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">VAT</dt><dd className="tabular-nums">{formatMoney(totals.tax, h.currency_code)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(totals.net + totals.tax, h.currency_code)}</dd></div>
          </dl>
        </div>
      </Card>
      <div className="flex justify-end gap-2">
        <Link href={initial?.id ? `/payables/bills/${initial.id}` : "/payables"} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Save draft</Button>
      </div>
    </div>
  );
}
