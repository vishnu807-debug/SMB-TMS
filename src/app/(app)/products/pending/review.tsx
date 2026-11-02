"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, FileText, Link2, Loader2, PackagePlus } from "lucide-react";
import { promoteQuoteProduct } from "./actions";
import { quotationDocumentUrl } from "@/app/(app)/quotations/actions";
import { ProductPicker, type PickedProduct } from "@/components/inventory/product-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatMoney, formatQty } from "@/lib/utils";

export type PendingItem = {
  id: string; name: string; description: string | null; brand: string | null; model_no: string | null;
  technical_specs: { name: string; value: string }[]; uom_code: string; quotation_id: string; doc_no: string;
  currency_code: string; confirmation_date: string | null; customer_name: string; sales_rep: string | null; created_by_name: string | null;
  line_description: string | null; qty: number | null; unit_price: number | null;
  docs: { id: string; file_name: string }[];
  matches: { id: string; sku: string; name: string; brand: string | null; model_no: string | null; is_active: boolean; match_reason: string; exact: boolean }[];
};

export function PendingProductReview({ item, categories, canOpenQuotation }: { item: PendingItem; categories: { id: string; full_path: string }[]; canOpenQuotation: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [mode, setMode] = useState<"create" | "link">(item.matches.some((m) => m.exact && m.is_active) ? "link" : "create");
  const [form, setForm] = useState({ name: item.name, sku: "", item_type: "stock", category_id: "", description: item.description ?? item.line_description ?? "", note: "" });
  const [other, setOther] = useState<PickedProduct | null>(null);
  const exact = item.matches.filter((m) => m.exact);

  const submit = (payload: Record<string, unknown>, question: string) => {
    if (!confirm(question)) return;
    setError(null);
    start(async () => {
      const r = await promoteQuoteProduct(item.id, payload);
      if (!r.ok) return setError(r.error);
      const d = r.data!;
      setDone(`${payload.action === "create" ? "Added to the catalogue" : "Linked"} as ${d.sku}.${d.copied ? ` ${d.copied} datasheet${d.copied > 1 ? "s" : ""} copied to the product.` : ""}${d.copyErrors.length ? ` Could not copy: ${d.copyErrors.join(", ")} — attach them on the product page.` : ""}`);
      setTimeout(() => router.refresh(), 2500);
    });
  };

  const open = (id: string) => start(async () => {
    const r = await quotationDocumentUrl(id);
    if (!r.ok) return setError(r.error);
    window.location.href = r.data!.url;
  });

  return (
    <Card id={item.id}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">{item.name} {item.brand && <Badge tone="slate">{item.brand}</Badge>} {item.model_no && <Badge tone="slate">Model {item.model_no}</Badge>}</CardTitle>
        <span className="text-xs text-slate-500">
          {canOpenQuotation ? <Link href={`/quotations/${item.quotation_id}`} className="font-mono text-navy-700 hover:underline">{item.doc_no}</Link> : <span className="font-mono">{item.doc_no}</span>} · {item.customer_name} · confirmed {formatDate(item.confirmation_date)}
        </span>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <div><dt className="text-xs text-slate-500">Quoted</dt><dd>{formatQty(item.qty)} {item.uom_code} × {item.currency_code} {formatMoney(item.unit_price)}</dd></div>
            <div><dt className="text-xs text-slate-500">Entered by</dt><dd>{item.created_by_name ?? "—"}{item.sales_rep && item.sales_rep !== item.created_by_name ? ` (rep: ${item.sales_rep})` : ""}</dd></div>
          </dl>
          {item.line_description && <p className="whitespace-pre-line text-slate-700"><span className="text-xs text-slate-500">Quoted as: </span>{item.line_description}</p>}
          {item.technical_specs.length > 0 && (
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">{item.technical_specs.map((s, i) => <tr key={i}><td className="py-1 pr-3 text-slate-500">{s.name}</td><td className="py-1">{s.value}</td></tr>)}</tbody>
            </table>
          )}
          {item.docs.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-slate-500">Datasheets (copied to the product when added)</p>
              {item.docs.map((d) => <button key={d.id} type="button" onClick={() => open(d.id)} className="flex items-center gap-1.5 text-navy-700 hover:underline"><FileText className="size-3.5" /> {d.file_name}</button>)}
            </div>
          )}
          {item.matches.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
              <p className="mb-1 text-xs font-semibold text-amber-900">Possible matches already in the catalogue</p>
              <ul className="space-y-1.5">
                {item.matches.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span><Link href={`/products/${m.id}`} className="font-mono text-xs text-navy-700 hover:underline">{m.sku}</Link> {m.name}
                      <span className="text-xs text-slate-500"> · {m.match_reason}{!m.is_active && " · inactive"}</span></span>
                    {m.is_active && !done && (
                      <Button type="button" size="sm" variant="outline" disabled={busy}
                        onClick={() => submit({ action: "link", product_id: m.id, note: form.note }, `Link "${item.name}" to ${m.sku} ${m.name}? The quotation keeps its own description and price.`)}>
                        <Link2 /> Link to this
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {done ? <Alert tone="success"><CheckCircle2 className="mr-1 inline size-4" />{done}</Alert> : (
            <>
              {error && <Alert tone="error">{error}</Alert>}
              <div className="inline-flex rounded-md border border-slate-200 p-0.5 text-sm">
                <button type="button" onClick={() => setMode("create")} className={`rounded px-3 py-1 ${mode === "create" ? "bg-navy-800 text-white" : "text-slate-600"}`}>Add to catalogue</button>
                <button type="button" onClick={() => setMode("link")} className={`rounded px-3 py-1 ${mode === "link" ? "bg-navy-800 text-white" : "text-slate-600"}`}>Link to existing</button>
              </div>
              {mode === "create" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {exact.length > 0 && <Alert tone="warning" className="sm:col-span-2">The catalogue already has a product with the same name or model. Creating another one will be refused — link to it instead.</Alert>}
                  <Field label="Catalogue name" required className="sm:col-span-2"><Input value={form.name} maxLength={200} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
                  <Field label="SKU" hint="Leave empty to number automatically"><Input value={form.sku} maxLength={40} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} /></Field>
                  <Field label="Item type" required>
                    <Select value={form.item_type} onChange={(e) => setForm({ ...form, item_type: e.target.value })}>
                      <option value="stock">Stock item</option><option value="non_stock">Non-stock (always procured)</option><option value="service">Service</option>
                    </Select>
                  </Field>
                  <Field label="Category" className="sm:col-span-2">
                    <Select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                      <option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.full_path}</option>)}
                    </Select>
                  </Field>
                  <Field label="Catalogue description" className="sm:col-span-2"><Textarea rows={3} maxLength={4000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
                  <Field label="Note for the audit trail" className="sm:col-span-2"><Input value={form.note} maxLength={500} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Optional" /></Field>
                  <p className="text-xs text-slate-500 sm:col-span-2">Brand, model, unit ({item.uom_code}), specifications and the quoted price ({item.currency_code} {formatMoney(item.unit_price)}) are copied to the new product. You can complete it on the product page afterwards.</p>
                  <div className="sm:col-span-2 flex justify-end">
                    <Button type="button" disabled={busy || form.name.trim().length < 2}
                      onClick={() => submit({ action: "create", ...form }, `Create "${form.name}" in the product catalogue? This permanent product record cannot be undone from here.`)}>
                      {busy ? <Loader2 className="animate-spin" /> : <PackagePlus />} Add to catalogue
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <Field label="Catalogue product"><ProductPicker value={other} stockOnly={false} onChange={setOther} /></Field>
                  <Field label="Note for the audit trail"><Input value={form.note} maxLength={500} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Optional" /></Field>
                  <div className="flex justify-end">
                    <Button type="button" disabled={busy || !other}
                      onClick={() => other && submit({ action: "link", product_id: other.id, note: form.note }, `Link "${item.name}" to ${other.sku} ${other.name}? The quotation keeps its own description and price.`)}>
                      {busy ? <Loader2 className="animate-spin" /> : <Link2 />} Link product
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
