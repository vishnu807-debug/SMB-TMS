"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { createRequisition } from "@/app/(app)/procurement/actions";
import { ProductPicker, type PickedProduct } from "@/components/inventory/product-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

type Line = { key: string; product: PickedProduct | null; qty: string; supplier_id: string };
const blank = (): Line => ({ key: crypto.randomUUID(), product: null, qty: "", supplier_id: "" });

export function RequisitionForm({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [requiredDate, setRequiredDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const setLine = (k: string, p: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));

  const submit = () => start(async () => {
    setError(null);
    const r = await createRequisition({ required_date: requiredDate, notes,
      lines: lines.filter((l) => l.product).map((l) => ({ product_id: l.product!.id, qty: l.qty, supplier_id: l.supplier_id })) });
    if (!r.ok) return setError(r.error);
    router.push(`/procurement/requisitions/${r.data!.id}`);
  });

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Required by" htmlFor="required_date"><Input id="required_date" type="date" value={requiredDate} onChange={(e) => setRequiredDate(e.target.value)} /></Field>
          <Field label="Notes" htmlFor="notes" className="md:col-span-2"><Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Items</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setLines([...lines, blank()])}><Plus /> Add item</Button></CardHeader>
        <CardContent className="space-y-3">
          {lines.map((l) => (
            <div key={l.key} className="grid items-end gap-3 md:grid-cols-[2fr_120px_1.2fr_auto]">
              <Field label="Product"><ProductPicker value={l.product} stockOnly={false} onChange={(p) => setLine(l.key, { product: p })} /></Field>
              <Field label="Quantity"><Input type="number" min="0" step="0.001" className="text-right" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} /></Field>
              <Field label="Suggested supplier">
                <Select value={l.supplier_id} onChange={(e) => setLine(l.key, { supplier_id: e.target.value })}>
                  <option value="">Product default</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              <Button variant="ghost" size="icon" aria-label="Remove" disabled={lines.length === 1} onClick={() => setLines(lines.filter((x) => x.key !== l.key))}><Trash2 /></Button>
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Link href="/procurement" className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <Button onClick={submit} disabled={busy}>{busy && <Loader2 className="animate-spin" />} Raise requisition</Button>
      </div>
    </div>
  );
}
