"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { getAvailability, openProcureLines, saveStockDocument } from "@/app/(app)/inventory/actions";
import { ADJUSTMENT_REASONS, DOC_KINDS, ISSUE_TYPES, type DocKind } from "@/lib/inventory-config";
import { ProductPicker, type PickedProduct } from "./product-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { formatQty, humanize } from "@/lib/utils";

export type DocLine = {
  key: string; product: PickedProduct | null; qty: string; unit_cost: string; unit_cost_base: string;
  mode: "change" | "count"; qty_change: string; counted_qty: string; sales_order_line_id: string; notes: string;
};

export type DocFormLookups = {
  warehouses: { id: string; code: string; name: string }[];
  suppliers: { id: string; name: string; code: string }[];
  currencies: { code: string }[];
  baseCurrency: string;
  canAuthoriseNegative: boolean;
  canViewValuation: boolean;
};

export type DocFormInitial = { header: Record<string, string | boolean | null>; lines: DocLine[] };

const newLine = (): DocLine => ({
  key: crypto.randomUUID(), product: null, qty: "", unit_cost: "", unit_cost_base: "", mode: "change",
  qty_change: "", counted_qty: "", sales_order_line_id: "", notes: "",
});

export function StockDocumentForm({ kind, lookups, initial }: { kind: DocKind; lookups: DocFormLookups; initial?: DocFormInitial }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const cfg = DOC_KINDS[kind];
  const [h, setH] = useState<Record<string, any>>(initial?.header ?? {
    warehouse_id: lookups.warehouses[0]?.id ?? "", from_warehouse_id: lookups.warehouses[0]?.id ?? "", to_warehouse_id: "",
    currency_code: lookups.baseCurrency, issue_type: "internal_use", reason: "physical_count", [cfg.dateField]: today,
  });
  const [lines, setLines] = useState<DocLine[]>(initial?.lines?.length ? initial.lines : [newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const [avail, setAvail] = useState<Record<string, { physical: number; reserved: number; available: number }>>({});
  const [procureOptions, setProcureOptions] = useState<Record<string, { id: string; label: string }[]>>({});

  const set = (k: string, v: any) => setH((x) => ({ ...x, [k]: v }));
  const setLine = (key: string, patch: Partial<DocLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const sourceWh = kind === "transfers" ? h.from_warehouse_id : h.warehouse_id;
  const productIds = useMemo(() => lines.map((l) => l.product?.id).filter(Boolean) as string[], [lines]);

  // Live stock figures for the chosen warehouse.
  useEffect(() => {
    if (!sourceWh || productIds.length === 0) return;
    getAvailability(sourceWh, productIds).then(setAvail);
  }, [sourceWh, productIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back-to-back receipt: which customer orders are waiting for this product?
  useEffect(() => {
    if (kind !== "receipts") return;
    productIds.filter((id) => !(id in procureOptions)).forEach((id) =>
      openProcureLines(id).then((opts) => setProcureOptions((o) => ({ ...o, [id]: opts }))));
  }, [productIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    setError(null);
    const opt = (v: string) => (v === "" ? undefined : v);
    const payload: Record<string, any> = { id: initial?.header.id ?? undefined };
    Object.entries(h).forEach(([k, v]) => { if (k !== "id" && k !== "doc_no") payload[k] = typeof v === "string" ? opt(v.trim()) : v ?? undefined; });
    if (payload.currency_code === lookups.baseCurrency) delete payload.exchange_rate;
    payload.lines = lines.filter((l) => l.product).map((l) => ({
      product_id: l.product!.id,
      notes: opt(l.notes),
      ...(kind === "adjustments"
        ? { mode: l.mode, qty_change: l.mode === "change" ? opt(l.qty_change) : undefined, counted_qty: l.mode === "count" ? opt(l.counted_qty) : undefined,
            unit_cost_base: lookups.canViewValuation ? opt(l.unit_cost_base) : undefined }
        : { qty: opt(l.qty) }),
      ...(kind === "receipts" ? { unit_cost: opt(l.unit_cost), sales_order_line_id: opt(l.sales_order_line_id) } : {}),
    }));
    if (payload.lines.length === 0) return setError("Add at least one item.");
    start(async () => {
      const res = await saveStockDocument(kind, payload);
      if (!res.ok) return setError(res.error);
      router.push(`/inventory/${kind}/${res.data!.id}`);
      router.refresh();
    });
  };

  const whSelect = (name: string, label: string, exclude?: string) => (
    <Field label={label} htmlFor={name} required>
      <Select id={name} value={h[name] ?? ""} onChange={(e) => set(name, e.target.value)}>
        <option value="">Select…</option>
        {lookups.warehouses.filter((w) => w.id !== exclude).map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
      </Select>
    </Field>
  );

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {kind === "transfers" ? (
            <>{whSelect("from_warehouse_id", "From warehouse")}{whSelect("to_warehouse_id", "To warehouse", h.from_warehouse_id)}</>
          ) : whSelect("warehouse_id", "Warehouse")}
          <Field label="Date" htmlFor="date" required>
            <Input id="date" type="date" max={today} value={h[cfg.dateField] ?? today} onChange={(e) => set(cfg.dateField, e.target.value)} />
          </Field>

          {kind === "receipts" && (
            <>
              <Field label="Supplier" htmlFor="supplier_id">
                <Select id="supplier_id" value={h.supplier_id ?? ""} onChange={(e) => set("supplier_id", e.target.value)}>
                  <option value="">— Not specified —</option>
                  {lookups.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Supplier delivery note / invoice no." htmlFor="supplier_reference">
                <Input id="supplier_reference" value={h.supplier_reference ?? ""} onChange={(e) => set("supplier_reference", e.target.value)} maxLength={80} />
              </Field>
              <Field label="Cost currency" htmlFor="currency_code">
                <Select id="currency_code" value={h.currency_code ?? lookups.baseCurrency} onChange={(e) => set("currency_code", e.target.value)}>
                  {lookups.currencies.map((c) => <option key={c.code}>{c.code}</option>)}
                </Select>
              </Field>
              {h.currency_code && h.currency_code !== lookups.baseCurrency && (
                <Field label={`Exchange rate (1 ${h.currency_code} = ? ${lookups.baseCurrency})`} htmlFor="exchange_rate" hint="Leave blank to use the latest rate in Settings">
                  <Input id="exchange_rate" type="number" step="0.000001" min="0" value={h.exchange_rate ?? ""} onChange={(e) => set("exchange_rate", e.target.value)} />
                </Field>
              )}
            </>
          )}

          {kind === "issues" && (
            <>
              <Field label="Issue type" htmlFor="issue_type" required>
                <Select id="issue_type" value={h.issue_type} onChange={(e) => set("issue_type", e.target.value)}>
                  {ISSUE_TYPES.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}
                </Select>
              </Field>
              {h.issue_type === "return_to_supplier" ? (
                <Field label="Supplier" htmlFor="supplier_id" required>
                  <Select id="supplier_id" value={h.supplier_id ?? ""} onChange={(e) => set("supplier_id", e.target.value)}>
                    <option value="">Select…</option>
                    {lookups.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
              ) : (
                <Field label="Issued to" htmlFor="issued_to">
                  <Input id="issued_to" value={h.issued_to ?? ""} onChange={(e) => set("issued_to", e.target.value)} placeholder="Person, department or customer" />
                </Field>
              )}
              <Field label="Reference" htmlFor="reference"><Input id="reference" value={h.reference ?? ""} onChange={(e) => set("reference", e.target.value)} /></Field>
            </>
          )}

          {kind === "adjustments" && (
            <Field label="Reason" htmlFor="reason" required>
              <Select id="reason" value={h.reason} onChange={(e) => set("reason", e.target.value)}>
                {ADJUSTMENT_REASONS.map((r) => <option key={r} value={r}>{humanize(r)}</option>)}
              </Select>
            </Field>
          )}

          {(kind === "issues" || kind === "adjustments") && lookups.canAuthoriseNegative && (
            <div className="md:col-span-3 rounded-md border border-amber-200 bg-amber-50 p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-amber-900">
                <input type="checkbox" className="size-4" checked={!!h.allow_negative} onChange={(e) => set("allow_negative", e.target.checked)} />
                Authorise negative stock for this document (management only)
              </label>
              {h.allow_negative && kind === "issues" && (
                <Input className="mt-2" placeholder="Reason for authorising negative stock (required)" value={h.negative_reason ?? ""}
                  onChange={(e) => set("negative_reason", e.target.value)} maxLength={500} />
              )}
            </div>
          )}

          <Field label={kind === "adjustments" && h.reason === "other" ? "Notes (required)" : "Notes"} htmlFor="notes" className="md:col-span-3">
            <Textarea id="notes" rows={2} value={h.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={2000} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Items</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, newLine()])}><Plus /> Add item</Button>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-3 py-2 text-left">#</th>
                <th className="min-w-[280px] px-3 py-2 text-left">Product</th>
                {kind !== "receipts" && <th className="px-3 py-2 text-right">{kind === "transfers" ? "Available at source" : "Available / physical"}</th>}
                {kind === "adjustments" ? (
                  <>
                    <th className="px-3 py-2 text-left">Method</th>
                    <th className="w-36 px-3 py-2 text-right">Quantity</th>
                    {lookups.canViewValuation && <th className="w-36 px-3 py-2 text-right">Unit cost (AED)</th>}
                  </>
                ) : <th className="w-32 px-3 py-2 text-right">Quantity</th>}
                {kind === "receipts" && <th className="w-36 px-3 py-2 text-right">Unit cost ({h.currency_code})</th>}
                {kind === "receipts" && <th className="min-w-[220px] px-3 py-2 text-left">For customer order</th>}
                <th className="min-w-[160px] px-3 py-2 text-left">Notes</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l, i) => {
                const a = l.product ? avail[l.product.id] : undefined;
                return (
                  <tr key={l.key} className="align-top">
                    <td className="px-3 py-2 pt-4 text-slate-400">{i + 1}</td>
                    <td className="px-3 py-2"><ProductPicker value={l.product} onChange={(p) => setLine(l.key, { product: p, sales_order_line_id: "" })} /></td>
                    {kind !== "receipts" && (
                      <td className="whitespace-nowrap px-3 py-2 pt-4 text-right tabular-nums text-slate-600">
                        {l.product ? (a ? <>{formatQty(a.available)} <span className="text-slate-400">/ {formatQty(a.physical)}</span></> : "0") : "—"}
                        {l.product && <span className="ml-1 text-xs text-slate-400">{l.product.uom}</span>}
                      </td>
                    )}
                    {kind === "adjustments" ? (
                      <>
                        <td className="px-3 py-2">
                          <Select value={l.mode} onChange={(e) => setLine(l.key, { mode: e.target.value as DocLine["mode"] })} className="w-40">
                            <option value="change">Add / remove (±)</option>
                            <option value="count">Set counted qty</option>
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          {l.mode === "change"
                            ? <Input type="number" step="0.001" className="text-right" placeholder="e.g. -3" value={l.qty_change} onChange={(e) => setLine(l.key, { qty_change: e.target.value })} />
                            : <Input type="number" step="0.001" min="0" className="text-right" placeholder="Counted" value={l.counted_qty} onChange={(e) => setLine(l.key, { counted_qty: e.target.value })} />}
                        </td>
                        {lookups.canViewValuation && (
                          <td className="px-3 py-2">
                            <Input type="number" step="0.0001" min="0" className="text-right" placeholder="Avg cost" value={l.unit_cost_base}
                              onChange={(e) => setLine(l.key, { unit_cost_base: e.target.value })} title="Only used when stock is added. Leave blank to use the current average cost." />
                          </td>
                        )}
                      </>
                    ) : (
                      <td className="px-3 py-2">
                        <Input type="number" step="0.001" min="0" className="text-right" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                      </td>
                    )}
                    {kind === "receipts" && (
                      <td className="px-3 py-2">
                        <Input type="number" step="0.0001" min="0" className="text-right" value={l.unit_cost} onChange={(e) => setLine(l.key, { unit_cost: e.target.value })} />
                      </td>
                    )}
                    {kind === "receipts" && (
                      <td className="px-3 py-2">
                        <Select value={l.sales_order_line_id} onChange={(e) => setLine(l.key, { sales_order_line_id: e.target.value })} disabled={!l.product}>
                          <option value="">Stock (no order)</option>
                          {(l.product ? procureOptions[l.product.id] ?? [] : []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </Select>
                      </td>
                    )}
                    <td className="px-3 py-2"><Input value={l.notes} onChange={(e) => setLine(l.key, { notes: e.target.value })} maxLength={500} /></td>
                    <td className="px-1 py-2">
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove item" disabled={lines.length === 1}
                        onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 /></Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {kind === "receipts" && (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            Linking an item to a customer order reserves the received quantity for that order immediately.
          </p>
        )}
        {kind === "adjustments" && (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
            Counted quantities are compared with the physical stock at the moment of approval. Stock reserved for customer orders cannot be adjusted away.
          </p>
        )}
      </Card>

      <div className="flex justify-end gap-2">
        <Link href={initial?.header.id ? `/inventory/${kind}/${initial.header.id}` : `/inventory/${kind}`} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Save draft</Button>
      </div>
    </div>
  );
}
