"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { openBills, recordSupplierPayment } from "@/app/(app)/payables/actions";
import { AllocationTable, type OpenItem } from "./allocation-table";
import { METHODS } from "./payment-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export function SupplierPaymentForm({ suppliers, banks, currencies, baseCurrency, initial }: {
  suppliers: { id: string; name: string; currency_code: string; bank_details: string | null }[]; banks: { id: string; name: string; currency_code: string }[];
  currencies: { code: string }[]; baseCurrency: string; initial?: { supplier_id?: string; bill_id?: string };
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [h, setH] = useState<Record<string, string>>({ supplier_id: initial?.supplier_id ?? "", payment_date: today, method: "bank_transfer", bank_account_id: banks[0]?.id ?? "",
    currency_code: suppliers.find((s) => s.id === initial?.supplier_id)?.currency_code ?? baseCurrency, amount: "", reference: "", cheque_date: "", exchange_rate: "", notes: "" });
  const [items, setItems] = useState<OpenItem[]>([]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: string, v: string) => setH((x) => ({ ...x, [k]: v }));
  const supplier = suppliers.find((s) => s.id === h.supplier_id);

  useEffect(() => {
    if (!h.supplier_id) { setItems([]); return; }
    openBills(h.supplier_id).then((rows) => {
      const list = rows.map((r: any) => ({ ...r, total: Number(r.total), balance: Number(r.balance), ref: r.supplier_invoice_no }));
      setItems(list);
      const pre = list.find((r) => r.id === initial?.bill_id);
      if (pre) { setAlloc({ [pre.id]: pre.balance.toFixed(2) }); setH((x) => ({ ...x, amount: pre.balance.toFixed(2), currency_code: pre.currency_code })); }
    });
  }, [h.supplier_id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // amount follows allocations
    const sum = Object.values(alloc).reduce((a, v) => a + (Number(v) || 0), 0);
    if (sum > 0) set("amount", sum.toFixed(2));
  }, [alloc]);

  const submit = () => start(async () => {
    setError(null);
    const r = await recordSupplierPayment({ ...h, exchange_rate: h.currency_code === baseCurrency ? "" : h.exchange_rate,
      allocations: Object.entries(alloc).map(([bill_id, amount]) => ({ bill_id, amount: amount || 0 })) });
    if (!r.ok) return setError(r.error);
    router.push(`/payables/payments/${r.data!.id}`);
  });

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Payment</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Supplier" required className="md:col-span-2">
            <Select value={h.supplier_id} onChange={(e) => { const s = suppliers.find((x) => x.id === e.target.value); setAlloc({}); setH((x) => ({ ...x, supplier_id: e.target.value, currency_code: s?.currency_code ?? x.currency_code })); }}>
              <option value="">Select supplier…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Payment date" required><Input type="date" value={h.payment_date} onChange={(e) => set("payment_date", e.target.value)} /></Field>
          <Field label="Method"><Select value={h.method} onChange={(e) => set("method", e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Paid from" required={!["cash", "other"].includes(h.method)}>
            <Select value={h.bank_account_id} onChange={(e) => set("bank_account_id", e.target.value)}><option value="">—</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency_code})</option>)}</Select>
          </Field>
          <Field label={h.method === "cheque" || h.method === "pdc" ? "Cheque no." : "Reference"}><Input value={h.reference} onChange={(e) => set("reference", e.target.value)} maxLength={80} /></Field>
          {(h.method === "cheque" || h.method === "pdc") && <Field label="Cheque date"><Input type="date" value={h.cheque_date} onChange={(e) => set("cheque_date", e.target.value)} /></Field>}
          <Field label="Currency"><Select value={h.currency_code} onChange={(e) => { setAlloc({}); set("currency_code", e.target.value); }}>{currencies.map((c) => <option key={c.code}>{c.code}</option>)}</Select></Field>
          {h.currency_code !== baseCurrency && <Field label={`Rate (1 ${h.currency_code} = ? ${baseCurrency})`}><Input type="number" step="0.000001" min="0" value={h.exchange_rate} onChange={(e) => set("exchange_rate", e.target.value)} /></Field>}
          <Field label="Amount" required><Input type="number" min="0" step="0.01" className="text-right" value={h.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
          {supplier?.bank_details && <div className="rounded-md bg-slate-50 p-3 text-xs whitespace-pre-line text-slate-700 md:col-span-3"><p className="mb-1 font-medium">Supplier bank details</p>{supplier.bank_details}</div>}
          <Field label="Notes" className="md:col-span-3"><Textarea rows={2} value={h.notes} onChange={(e) => set("notes", e.target.value)} maxLength={1000} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Approved bills to settle</CardTitle></CardHeader>
        <AllocationTable items={items} currency={h.currency_code} amounts={alloc} onChange={setAlloc} available={Number(h.amount) || 0} link={(id) => `/payables/bills/${id}`} />
      </Card>
      <div className="flex justify-end"><Button onClick={submit} disabled={busy || !h.supplier_id}>{busy && <Loader2 className="animate-spin" />} Record payment</Button></div>
    </div>
  );
}
