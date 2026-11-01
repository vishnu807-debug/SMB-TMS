"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { getCustomerForQuote, getLineDefaults, getRate, saveQuotation } from "@/app/(app)/quotations/actions";
import type { SalesLookups } from "@/lib/sales";
import { ProductPicker, type PickedProduct } from "@/components/inventory/product-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn, formatMoney, formatQty } from "@/lib/utils";
import { computeLine, computeTotals } from "@/lib/quote-math";

export type QuoteLine = {
  key: string; product: PickedProduct | null; description: string; qty: string; unit_price: string; discount_pct: string;
  tax_code_id: string; fulfilment_mode: "stock" | "procure"; mode_locked: boolean; lead_time_text: string;
  unit_cost: string; available: number | null; item_type: string;
};
type Customer = Awaited<ReturnType<typeof getCustomerForQuote>>;
type Rule = { metric: string; comparison: string; threshold: number; name: string };

export type QuoteEditorProps = {
  lookups: SalesLookups;
  customers: { id: string; name: string; code: string }[];
  rules: Rule[];
  canViewCost: boolean;
  canChooseRep: boolean;
  currentUserId: string;
  initial?: { header: Record<string, any>; lines: QuoteLine[] };
};

const blankLine = (): QuoteLine => ({
  key: crypto.randomUUID(), product: null, description: "", qty: "1", unit_price: "", discount_pct: "0", tax_code_id: "",
  fulfilment_mode: "stock", mode_locked: false, lead_time_text: "", unit_cost: "", available: null, item_type: "stock",
});

export function QuotationEditor({ lookups, customers, rules, canViewCost, canChooseRep, currentUserId, initial }: QuoteEditorProps) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const plus = (d: string, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const [h, setH] = useState<Record<string, any>>(initial?.header ?? {
    quotation_date: today, valid_until: plus(today, lookups.validityDays), currency_code: lookups.baseCurrency,
    exchange_rate: "1", terms_conditions: lookups.defaultTerms, sales_rep_id: currentUserId,
  });
  const [lines, setLines] = useState<QuoteLine[]>(initial?.lines?.length ? initial.lines : [blankLine()]);
  const [customer, setCustomer] = useState<Customer>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const set = (k: string, v: unknown) => setH((x) => ({ ...x, [k]: v }));
  const taxRate = (id: string) => Number(lookups.taxCodes.find((t) => t.id === id)?.rate ?? 0);
  const defaultTax = lookups.taxCodes.find((t) => t.is_default)?.id ?? "";
  const isBase = h.currency_code === lookups.baseCurrency;

  // Load the customer's contacts, addresses and defaults.
  useEffect(() => {
    if (!h.customer_id) { setCustomer(null); return; }
    getCustomerForQuote(h.customer_id).then((c) => {
      setCustomer(c);
      if (!c || initial?.header.customer_id === h.customer_id) return;
      setH((x) => ({
        ...x,
        currency_code: c.currency_code ?? x.currency_code,
        payment_term_id: c.payment_term_id ?? "", delivery_term_id: c.delivery_term_id ?? "",
        contact_id: c.contacts?.find((k: any) => k.is_primary)?.id ?? c.contacts?.[0]?.id ?? "",
        billing_address_id: c.addresses?.find((a: any) => a.kind === "billing" && a.is_default)?.id ?? "",
        shipping_address_id: c.addresses?.find((a: any) => a.kind === "shipping" && a.is_default)?.id ?? "",
      }));
    });
  }, [h.customer_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Exchange rate follows the currency (editable).
  useEffect(() => {
    if (isBase) { set("exchange_rate", "1"); return; }
    if (initial?.header.currency_code === h.currency_code && initial?.header.exchange_rate) return;
    getRate(h.currency_code).then((r) => set("exchange_rate", r ? String(r) : ""));
  }, [h.currency_code]); // eslint-disable-line react-hooks/exhaustive-deps

  const updLine = (key: string, patch: Partial<QuoteLine>) => setLines((ls) => ls.map((l) => {
    if (l.key !== key) return l;
    const n = { ...l, ...patch };
    // Suggest fulfilment from stock until the user chooses explicitly.
    if (!n.mode_locked && n.item_type === "stock" && n.available !== null) {
      n.fulfilment_mode = n.available >= Number(n.qty || 0) ? "stock" : "procure";
    }
    if (n.item_type !== "stock") n.fulfilment_mode = "procure";
    return n;
  }));

  const pickProduct = async (key: string, p: PickedProduct) => {
    updLine(key, { product: p, description: p.name });
    const d = await getLineDefaults(p.id, h.currency_code, isBase ? 1 : Number(h.exchange_rate) || null);
    if ("error" in d) return setError(d.error ?? "Could not load product.");
    updLine(key, {
      description: d.description, unit_price: d.unit_price === null ? "" : String(d.unit_price), item_type: d.item_type,
      tax_code_id: customer?.default_tax_code_id ?? d.tax_code_id ?? defaultTax, available: d.available,
      unit_cost: d.unit_cost === null ? "" : String(d.unit_cost),
    });
  };

  const move = (i: number, dir: -1 | 1) => setLines((ls) => {
    const j = i + dir; if (j < 0 || j >= ls.length) return ls;
    const c = [...ls]; [c[i], c[j]] = [c[j], c[i]]; return c;
  });

  const computed = useMemo(() => lines.map((l) => computeLine(Number(l.qty) || 0, Number(l.unit_price) || 0, Number(l.discount_pct) || 0, taxRate(l.tax_code_id || defaultTax))),
    [lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = computeTotals(computed);
  const cost = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);
  const gp = totals.net - cost;
  const margin = totals.net > 0 ? (gp / totals.net) * 100 : null;
  const maxDisc = Math.max(0, ...lines.map((l) => Number(l.discount_pct) || 0));
  const rate = isBase ? 1 : Number(h.exchange_rate) || 0;

  // Show which approval rules this quotation will trigger (the database decides on submit).
  const triggers = rules.filter((r) => {
    const v = r.metric === "max_discount_pct" ? maxDisc : r.metric === "margin_pct" ? (canViewCost ? margin : null) : r.metric === "total_base" ? totals.total * rate : null;
    if (v === null) return false;
    return r.comparison === "gt" ? v > r.threshold : v < r.threshold;
  });

  const submit = () => {
    setError(null);
    const payload = {
      ...Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v === null ? undefined : v])),
      exchange_rate: isBase ? undefined : h.exchange_rate,
      lines: lines.filter((l) => l.product).map((l) => ({
        product_id: l.product!.id, description: l.description, qty: l.qty, unit_price: l.unit_price || "0",
        discount_pct: l.discount_pct || "0", tax_code_id: l.tax_code_id || undefined, fulfilment_mode: l.fulfilment_mode,
        lead_time_text: l.lead_time_text || undefined, unit_cost: canViewCost && l.unit_cost !== "" ? l.unit_cost : undefined,
      })),
    };
    start(async () => {
      const res = await saveQuotation(payload);
      if (!res.ok) return setError(res.error);
      router.push(`/quotations/${res.data!.id}`); router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Customer</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Customer" htmlFor="customer" required className="md:col-span-2">
            <Select id="customer" value={h.customer_id ?? ""} onChange={(e) => set("customer_id", e.target.value)}>
              <option value="">Select a customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
            </Select>
          </Field>
          <Field label="Attention (contact)" htmlFor="contact">
            <Select id="contact" value={h.contact_id ?? ""} onChange={(e) => set("contact_id", e.target.value)} disabled={!customer}>
              <option value="">—</option>
              {(customer?.contacts ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Billing address" htmlFor="bill">
            <Select id="bill" value={h.billing_address_id ?? ""} onChange={(e) => set("billing_address_id", e.target.value)} disabled={!customer}>
              <option value="">—</option>
              {(customer?.addresses ?? []).filter((a: any) => a.kind === "billing").map((a: any) => <option key={a.id} value={a.id}>{a.label ?? a.line1}, {a.city}</option>)}
            </Select>
          </Field>
          <Field label="Delivery address" htmlFor="ship">
            <Select id="ship" value={h.shipping_address_id ?? ""} onChange={(e) => set("shipping_address_id", e.target.value)} disabled={!customer}>
              <option value="">—</option>
              {(customer?.addresses ?? []).filter((a: any) => a.kind === "shipping").map((a: any) => <option key={a.id} value={a.id}>{a.label ?? a.line1}, {a.city}</option>)}
            </Select>
          </Field>
          <Field label="Customer reference / RFQ no." htmlFor="ref"><Input id="ref" value={h.customer_reference ?? ""} onChange={(e) => set("customer_reference", e.target.value)} /></Field>
          <Field label="Subject" htmlFor="subject" className="md:col-span-3"><Input id="subject" value={h.subject ?? ""} onChange={(e) => set("subject", e.target.value)} maxLength={200} placeholder="E.g. Supply of power cables for warehouse fit-out" /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Terms</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <Field label="Quotation date" htmlFor="qd" required><Input id="qd" type="date" value={h.quotation_date} onChange={(e) => set("quotation_date", e.target.value)} /></Field>
          <Field label="Valid until" htmlFor="vu" required><Input id="vu" type="date" min={h.quotation_date} value={h.valid_until} onChange={(e) => set("valid_until", e.target.value)} /></Field>
          <Field label="Currency" htmlFor="cur">
            <Select id="cur" value={h.currency_code} onChange={(e) => set("currency_code", e.target.value)}>
              {lookups.currencies.map((c) => <option key={c.code}>{c.code}</option>)}
            </Select>
          </Field>
          <Field label={isBase ? "Exchange rate" : `1 ${h.currency_code} = ? ${lookups.baseCurrency}`} htmlFor="rate" hint={!isBase && !h.exchange_rate ? "No rate on file — enter one" : undefined}>
            <Input id="rate" type="number" step="0.000001" min="0" disabled={isBase} value={h.exchange_rate ?? ""} onChange={(e) => set("exchange_rate", e.target.value)} />
          </Field>
          <Field label="Payment terms" htmlFor="pt">
            <Select id="pt" value={h.payment_term_id ?? ""} onChange={(e) => set("payment_term_id", e.target.value)}>
              <option value="">—</option>{lookups.paymentTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Delivery terms" htmlFor="dt">
            <Select id="dt" value={h.delivery_term_id ?? ""} onChange={(e) => set("delivery_term_id", e.target.value)}>
              <option value="">—</option>{lookups.deliveryTerms.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
            </Select>
          </Field>
          <Field label="Delivery time" htmlFor="dtime"><Input id="dtime" value={h.delivery_time ?? ""} onChange={(e) => set("delivery_time", e.target.value)} placeholder="e.g. 2–3 weeks from PO" /></Field>
          <Field label="Delivery location" htmlFor="dloc"><Input id="dloc" value={h.delivery_location ?? ""} onChange={(e) => set("delivery_location", e.target.value)} /></Field>
          {canChooseRep && (
            <Field label="Sales representative" htmlFor="rep">
              <Select id="rep" value={h.sales_rep_id ?? currentUserId} onChange={(e) => set("sales_rep_id", e.target.value)}>
                {lookups.reps.map((r) => <option key={r.id} value={r.id}>{r.full_name || r.email}</option>)}
              </Select>
            </Field>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <Button type="button" size="sm" variant="outline" onClick={() => setLines([...lines, blankLine()])}><Plus /> Add item</Button>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-12 px-2 py-2" />
                <th className="min-w-[320px] px-2 py-2 text-left">Product & description</th>
                <th className="w-24 px-2 py-2 text-right">Qty</th>
                <th className="w-32 px-2 py-2 text-right">Unit price</th>
                <th className="w-20 px-2 py-2 text-right">Disc %</th>
                <th className="w-36 px-2 py-2 text-left">VAT</th>
                <th className="w-40 px-2 py-2 text-left">Fulfilment</th>
                {canViewCost && <th className="w-32 px-2 py-2 text-right">Unit cost</th>}
                <th className="w-32 px-2 py-2 text-right">Amount</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => {
                const c = computed[i];
                const lineMargin = canViewCost && c.net > 0 && l.unit_cost !== "" ? ((c.net - Number(l.qty) * Number(l.unit_cost)) / c.net) * 100 : null;
                const short = l.item_type === "stock" && l.available !== null && l.fulfilment_mode === "stock" && l.available < Number(l.qty || 0);
                return (
                  <tr key={l.key} className="align-top">
                    <td className="px-2 py-2">
                      <div className="flex flex-col items-center text-slate-400">
                        <button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="hover:text-slate-700"><ArrowUp className="size-3.5" /></button>
                        <span className="text-xs">{i + 1}</span>
                        <button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="hover:text-slate-700"><ArrowDown className="size-3.5" /></button>
                      </div>
                    </td>
                    <td className="space-y-1.5 px-2 py-2">
                      <ProductPicker value={l.product} stockOnly={false} onChange={(p) => pickProduct(l.key, p)} />
                      <Textarea rows={2} value={l.description} onChange={(e) => updLine(l.key, { description: e.target.value })} className="min-h-[56px] text-xs" placeholder="Description printed on the quotation" />
                      {l.product && (
                        <p className="text-xs text-slate-500">
                          {l.item_type === "stock" ? <>In stock: <span className={cn("font-medium", (l.available ?? 0) > 0 ? "text-emerald-700" : "text-red-600")}>{formatQty(l.available)}</span> {l.product.uom}</> : "Non-stock item — always procured"}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2"><Input type="number" min="0" step="0.001" className="text-right" value={l.qty} onChange={(e) => updLine(l.key, { qty: e.target.value })} /></td>
                    <td className="px-2 py-2"><Input type="number" min="0" step="0.01" className="text-right" value={l.unit_price} onChange={(e) => updLine(l.key, { unit_price: e.target.value })} /></td>
                    <td className="px-2 py-2"><Input type="number" min="0" max="100" step="0.5" className="text-right" value={l.discount_pct} onChange={(e) => updLine(l.key, { discount_pct: e.target.value })} /></td>
                    <td className="px-2 py-2">
                      <Select value={l.tax_code_id || defaultTax} onChange={(e) => updLine(l.key, { tax_code_id: e.target.value })}>
                        {lookups.taxCodes.map((t) => <option key={t.id} value={t.id}>{t.code} {Number(t.rate)}%</option>)}
                      </Select>
                    </td>
                    <td className="space-y-1 px-2 py-2">
                      <Select value={l.fulfilment_mode} disabled={l.item_type !== "stock"} onChange={(e) => updLine(l.key, { fulfilment_mode: e.target.value as "stock" | "procure", mode_locked: true })}>
                        <option value="stock">From stock</option><option value="procure">Procure</option>
                      </Select>
                      {short && <p className="text-xs text-amber-700">Only {formatQty(l.available)} in stock; the rest will be procured on confirmation.</p>}
                      <Input value={l.lead_time_text} onChange={(e) => updLine(l.key, { lead_time_text: e.target.value })} placeholder="Lead time" className="h-8 text-xs" />
                    </td>
                    {canViewCost && (
                      <td className="px-2 py-2">
                        <Input type="number" min="0" step="0.0001" className="text-right" value={l.unit_cost} onChange={(e) => updLine(l.key, { unit_cost: e.target.value })} />
                        {lineMargin !== null && <p className={cn("mt-1 text-right text-xs", lineMargin < 15 ? "text-red-600" : "text-emerald-700")}>{lineMargin.toFixed(1)}% margin</p>}
                      </td>
                    )}
                    <td className="px-2 py-2 pt-4 text-right tabular-nums">
                      {formatMoney(c.net)}
                      {c.discount > 0 && <p className="text-xs text-slate-400 line-through">{formatMoney(c.gross)}</p>}
                    </td>
                    <td className="px-1 py-2">
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove item" disabled={lines.length === 1} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 /></Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid gap-6 border-t border-slate-200 p-5 md:grid-cols-2">
          <div className="space-y-3">
            {triggers.length > 0 && (
              <Alert tone="warning">
                <p className="font-medium">This quotation will need approval:</p>
                <ul className="mt-1 list-disc pl-4">{triggers.map((t) => <li key={t.name}>{t.name}</li>)}</ul>
              </Alert>
            )}
            {canViewCost && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><AlertTriangle className="size-3.5" /> Internal — not printed</p>
                <div className="grid grid-cols-3 gap-3">
                  <div><p className="text-xs text-slate-500">Purchase cost</p><p className="font-semibold tabular-nums">{formatMoney(cost)}</p></div>
                  <div><p className="text-xs text-slate-500">Gross profit</p><p className={cn("font-semibold tabular-nums", gp < 0 && "text-red-700")}>{formatMoney(gp)}</p></div>
                  <div><p className="text-xs text-slate-500">Gross margin</p><p className={cn("font-semibold tabular-nums", margin !== null && margin < 15 ? "text-red-700" : "text-emerald-700")}>{margin === null ? "—" : `${margin.toFixed(1)}%`}</p></div>
                </div>
              </div>
            )}
          </div>
          <dl className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd className="tabular-nums">{formatMoney(totals.gross)}</dd></div>
            {totals.discount > 0 && <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd className="tabular-nums">−{formatMoney(totals.discount)}</dd></div>}
            <div className="flex justify-between"><dt className="text-slate-500">Net amount</dt><dd className="tabular-nums">{formatMoney(totals.net)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">VAT</dt><dd className="tabular-nums">{formatMoney(totals.tax)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{h.currency_code} {formatMoney(totals.total)}</dd></div>
            {!isBase && rate > 0 && <div className="flex justify-between text-xs text-slate-500"><dt>In {lookups.baseCurrency}</dt><dd className="tabular-nums">{formatMoney(totals.total * rate)}</dd></div>}
          </dl>
        </div>
      </Card>

      <Card>
        <CardHeader><CardTitle>Terms and notes</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Terms and conditions (printed)" htmlFor="tc" className="md:col-span-2"><Textarea id="tc" rows={6} value={h.terms_conditions ?? ""} onChange={(e) => set("terms_conditions", e.target.value)} /></Field>
          <Field label="Notes to customer (printed)" htmlFor="notes"><Textarea id="notes" rows={3} value={h.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
          <Field label="Internal notes (never printed)" htmlFor="inotes"><Textarea id="inotes" rows={3} value={h.internal_notes ?? ""} onChange={(e) => set("internal_notes", e.target.value)} /></Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Link href={initial?.header.id ? `/quotations/${initial.header.id}` : "/quotations"} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Save draft</Button>
      </div>
    </div>
  );
}
