"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, FileText, Loader2, Package, PackagePlus, Paperclip, Plus, Trash2, X } from "lucide-react";
import { addQuotationDocument, getCustomerForQuote, getLineDefaults, getProductDocuments, getRate, removeQuotationDocument, saveQuotation } from "@/app/(app)/quotations/actions";
import { checkDocFile, DOC_ACCEPT, uploadQuotationFile } from "@/lib/quotation-files";
import { blankNewProduct, textToSpecs, type NewProduct } from "@/lib/quote-lines";
export type { NewProduct } from "@/lib/quote-lines";
import type { SalesLookups } from "@/lib/sales";
import { ProductPicker, type PickedProduct } from "@/components/inventory/product-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { cn, formatMoney, formatQty } from "@/lib/utils";
import { computeLine, computeTotals } from "@/lib/quote-math";

/** A catalogue document that can be reused on the quotation (doc_id set when already attached). */
export type ReuseDoc = { attachment_id: string; file_name: string; kind: string; checked: boolean; doc_id?: string };
export type AttachedDoc = { id: string; file_name: string };

export type QuoteLine = {
  key: string; kind: "catalogue" | "new"; product: PickedProduct | null; quote_product_id?: string; np: NewProduct;
  description: string; qty: string; unit_price: string; discount_pct: string;
  tax_code_id: string; fulfilment_mode: "stock" | "procure"; mode_locked: boolean; lead_time_text: string;
  unit_cost: string; available: number | null; item_type: string;
  files: File[]; reuse: ReuseDoc[]; attached: AttachedDoc[];
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
  uoms: { id: string; code: string; name: string }[];
  initial?: { header: Record<string, any>; lines: QuoteLine[]; documents?: AttachedDoc[] };
};

const blankLine = (uomId: string): QuoteLine => ({
  key: crypto.randomUUID(), kind: "catalogue", product: null, np: blankNewProduct(uomId), description: "", qty: "1", unit_price: "", discount_pct: "0", tax_code_id: "",
  fulfilment_mode: "stock", mode_locked: false, lead_time_text: "", unit_cost: "", available: null, item_type: "stock",
  files: [], reuse: [], attached: [],
});
const DOC_KINDS = [["supporting", "Supporting document"], ["datasheet", "Technical datasheet"], ["drawing", "Drawing"], ["certificate", "Certificate"], ["other", "Other"]] as const;

export function QuotationEditor({ lookups, customers, rules, canViewCost, canChooseRep, currentUserId, uoms, initial }: QuoteEditorProps) {
  const defaultUom = uoms.find((u) => u.code === "PCS")?.id ?? uoms[0]?.id ?? "";
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const plus = (d: string, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const [h, setH] = useState<Record<string, any>>(initial?.header ?? {
    quotation_date: today, valid_until: plus(today, lookups.validityDays), currency_code: lookups.baseCurrency,
    exchange_rate: "1", terms_conditions: lookups.defaultTerms, sales_rep_id: currentUserId,
  });
  const [lines, setLines] = useState<QuoteLine[]>(initial?.lines?.length ? initial.lines : [blankLine(defaultUom)]);
  const [docs, setDocs] = useState<{ key: string; file: File; kind: string }[]>([]);
  const [docKind, setDocKind] = useState("supporting");
  const [progress, setProgress] = useState<string | null>(null);
  const [docProblems, setDocProblems] = useState<{ id: string; messages: string[] } | null>(null);
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
    if (n.item_type !== "stock" || n.kind === "new") n.fulfilment_mode = "procure";
    return n;
  }));
  const updNp = (key: string, patch: Partial<NewProduct>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, np: { ...l.np, ...patch } } : l)));

  const pickProduct = async (key: string, p: PickedProduct) => {
    updLine(key, { product: p, description: p.name, quote_product_id: undefined, reuse: [] });
    const [d, files] = await Promise.all([getLineDefaults(p.id, h.currency_code, isBase ? 1 : Number(h.exchange_rate) || null), getProductDocuments(p.id)]);
    if ("error" in d) return setError(d.error ?? "Could not load product.");
    updLine(key, {
      description: d.description, unit_price: d.unit_price === null ? "" : String(d.unit_price), item_type: d.item_type,
      tax_code_id: customer?.default_tax_code_id ?? d.tax_code_id ?? defaultTax, available: d.available,
      unit_cost: d.unit_cost === null ? "" : String(d.unit_cost),
      // Catalogue datasheets are offered for reuse (ticked by default).
      reuse: files.map((f) => ({ attachment_id: f.id, file_name: f.file_name, kind: f.kind, checked: f.kind === "datasheet" })),
    });
  };

  const setKind = (key: string, kind: QuoteLine["kind"]) => updLine(key, kind === "new"
    ? { kind, product: null, reuse: [], item_type: "non_stock", fulfilment_mode: "procure", available: null, quote_product_id: undefined }
    : { kind, item_type: "stock", mode_locked: false });

  const addFiles = (key: string, list: FileList | null) => {
    if (!list?.length) return;
    const files = [...list];
    const bad = files.map((f) => checkDocFile(f)).filter(Boolean) as string[];
    if (bad.length) setError(bad.join(" "));
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, files: [...l.files, ...files.filter((f) => !checkDocFile(f))] } : l)));
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

  // A new-product line counts once anything is typed into it (so a missing name is reported, not dropped).
  const included = lines.filter((l) => l.kind === "new"
    ? [l.np.name, l.np.brand, l.np.model_no, l.np.description, l.unit_price, l.description].some((v) => v.trim() !== "")
    : !!l.product);

  const submit = () => {
    setError(null); setDocProblems(null);
    const payload = {
      ...Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v === null ? undefined : v])),
      exchange_rate: isBase ? undefined : h.exchange_rate,
      lines: included.map((l) => {
        const money = {
          qty: l.qty, unit_price: l.unit_price || "0", discount_pct: l.discount_pct || "0", tax_code_id: l.tax_code_id || undefined,
          lead_time_text: l.lead_time_text || undefined, unit_cost: canViewCost && l.unit_cost !== "" ? l.unit_cost : undefined,
        };
        return l.kind === "new"
          ? { ...money, description: l.description || undefined, quote_product: {
              id: l.np.id, name: l.np.name, description: l.np.description || undefined, brand: l.np.brand || undefined,
              model_no: l.np.model_no || undefined, technical_specs: textToSpecs(l.np.specs), uom_id: l.np.uom_id } }
          : { ...money, product_id: l.product!.id, quote_product_id: l.quote_product_id, description: l.description, fulfilment_mode: l.fulfilment_mode };
      }),
    };
    start(async () => {
      const res = await saveQuotation(payload);
      if (!res.ok) return setError(res.error);
      const { id, lines: saved } = res.data!;
      // Documents are uploaded once the quotation exists (they are stored under its number).
      const problems: string[] = [];
      const total = included.reduce((n, l) => n + l.files.length + l.reuse.filter((r) => r.checked !== !!r.doc_id).length, 0) + docs.length;
      let done = 0;
      const step = () => setProgress(`Uploading documents (${++done} of ${total})…`);
      for (const [i, l] of included.entries()) {
        const s = saved.find((x) => x.line_no === i + 1);
        const link = s?.product_id ? { product_id: s.product_id } : s?.quote_product_id ? { quote_product_id: s.quote_product_id } : {};
        for (const f of l.files) {
          step();
          try {
            const up = await uploadQuotationFile(id, f);
            const r = await addQuotationDocument({ quotation_id: id, kind: "datasheet", ...link, ...up });
            if (!r.ok) problems.push(`${f.name}: ${r.error}`);
          } catch (e) { problems.push((e as Error).message); }
        }
        for (const r of l.reuse) {
          if (r.checked && !r.doc_id) {
            step();
            const x = await addQuotationDocument({ quotation_id: id, product_attachment_id: r.attachment_id });
            if (!x.ok) problems.push(`${r.file_name}: ${x.error}`);
          } else if (!r.checked && r.doc_id) {
            step();
            const x = await removeQuotationDocument(r.doc_id);
            if (!x.ok) problems.push(`${r.file_name}: ${x.error}`);
          }
        }
      }
      for (const d of docs) {
        step();
        try {
          const up = await uploadQuotationFile(id, d.file);
          const r = await addQuotationDocument({ quotation_id: id, kind: d.kind, ...up });
          if (!r.ok) problems.push(`${d.file.name}: ${r.error}`);
        } catch (e) { problems.push((e as Error).message); }
      }
      setProgress(null);
      if (problems.length) return setDocProblems({ id, messages: problems });
      router.push(`/quotations/${id}`); router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      {docProblems && (
        <Alert tone="warning">
          <p className="font-medium">The quotation was saved, but some documents could not be attached:</p>
          <ul className="mt-1 list-disc pl-4">{docProblems.messages.map((m, i) => <li key={i}>{m}</li>)}</ul>
          <Link href={`/quotations/${docProblems.id}`} className="mt-2 inline-block font-medium underline">Open the quotation</Link> and attach them from the Documents section.
        </Alert>
      )}
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
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setLines([...lines, blankLine(defaultUom)])}><Plus /> Catalogue item</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setLines([...lines, { ...blankLine(defaultUom), kind: "new", item_type: "non_stock", fulfilment_mode: "procure" }])}><PackagePlus /> New product</Button>
          </div>
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
                      <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-xs" role="group" aria-label="Item type">
                        {(["catalogue", "new"] as const).map((k) => (
                          <button key={k} type="button" onClick={() => l.kind !== k && setKind(l.key, k)} disabled={!!l.np.id && k === "catalogue"}
                            className={cn("flex items-center gap-1 rounded px-2 py-0.5", l.kind === k ? "bg-navy-800 text-white" : "text-slate-600 hover:bg-slate-100 disabled:opacity-40")}>
                            {k === "catalogue" ? <><Package className="size-3" /> Catalogue</> : <><PackagePlus className="size-3" /> New product</>}
                          </button>
                        ))}
                      </div>
                      {l.kind === "catalogue" ? (
                        <>
                          <ProductPicker value={l.product} stockOnly={false} onChange={(p) => pickProduct(l.key, p)} />
                          <Textarea rows={2} value={l.description} onChange={(e) => updLine(l.key, { description: e.target.value })} className="min-h-[56px] text-xs" placeholder="Description printed on the quotation" />
                          {l.product && (
                            <p className="text-xs text-slate-500">
                              {l.item_type === "stock" ? <>In stock: <span className={cn("font-medium", (l.available ?? 0) > 0 ? "text-emerald-700" : "text-red-600")}>{formatQty(l.available)}</span> {l.product.uom}</> : "Non-stock item — always procured"}
                            </p>
                          )}
                        </>
                      ) : (
                        <div className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50/50 p-2">
                          <Input value={l.np.name} onChange={(e) => updNp(l.key, { name: e.target.value })} placeholder="Product name *" aria-label="New product name" maxLength={200} />
                          <div className="grid grid-cols-3 gap-1.5">
                            <Input value={l.np.brand} onChange={(e) => updNp(l.key, { brand: e.target.value })} placeholder="Brand" aria-label="Brand" maxLength={80} className="text-xs" />
                            <Input value={l.np.model_no} onChange={(e) => updNp(l.key, { model_no: e.target.value })} placeholder="Model / SKU" aria-label="Model or SKU" maxLength={80} className="text-xs" />
                            <Select value={l.np.uom_id} onChange={(e) => updNp(l.key, { uom_id: e.target.value })} aria-label="Unit of measurement" className="text-xs">
                              <option value="">Unit *</option>{uoms.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
                            </Select>
                          </div>
                          <Textarea rows={2} value={l.description} onChange={(e) => updLine(l.key, { description: e.target.value })} className="min-h-[48px] text-xs" placeholder="Description printed on the quotation (defaults to the name)" />
                          <Textarea rows={2} value={l.np.specs} onChange={(e) => updNp(l.key, { specs: e.target.value })} className="min-h-[48px] text-xs" placeholder={"Technical specifications, one per line\ne.g. Power: 5.5 kW"} aria-label="Technical specifications" />
                          <p className="text-xs text-amber-800">Not added to the product catalogue. It can be added after the customer confirms the quotation.</p>
                        </div>
                      )}
                      <LineDocuments line={l} onFiles={(f) => addFiles(l.key, f)}
                        onRemoveFile={(i) => updLine(l.key, { files: l.files.filter((_, j) => j !== i) })}
                        onToggleReuse={(id, checked) => updLine(l.key, { reuse: l.reuse.map((r) => (r.attachment_id === id ? { ...r, checked } : r)) })} />
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
                      <Select value={l.fulfilment_mode} disabled={l.item_type !== "stock" || l.kind === "new"} onChange={(e) => updLine(l.key, { fulfilment_mode: e.target.value as "stock" | "procure", mode_locked: true })}>
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
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove item" disabled={lines.length === 1}
                        onClick={() => (l.attached.length === 0 || confirm("Remove this item? Its uploaded datasheets stay in the quotation's documents, where you can remove them.")) && setLines(lines.filter((x) => x.key !== l.key))}><Trash2 /></Button>
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

      <Card>
        <CardHeader><CardTitle>Documents</CardTitle><span className="text-xs text-slate-500">PDF, DOC or DOCX, up to 25 MB each</span></CardHeader>
        <CardContent className="space-y-3">
          {(initial?.documents ?? []).length > 0 && (
            <ul className="space-y-1 text-sm">
              {initial!.documents!.map((d) => <li key={d.id} className="flex items-center gap-2 text-slate-700"><FileText className="size-4 text-slate-400" /> {d.file_name} <span className="text-xs text-slate-400">attached</span></li>)}
              <li className="text-xs text-slate-500">Remove or change attached documents on the quotation page.</li>
            </ul>
          )}
          {docs.map((d) => (
            <div key={d.key} className="flex items-center gap-2 text-sm">
              <FileText className="size-4 text-slate-400" /> <span className="flex-1 truncate">{d.file.name}</span>
              <Select value={d.kind} onChange={(e) => setDocs(docs.map((x) => (x.key === d.key ? { ...x, kind: e.target.value } : x)))} className="h-8 w-48 text-xs" aria-label="Document type">
                {DOC_KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </Select>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${d.file.name}`} onClick={() => setDocs(docs.filter((x) => x.key !== d.key))}><X /></Button>
            </div>
          ))}
          <label className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer")}>
            <Paperclip /> Attach documents to the quotation
            <input type="file" multiple accept={DOC_ACCEPT} hidden onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              const bad = files.map((f) => checkDocFile(f)).filter(Boolean) as string[];
              if (bad.length) setError(bad.join(" "));
              setDocs([...docs, ...files.filter((f) => !checkDocFile(f)).map((file) => ({ key: crypto.randomUUID(), file, kind: docKind }))]);
              e.target.value = "";
            }} />
          </label>
          <Select value={docKind} onChange={(e) => setDocKind(e.target.value)} className="ml-2 inline-block h-8 w-48 text-xs" aria-label="Type of the next documents">
            {DOC_KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </Select>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        {progress && <span className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="size-4 animate-spin" /> {progress}</span>}
        <Link href={initial?.header.id ? `/quotations/${initial.header.id}` : "/quotations"} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Save draft</Button>
      </div>
    </div>
  );
}

/** Datasheets for one line: catalogue documents to reuse, already attached files, and new uploads. */
function LineDocuments({ line, onFiles, onRemoveFile, onToggleReuse }: {
  line: QuoteLine; onFiles: (f: FileList | null) => void; onRemoveFile: (i: number) => void; onToggleReuse: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="space-y-1 text-xs">
      {line.reuse.map((r) => (
        <label key={r.attachment_id} className="flex items-center gap-1.5 text-slate-600">
          <input type="checkbox" className="size-3.5" checked={r.checked} onChange={(e) => onToggleReuse(r.attachment_id, e.target.checked)} />
          <FileText className="size-3 text-slate-400" /> <span className="truncate">{r.file_name}</span>
          <span className="text-slate-400">({r.kind} from catalogue)</span>
        </label>
      ))}
      {line.attached.map((d) => <p key={d.id} className="flex items-center gap-1.5 text-slate-600"><FileText className="size-3 text-slate-400" /> {d.file_name} <span className="text-slate-400">attached</span></p>)}
      {line.files.map((f, i) => (
        <p key={i} className="flex items-center gap-1.5 text-slate-700">
          <FileText className="size-3 text-navy-600" /> <span className="truncate">{f.name}</span> <span className="text-slate-400">(uploads on save)</span>
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onRemoveFile(i)} className="text-slate-400 hover:text-red-600"><X className="size-3" /></button>
        </p>
      ))}
      <label className="inline-flex cursor-pointer items-center gap-1 text-navy-700 hover:underline">
        <Paperclip className="size-3" /> Attach datasheet
        <input type="file" multiple accept={DOC_ACCEPT} hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      </label>
    </div>
  );
}
