"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Star, Trash2 } from "lucide-react";
import { saveSupplier } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

type Contact = { id?: string; name: string; designation?: string; email?: string; phone?: string; is_primary?: boolean };
export type SupplierValues = Record<string, any> & { contacts?: Contact[] };
export type SupplierLookups = { currencies: { code: string }[]; paymentTerms: { id: string; name: string }[]; baseCurrency: string };

export function SupplierForm({ lookups, initial }: { lookups: SupplierLookups; initial?: SupplierValues }) {
  const router = useRouter();
  const [v, setV] = useState<SupplierValues>(initial ?? { name: "", currency_code: lookups.baseCurrency, status: "active", lead_time_days: 0, country: "United Arab Emirates" });
  const [contacts, setContacts] = useState<Contact[]>(initial?.contacts?.length ? initial.contacts : [{ name: "", is_primary: true }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }));
  const setContact = (i: number, patch: Partial<Contact>) => setContacts((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const text = (k: string, label: string, props: Record<string, any> = {}) => (
    <Field label={label} htmlFor={k} required={props.required} hint={props.hint} className={props.className}>
      <Input id={k} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} maxLength={props.maxLength ?? 200} type={props.type} />
    </Field>
  );

  const submit = () => {
    setError(null);
    const payload = { ...v, contacts: contacts.filter((c) => c.name.trim()) };
    delete (payload as any).code;
    start(async () => {
      const res = await saveSupplier(payload);
      if (!res.ok) return setError(res.error);
      router.push(`/suppliers/${res.data!.id}`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      <Card>
        <CardHeader><CardTitle>Company</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {text("name", "Supplier name", { required: true, className: "md:col-span-2" })}
          <Field label="Status" htmlFor="status">
            <Select id="status" value={v.status} onChange={(e) => set("status", e.target.value)}>
              <option value="active">Active</option><option value="on_hold">On hold</option><option value="blocked">Blocked</option><option value="inactive">Inactive</option>
            </Select>
          </Field>
          {text("trn", "TRN (VAT number)", { hint: "15 digits, if VAT registered", maxLength: 20 })}
          {text("trade_license_no", "Trade licence no.", { maxLength: 60 })}
          {text("category", "Category", { hint: "e.g. Cables, Safety equipment", maxLength: 80 })}
          {text("email", "Email", { type: "email" })}
          {text("phone", "Phone", { maxLength: 40 })}
          {text("website", "Website")}
          {text("address", "Address", { className: "md:col-span-2", maxLength: 400 })}
          {text("city", "City", { maxLength: 80 })}
          {text("country", "Country", { maxLength: 80 })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Commercial terms</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Currency" htmlFor="currency_code" required>
            <Select id="currency_code" value={v.currency_code} onChange={(e) => set("currency_code", e.target.value)}>
              {lookups.currencies.map((c) => <option key={c.code}>{c.code}</option>)}
            </Select>
          </Field>
          <Field label="Payment terms" htmlFor="payment_term_id">
            <Select id="payment_term_id" value={v.payment_term_id ?? ""} onChange={(e) => set("payment_term_id", e.target.value)}>
              <option value="">—</option>
              {lookups.paymentTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Usual lead time (days)" htmlFor="lead_time_days">
            <Input id="lead_time_days" type="number" min={0} max={365} value={v.lead_time_days ?? 0} onChange={(e) => set("lead_time_days", e.target.value)} />
          </Field>
          <Field label="Bank details" htmlFor="bank_details" className="md:col-span-3" hint="Bank name, account name, IBAN, SWIFT — shown to Accounts when paying">
            <Textarea id="bank_details" rows={2} value={v.bank_details ?? ""} onChange={(e) => set("bank_details", e.target.value)} maxLength={1000} />
          </Field>
          <Field label="Notes" htmlFor="notes" className="md:col-span-3">
            <Textarea id="notes" rows={2} value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={4000} />
          </Field>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Contacts</CardTitle>
          <Button type="button" size="sm" variant="outline" onClick={() => setContacts([...contacts, { name: "" }])}><Plus /> Add contact</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {contacts.map((c, i) => (
            <div key={i} className="grid items-end gap-3 md:grid-cols-[1.4fr_1fr_1.4fr_1fr_auto_auto]">
              <Field label="Name"><Input value={c.name} onChange={(e) => setContact(i, { name: e.target.value })} maxLength={120} /></Field>
              <Field label="Designation"><Input value={c.designation ?? ""} onChange={(e) => setContact(i, { designation: e.target.value })} maxLength={80} /></Field>
              <Field label="Email"><Input type="email" value={c.email ?? ""} onChange={(e) => setContact(i, { email: e.target.value })} /></Field>
              <Field label="Phone"><Input value={c.phone ?? ""} onChange={(e) => setContact(i, { phone: e.target.value })} maxLength={40} /></Field>
              <Button type="button" variant={c.is_primary ? "secondary" : "ghost"} size="icon" title="Primary contact"
                onClick={() => setContacts(contacts.map((x, j) => ({ ...x, is_primary: j === i })))}>
                <Star className={c.is_primary ? "fill-amber-400 text-amber-500" : ""} />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Remove contact" onClick={() => setContacts(contacts.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          ))}
          {contacts.length === 0 && <p className="text-sm text-slate-500">No contacts.</p>}
        </CardContent>
      </Card>
      <div className="flex justify-end gap-2">
        <Link href={initial?.id ? `/suppliers/${initial.id}` : "/suppliers"} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Save supplier</Button>
      </div>
    </div>
  );
}
