"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { openInvoices, recordPayment } from "@/app/(app)/payments/actions";
import { AllocationTable, type OpenItem } from "./allocation-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export const METHODS = [["bank_transfer", "Bank transfer"], ["cheque", "Cheque"], ["pdc", "Post-dated cheque"], ["cash", "Cash"], ["card", "Card"], ["other", "Other"]] as const;

export function PaymentForm({ customers, banks, currencies, baseCurrency, initial }: {
  customers: { id: string; name: string; currency_code: string }[]; banks: { id: string; name: string; currency_code: string }[];
  currencies: { code: string }[]; baseCurrency: string; initial?: { customer_id?: string; invoice_id?: string };
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [h, setH] = useState<Record<string, string>>({ customer_id: initial?.customer_id ?? "", payment_date: today, method: "bank_transfer",
    bank_account_id: banks[0]?.id ?? "", currency_code: customers.find((c) => c.id === initial?.customer_id)?.currency_code ?? baseCurrency, amount: "", reference: "", cheque_date: "", exchange_rate: "", notes: "" });
  const [items, setItems] = useState<OpenItem[]>([]);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: string, v: string) => setH((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!h.customer_id) { setItems([]); return; }
    openInvoices(h.customer_id).then((rows) => {
      const list = rows.map((r: any) => ({ ...r, total: Number(r.total), balance: Number(r.balance) }));
      setItems(list);
      const pre = list.find((r) => r.id === initial?.invoice_id);
      if (pre) { setAlloc({ [pre.id]: pre.balance.toFixed(2) }); setH((x) => ({ ...x, amount: x.amount || pre.balance.toFixed(2), currency_code: pre.currency_code })); }
    });
  }, [h.customer_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => start(async () => {
    setError(null);
    const r = await recordPayment({ ...h, exchange_rate: h.currency_code === baseCurrency ? "" : h.exchange_rate,
      bank_account_id: ["cash", "other"].includes(h.method) ? h.bank_account_id || "" : h.bank_account_id,
      allocations: Object.entries(alloc).map(([invoice_id, amount]) => ({ invoice_id, amount: amount || 0 })) });
    if (!r.ok) return setError(r.error);
    router.push(`/payments/${r.data!.id}`);
  });

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Receipt</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Customer" required className="md:col-span-2">
            <Select value={h.customer_id} onChange={(e) => { const c = customers.find((x) => x.id === e.target.value); setAlloc({}); setH((x) => ({ ...x, customer_id: e.target.value, currency_code: c?.currency_code ?? x.currency_code })); }}>
              <option value="">Select customer…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Date received" required><Input type="date" max={today} value={h.payment_date} onChange={(e) => set("payment_date", e.target.value)} /></Field>
          <Field label="Method" required>
            <Select value={h.method} onChange={(e) => set("method", e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </Field>
          <Field label={["cash", "other"].includes(h.method) ? "Deposited to (optional)" : "Bank account"} required={!["cash", "other"].includes(h.method)}>
            <Select value={h.bank_account_id} onChange={(e) => set("bank_account_id", e.target.value)}>
              <option value="">—</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency_code})</option>)}
            </Select>
          </Field>
          <Field label={h.method === "cheque" || h.method === "pdc" ? "Cheque no." : "Reference"} required={h.method === "cheque" || h.method === "pdc"}>
            <Input value={h.reference} onChange={(e) => set("reference", e.target.value)} maxLength={80} />
          </Field>
          {(h.method === "cheque" || h.method === "pdc") && <Field label="Cheque date"><Input type="date" value={h.cheque_date} onChange={(e) => set("cheque_date", e.target.value)} /></Field>}
          <Field label="Currency">
            <Select value={h.currency_code} onChange={(e) => { setAlloc({}); set("currency_code", e.target.value); }}>{currencies.map((c) => <option key={c.code}>{c.code}</option>)}</Select>
          </Field>
          {h.currency_code !== baseCurrency && <Field label={`Rate (1 ${h.currency_code} = ? ${baseCurrency})`} hint="Blank = latest rate"><Input type="number" step="0.000001" min="0" value={h.exchange_rate} onChange={(e) => set("exchange_rate", e.target.value)} /></Field>}
          <Field label="Amount received" required><Input type="number" min="0" step="0.01" className="text-right" value={h.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
          <Field label="Notes" className="md:col-span-3"><Textarea rows={2} value={h.notes} onChange={(e) => set("notes", e.target.value)} maxLength={1000} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Apply to invoices</CardTitle></CardHeader>
        <AllocationTable items={items} currency={h.currency_code} amounts={alloc} onChange={setAlloc} available={Number(h.amount) || 0} link={(id) => `/invoices/${id}`} />
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">Any amount not applied stays on the receipt as an advance and can be allocated later.</p>
      </Card>
      <div className="flex justify-end"><Button onClick={submit} disabled={busy || !h.customer_id}>{busy && <Loader2 className="animate-spin" />} Record receipt</Button></div>
    </div>
  );
}
