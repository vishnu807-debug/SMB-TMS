"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Upload } from "lucide-react";
import { saveExpense, setExpenseReceipt } from "@/app/(app)/expenses/actions";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { formatMoney } from "@/lib/utils";

export function ExpenseForm({ categories, initial }: { categories: { id: string; name: string }[]; initial?: Record<string, any> }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [h, setH] = useState<Record<string, any>>({ expense_date: today, category_id: "", paid_by: "employee", amount: "", vat_amount: "", ...initial });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const set = (k: string, v: any) => setH((x) => ({ ...x, [k]: v }));
  const vat5 = () => set("vat_amount", (Math.round(Number(h.amount || 0) * 5) / 100).toFixed(2));

  const submit = () => start(async () => {
    setError(null);
    const r = await saveExpense({ ...h, vat_amount: h.vat_amount || 0 });
    if (!r.ok) return setError(r.error);
    const id = r.data!.id;
    if (file) {
      if (file.size > 10 * 1024 * 1024) return setError("Saved, but the receipt file is larger than 10 MB.");
      const path = `expenses/${id}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
      const { error: up } = await createClient().storage.from("finance-docs").upload(path, file, { contentType: file.type });
      if (up) { setError(`Saved, but the receipt upload failed: ${up.message}`); return router.push(`/expenses/${id}`); }
      await setExpenseReceipt(id, path);
    }
    router.push(`/expenses/${id}`);
    router.refresh();
  });

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Expense</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Date" required><Input type="date" max={today} value={h.expense_date} onChange={(e) => set("expense_date", e.target.value)} /></Field>
          <Field label="Category" required>
            <Select value={h.category_id} onChange={(e) => set("category_id", e.target.value)}><option value="">Choose…</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </Field>
          <Field label="Paid by">
            <Select value={h.paid_by} onChange={(e) => set("paid_by", e.target.value)}><option value="employee">Me (reimburse me)</option><option value="company">Company card / petty cash</option></Select>
          </Field>
          <Field label="Description" required className="md:col-span-3"><Input value={h.description ?? ""} onChange={(e) => set("description", e.target.value)} maxLength={500} placeholder="What it was for" /></Field>
          <Field label="Vendor"><Input value={h.vendor_name ?? ""} onChange={(e) => set("vendor_name", e.target.value)} maxLength={120} /></Field>
          <Field label="Vendor TRN" hint="Needed to reclaim VAT"><Input value={h.vendor_trn ?? ""} onChange={(e) => set("vendor_trn", e.target.value)} maxLength={15} /></Field>
          <Field label="Receipt / invoice no."><Input value={h.receipt_no ?? ""} onChange={(e) => set("receipt_no", e.target.value)} maxLength={60} /></Field>
          <Field label="Amount before VAT (AED)" required><Input type="number" min="0" step="0.01" className="text-right" value={h.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
          <Field label="VAT (AED)">
            <div className="flex gap-2"><Input type="number" min="0" step="0.01" className="text-right" value={h.vat_amount} onChange={(e) => set("vat_amount", e.target.value)} />
              <Button type="button" variant="outline" onClick={vat5}>5%</Button></div>
          </Field>
          <div className="flex items-end pb-2 text-sm font-semibold">Total {formatMoney(Number(h.amount || 0) + Number(h.vat_amount || 0), "AED")}</div>
          <Field label="Receipt photo or PDF" className="md:col-span-2" hint={h.receipt_path ? "A receipt is attached; choose a file to replace it" : "JPG, PNG or PDF up to 10 MB"}>
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 text-sm text-slate-600 hover:bg-slate-50">
              <Upload className="size-4" /> {file ? file.name : "Choose file…"}
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </Field>
          <Field label="Notes" className="md:col-span-3"><Textarea rows={2} value={h.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={1000} /></Field>
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Link href={h.id ? `/expenses/${h.id}` : "/expenses"} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Save draft</Button>
      </div>
    </div>
  );
}
