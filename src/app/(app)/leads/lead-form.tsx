"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { saveLead } from "./actions";
import type { SalesLookups } from "@/lib/sales";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ProductPicker, type PickedProduct } from "@/components/inventory/product-picker";
import { humanize } from "@/lib/utils";

type Item = { key: string; product: PickedProduct | null; description: string; qty: string; target_price: string };
const SOURCES = ["phone", "email", "walk_in", "website", "referral", "exhibition", "existing_customer", "tender", "other"];

export function LeadForm({ lookups, customers, initial, canAssign, currentUserId }: {
  lookups: SalesLookups; customers: { id: string; name: string; code: string }[]; initial?: Record<string, any>;
  canAssign: boolean; currentUserId: string;
}) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, any>>(initial ?? {
    source: "phone", currency_code: lookups.baseCurrency, probability: 20, priority: "medium", owner_id: currentUserId,
  });
  const [mode, setMode] = useState<"existing" | "new">(initial?.customer_id ? "existing" : initial ? "new" : "existing");
  const [items, setItems] = useState<Item[]>((initial?.items ?? []).map((i: any) => ({
    key: i.id, product: i.product ? { id: i.product.id, sku: i.product.sku, name: i.product.name, uom: i.product.uom?.code ?? "" } : null,
    description: i.description, qty: String(i.qty), target_price: i.target_price?.toString() ?? "",
  })));
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }));

  const submit = () => {
    setError(null);
    const payload = {
      ...Object.fromEntries(Object.entries(v).filter(([k]) => !["items", "doc_no", "stage", "lost_reason", "won_at", "created_at", "updated_at", "created_by", "updated_by"].includes(k))),
      customer_id: mode === "existing" ? v.customer_id : undefined,
      company_name: mode === "new" ? v.company_name : undefined,
      items: items.filter((i) => i.description.trim() || i.product).map((i) => ({
        product_id: i.product?.id, description: i.description || i.product?.name || "", qty: i.qty, target_price: i.target_price,
      })),
    };
    start(async () => {
      const res = await saveLead(payload);
      if (!res.ok) return setError(res.error);
      router.push(`/leads/${res.data!.id}`); router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Enquiry</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Title" htmlFor="title" required className="md:col-span-2" hint="E.g. 'Safety equipment for new site'">
            <Input id="title" value={v.title ?? ""} onChange={(e) => set("title", e.target.value)} maxLength={200} />
          </Field>
          <Field label="Source" htmlFor="source">
            <Select id="source" value={v.source} onChange={(e) => set("source", e.target.value)}>{SOURCES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          </Field>
          <div className="md:col-span-3">
            <div className="mb-2 flex gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> Existing customer</label>
              <label className="flex items-center gap-2"><input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> New company</label>
            </div>
            {mode === "existing" ? (
              <Select value={v.customer_id ?? ""} onChange={(e) => set("customer_id", e.target.value)} aria-label="Customer">
                <option value="">Select a customer…</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
              </Select>
            ) : (
              <Input placeholder="Company name" value={v.company_name ?? ""} onChange={(e) => set("company_name", e.target.value)} />
            )}
          </div>
          <Field label="Contact person" htmlFor="cn"><Input id="cn" value={v.contact_name ?? ""} onChange={(e) => set("contact_name", e.target.value)} /></Field>
          <Field label="Contact email" htmlFor="ce"><Input id="ce" type="email" value={v.contact_email ?? ""} onChange={(e) => set("contact_email", e.target.value)} /></Field>
          <Field label="Contact phone" htmlFor="cp"><Input id="cp" value={v.contact_phone ?? ""} onChange={(e) => set("contact_phone", e.target.value)} /></Field>
          <Field label="Customer requirement" htmlFor="req" className="md:col-span-3">
            <Textarea id="req" rows={4} value={v.requirement ?? ""} onChange={(e) => set("requirement", e.target.value)} placeholder="What the customer needs, specifications, quantities, deadlines…" />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Opportunity</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <Field label="Estimated value" htmlFor="ev">
            <div className="flex gap-2">
              <Select value={v.currency_code} onChange={(e) => set("currency_code", e.target.value)} className="w-24" aria-label="Currency">
                {lookups.currencies.map((c) => <option key={c.code}>{c.code}</option>)}
              </Select>
              <Input id="ev" type="number" min="0" step="100" value={v.estimated_value ?? ""} onChange={(e) => set("estimated_value", e.target.value)} />
            </div>
          </Field>
          <Field label={`Probability: ${v.probability}%`} htmlFor="prob">
            <input id="prob" type="range" min={0} max={100} step={5} value={v.probability} onChange={(e) => set("probability", Number(e.target.value))} className="mt-3 w-full accent-navy-700" />
          </Field>
          <Field label="Expected close" htmlFor="close"><Input id="close" type="date" value={v.expected_close_date ?? ""} onChange={(e) => set("expected_close_date", e.target.value)} /></Field>
          <Field label="Priority" htmlFor="prio">
            <Select id="prio" value={v.priority} onChange={(e) => set("priority", e.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select>
          </Field>
          <Field label="Owner" htmlFor="owner" className="md:col-span-2">
            <Select id="owner" value={v.owner_id ?? currentUserId} disabled={!canAssign} onChange={(e) => set("owner_id", e.target.value)}>
              {lookups.reps.map((r) => <option key={r.id} value={r.id}>{r.full_name || r.email}</option>)}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Requirement lines (optional)</CardTitle>
          <Button type="button" size="sm" variant="outline" onClick={() => setItems([...items, { key: crypto.randomUUID(), product: null, description: "", qty: "", target_price: "" }])}><Plus /> Add line</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.length === 0 && <p className="text-sm text-slate-500">Add the products or items the customer asked for — they can be copied into a quotation later.</p>}
          {items.map((i) => {
            const upd = (patch: Partial<Item>) => setItems(items.map((x) => (x.key === i.key ? { ...x, ...patch } : x)));
            return (
              <div key={i.key} className="grid items-start gap-2 md:grid-cols-12">
                <div className="md:col-span-4"><ProductPicker value={i.product} onChange={(p) => upd({ product: p, description: i.description || p.name })} /></div>
                <Input className="md:col-span-4" placeholder="Description" value={i.description} onChange={(e) => upd({ description: e.target.value })} />
                <Input className="md:col-span-1" type="number" min="0" placeholder="Qty" value={i.qty} onChange={(e) => upd({ qty: e.target.value })} />
                <Input className="md:col-span-2" type="number" min="0" placeholder="Target price" value={i.target_price} onChange={(e) => upd({ target_price: e.target.value })} />
                <Button type="button" size="icon" variant="ghost" aria-label="Remove line" onClick={() => setItems(items.filter((x) => x.key !== i.key))}><Trash2 /></Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Link href={initial?.id ? `/leads/${initial.id}` : "/leads"} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="animate-spin" />}{initial?.id ? "Save changes" : "Register enquiry"}</Button>
      </div>
    </div>
  );
}
