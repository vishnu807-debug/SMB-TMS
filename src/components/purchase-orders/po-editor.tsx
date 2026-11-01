"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { savePurchaseOrder, supplierCost } from "@/app/(app)/purchase-orders/actions";
import type { ProcurementLookups } from "@/lib/procurement/lookups";
import { ProductPicker, type PickedProduct } from "@/components/inventory/product-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { formatMoney, formatQty } from "@/lib/utils";

export type PoLine = {
  key: string; product: PickedProduct | null; description: string; qty: string; unit_cost: string; tax_code_id: string;
  requisition_line_id?: string; supplier_quotation_line_id?: string; source?: string; max_qty?: number;
};
export type PoInitial = { header: Record<string, any>; lines: PoLine[] };
export type SupplierContact = { id: string; supplier_id: string; name: string; is_primary: boolean };

const round2 = (n: number) => Math.round(n * 100) / 100;
export const newPoLine = (taxId = ""): PoLine => ({ key: crypto.randomUUID(), product: null, description: "", qty: "", unit_cost: "", tax_code_id: taxId });

export function PurchaseOrderEditor({ lookups, contacts, initial, defaultTerms }: {
  lookups: ProcurementLookups; contacts: SupplierContact[]; initial?: PoInitial; defaultTerms: string;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const defaultTax = lookups.taxCodes.find((t) => t.is_default)?.id ?? "";
  const [h, setH] = useState<Record<string, any>>(() => ({
    supplier_id: "", warehouse_id: lookups.warehouses[0]?.id ?? "", order_date: today, currency_code: lookups.baseCurrency,
    terms_conditions: defaultTerms, ...initial?.header,
  }));
  const [lines, setLines] = useState<PoLine[]>(initial?.lines?.length ? initial.lines : [newPoLine(defaultTax)]);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const set = (k: string, v: any) => setH((x) => ({ ...x, [k]: v }));
  const setLine = (key: string, patch: Partial<PoLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const supplierContacts = contacts.filter((c) => c.supplier_id === h.supplier_id);
  const pickSupplier = (id: string) => {
    const s = lookups.suppliers.find((x) => x.id === id);
    setH((x) => ({ ...x, supplier_id: id, supplier_contact_id: contacts.find((c) => c.supplier_id === id && c.is_primary)?.id ?? "",
      currency_code: s?.currency_code ?? x.currency_code, payment_term_id: s?.payment_term_id ?? x.payment_term_id ?? "", exchange_rate: "" }));
  };
  const pickProduct = async (l: PoLine, p: PickedProduct) => {
    setLine(l.key, { product: p, description: p.name });
    if (!h.supplier_id) return;
    const c = await supplierCost(h.supplier_id, p.id);
    if (!c) return;
    setLine(l.key, {
      description: c.description || p.name,
      tax_code_id: c.tax_code_id ?? l.tax_code_id ?? defaultTax,
      unit_cost: c.cost != null && (!c.currency || c.currency === h.currency_code) ? String(c.cost) : l.unit_cost,
    });
  };

  const totals = useMemo(() => lines.reduce((t, l) => {
    const net = round2((Number(l.qty) || 0) * (Number(l.unit_cost) || 0));
    const rate = Number(lookups.taxCodes.find((x) => x.id === l.tax_code_id)?.rate ?? 0);
    const tax = round2(net * rate / 100);
    return { net: t.net + net, tax: t.tax + tax };
  }, { net: 0, tax: 0 }), [lines, lookups.taxCodes]);

  const submit = () => {
    setError(null);
    const payload = {
      ...h, id: initial?.header.id || undefined,
      exchange_rate: h.currency_code === lookups.baseCurrency ? undefined : h.exchange_rate,
      lines: lines.filter((l) => l.product).map((l) => ({
        product_id: l.product!.id, description: l.description, qty: l.qty, unit_cost: l.unit_cost, tax_code_id: l.tax_code_id,
        requisition_line_id: l.requisition_line_id, supplier_quotation_line_id: l.supplier_quotation_line_id,
      })),
    };
    delete (payload as any).doc_no; delete (payload as any).status;
    if (payload.lines.length === 0) return setError("Add at least one item.");
    start(async () => {
      const res = await savePurchaseOrder(payload);
      if (!res.ok) return setError(res.error);
      router.push(`/purchase-orders/${res.data!.id}`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Supplier & delivery</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Supplier" htmlFor="supplier_id" required className="md:col-span-2">
            <Select id="supplier_id" value={h.supplier_id} onChange={(e) => pickSupplier(e.target.value)}>
              <option value="">Select supplier…</option>
              {lookups.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code}){s.status === "on_hold" ? " — on hold" : ""}</option>)}
            </Select>
          </Field>
          <Field label="Contact" htmlFor="supplier_contact_id">
            <Select id="supplier_contact_id" value={h.supplier_contact_id ?? ""} onChange={(e) => set("supplier_contact_id", e.target.value)} disabled={!h.supplier_id}>
              <option value="">—</option>
              {supplierContacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Deliver to warehouse" htmlFor="warehouse_id" required>
            <Select id="warehouse_id" value={h.warehouse_id} onChange={(e) => set("warehouse_id", e.target.value)}>
              {lookups.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
            </Select>
          </Field>
          <Field label="Order date" htmlFor="order_date" required>
            <Input id="order_date" type="date" value={h.order_date ?? today} onChange={(e) => set("order_date", e.target.value)} />
          </Field>
          <Field label="Expected delivery" htmlFor="expected_date">
            <Input id="expected_date" type="date" min={h.order_date} value={h.expected_date ?? ""} onChange={(e) => set("expected_date", e.target.value)} />
          </Field>
          <Field label="Currency" htmlFor="currency_code" required>
            <Select id="currency_code" value={h.currency_code} onChange={(e) => set("currency_code", e.target.value)}>
              {lookups.currencies.map((c) => <option key={c.code}>{c.code}</option>)}
            </Select>
          </Field>
          {h.currency_code !== lookups.baseCurrency && (
            <Field label={`Exchange rate (1 ${h.currency_code} = ? ${lookups.baseCurrency})`} htmlFor="exchange_rate" hint="Blank = latest rate in Settings">
              <Input id="exchange_rate" type="number" step="0.000001" min="0" value={h.exchange_rate ?? ""} onChange={(e) => set("exchange_rate", e.target.value)} />
            </Field>
          )}
          <Field label="Payment terms" htmlFor="payment_term_id">
            <Select id="payment_term_id" value={h.payment_term_id ?? ""} onChange={(e) => set("payment_term_id", e.target.value)}>
              <option value="">—</option>
              {lookups.paymentTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Delivery terms" htmlFor="delivery_term_id">
            <Select id="delivery_term_id" value={h.delivery_term_id ?? ""} onChange={(e) => set("delivery_term_id", e.target.value)}>
              <option value="">—</option>
              {lookups.deliveryTerms.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
            </Select>
          </Field>
          <Field label="Supplier quotation ref." htmlFor="supplier_reference">
            <Input id="supplier_reference" value={h.supplier_reference ?? ""} onChange={(e) => set("supplier_reference", e.target.value)} maxLength={80} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, newPoLine(defaultTax)])}><Plus /> Add item</Button>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2 text-left">#</th>
                <th className="min-w-[240px] px-3 py-2 text-left">Product</th>
                <th className="min-w-[220px] px-3 py-2 text-left">Description</th>
                <th className="w-28 px-3 py-2 text-right">Qty</th>
                <th className="w-32 px-3 py-2 text-right">Unit cost ({h.currency_code})</th>
                <th className="w-28 px-3 py-2 text-left">VAT</th>
                <th className="w-32 px-3 py-2 text-right">Amount</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => (
                <tr key={l.key} className="align-top">
                  <td className="px-3 py-2 pt-4 text-slate-400">{i + 1}</td>
                  <td className="px-3 py-2">
                    <ProductPicker value={l.product} stockOnly={false} disabled={!!l.requisition_line_id} onChange={(p) => pickProduct(l, p)} />
                    {l.source && <p className="mt-1 text-xs text-slate-500">{l.source}</p>}
                  </td>
                  <td className="px-3 py-2"><Input value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} maxLength={1000} /></td>
                  <td className="px-3 py-2">
                    <Input type="number" step="0.001" min="0" className="text-right" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                    {l.max_qty != null && <p className="mt-1 text-right text-xs text-slate-500">max {formatQty(l.max_qty)}</p>}
                  </td>
                  <td className="px-3 py-2"><Input type="number" step="0.0001" min="0" className="text-right" value={l.unit_cost} onChange={(e) => setLine(l.key, { unit_cost: e.target.value })} /></td>
                  <td className="px-3 py-2">
                    <Select value={l.tax_code_id} onChange={(e) => setLine(l.key, { tax_code_id: e.target.value })}>
                      {lookups.taxCodes.map((t) => <option key={t.id} value={t.id}>{t.code} {Number(t.rate)}%</option>)}
                    </Select>
                  </td>
                  <td className="px-3 py-2 pt-4 text-right tabular-nums">{formatMoney(round2((Number(l.qty) || 0) * (Number(l.unit_cost) || 0)))}</td>
                  <td className="px-1 py-2">
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove item" disabled={lines.length === 1}
                      onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end border-t border-slate-100 px-5 py-4">
          <dl className="w-64 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Net</dt><dd className="tabular-nums">{formatMoney(totals.net, h.currency_code)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">VAT</dt><dd className="tabular-nums">{formatMoney(totals.tax, h.currency_code)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(totals.net + totals.tax, h.currency_code)}</dd></div>
          </dl>
        </div>
      </Card>

      <Card>
        <CardHeader><CardTitle>Terms & notes</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Terms & conditions (printed on the PO)" htmlFor="terms_conditions">
            <Textarea id="terms_conditions" rows={5} value={h.terms_conditions ?? ""} onChange={(e) => set("terms_conditions", e.target.value)} maxLength={8000} />
          </Field>
          <Field label="Internal notes" htmlFor="notes">
            <Textarea id="notes" rows={5} value={h.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={4000} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Link href={initial?.header.id ? `/purchase-orders/${initial.header.id}` : "/purchase-orders"} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Save draft</Button>
      </div>
    </div>
  );
}
