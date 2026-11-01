"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Star, Trash2 } from "lucide-react";
import { checkDuplicates, saveCustomer } from "./actions";
import type { SalesLookups } from "@/lib/sales";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

type Contact = { id?: string; name: string; designation?: string; email?: string; phone?: string; mobile?: string; is_primary?: boolean };
type Address = { id?: string; kind: "billing" | "shipping"; label?: string; line1: string; line2?: string; city: string; emirate?: string; country?: string; po_box?: string; is_default?: boolean };
export type CustomerValues = Record<string, any> & { contacts?: Contact[]; addresses?: Address[] };

const EMIRATES = ["Abu Dhabi", "Dubai", "Sharjah", "Ajman", "Umm Al Quwain", "Ras Al Khaimah", "Fujairah"];

export function CustomerForm({ lookups, initial, perms, currentUserId }: {
  lookups: SalesLookups; initial?: CustomerValues; currentUserId: string;
  perms: { setCredit: boolean; assign: boolean };
}) {
  const router = useRouter();
  const [v, setV] = useState<CustomerValues>(initial ?? {
    name: "", customer_type: "company", vat_registered: false, currency_code: lookups.baseCurrency, status: "active",
    account_manager_id: currentUserId, credit_limit: 0,
  });
  const [contacts, setContacts] = useState<Contact[]>(initial?.contacts?.length ? initial.contacts : [{ name: "", is_primary: true }]);
  const [addresses, setAddresses] = useState<Address[]>(initial?.addresses?.length ? initial.addresses
    : [{ kind: "billing", line1: "", city: "", emirate: "Dubai", country: "United Arab Emirates", is_default: true }]);
  const [dupes, setDupes] = useState<{ id: string; code: string; name: string; match_reason: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }));

  // Warn about likely duplicates while typing (the database also blocks duplicate TRNs).
  useEffect(() => {
    const t = setTimeout(async () => setDupes(await checkDuplicates(v.name ?? "", v.trn ?? "", v.email ?? "", initial?.id)), 400);
    return () => clearTimeout(t);
  }, [v.name, v.trn, v.email, initial?.id]);

  const submit = () => {
    setError(null);
    const clean = (o: Record<string, any>) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, x === null ? undefined : x]));
    const payload = {
      ...clean(v), credit_limit: Number(v.credit_limit ?? 0),
      contacts: contacts.filter((c) => c.name.trim()).map(clean),
      addresses: addresses.filter((a) => a.line1.trim() || a.city.trim()).map(clean),
    };
    start(async () => {
      const res = await saveCustomer(payload);
      if (!res.ok) return setError(res.error);
      router.push(`/customers/${res.data!.id}`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}
      {dupes.length > 0 && (
        <Alert tone="warning">
          Possible duplicate: {dupes.map((d, i) => (
            <span key={d.id}>{i > 0 && ", "}<Link href={`/customers/${d.id}`} className="font-medium underline" target="_blank">{d.name} ({d.code})</Link> — {d.match_reason.toLowerCase()}</span>
          ))}
        </Alert>
      )}
      <Card>
        <CardHeader><CardTitle>Company</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="Company name" htmlFor="name" required className="md:col-span-2">
            <Input id="name" value={v.name ?? ""} onChange={(e) => set("name", e.target.value)} maxLength={200} />
          </Field>
          <Field label="Type" htmlFor="customer_type">
            <Select id="customer_type" value={v.customer_type} onChange={(e) => set("customer_type", e.target.value)}>
              <option value="company">Company</option><option value="government">Government entity</option><option value="individual">Individual</option>
            </Select>
          </Field>
          <Field label="Trade licence no." htmlFor="tl"><Input id="tl" value={v.trade_license_no ?? ""} onChange={(e) => set("trade_license_no", e.target.value)} /></Field>
          <Field label="Industry" htmlFor="industry"><Input id="industry" value={v.industry ?? ""} onChange={(e) => set("industry", e.target.value)} /></Field>
          <Field label="Source" htmlFor="source" hint="How they found us"><Input id="source" value={v.source ?? ""} onChange={(e) => set("source", e.target.value)} /></Field>
          <Field label="Email" htmlFor="email"><Input id="email" type="email" value={v.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Phone" htmlFor="phone"><Input id="phone" value={v.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Website" htmlFor="website"><Input id="website" value={v.website ?? ""} onChange={(e) => set("website", e.target.value)} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>VAT and commercial terms</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <Field label="VAT registered" htmlFor="vat">
            <label className="flex h-9 items-center gap-2 text-sm">
              <input id="vat" type="checkbox" className="size-4" checked={!!v.vat_registered} onChange={(e) => set("vat_registered", e.target.checked)} /> Customer is VAT registered
            </label>
          </Field>
          <Field label="TRN" htmlFor="trn" hint="15 digits" required={!!v.vat_registered}>
            <Input id="trn" inputMode="numeric" value={v.trn ?? ""} onChange={(e) => set("trn", e.target.value.replace(/\D/g, "").slice(0, 15))} className="font-mono" />
          </Field>
          <Field label="Default VAT treatment" htmlFor="tax" hint="E.g. zero-rated for exports">
            <Select id="tax" value={v.default_tax_code_id ?? ""} onChange={(e) => set("default_tax_code_id", e.target.value)}>
              <option value="">Use product's VAT category</option>
              {lookups.taxCodes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Currency" htmlFor="currency">
            <Select id="currency" value={v.currency_code} onChange={(e) => set("currency_code", e.target.value)}>
              {lookups.currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
            </Select>
          </Field>
          <Field label="Payment terms" htmlFor="pt">
            <Select id="pt" value={v.payment_term_id ?? ""} onChange={(e) => set("payment_term_id", e.target.value)}>
              <option value="">— Not set —</option>
              {lookups.paymentTerms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="Delivery terms" htmlFor="dt">
            <Select id="dt" value={v.delivery_term_id ?? ""} onChange={(e) => set("delivery_term_id", e.target.value)}>
              <option value="">— Not set —</option>
              {lookups.deliveryTerms.map((t) => <option key={t.id} value={t.id}>{t.code} — {t.name}</option>)}
            </Select>
          </Field>
          <Field label="Credit limit (AED)" htmlFor="credit" hint={perms.setCredit ? "0 = no credit check" : "Set by Accounts"}>
            <Input id="credit" type="number" min="0" step="100" value={v.credit_limit ?? 0} disabled={!perms.setCredit} onChange={(e) => set("credit_limit", e.target.value)} />
          </Field>
          <Field label="Sales representative" htmlFor="rep">
            <Select id="rep" value={v.account_manager_id ?? ""} disabled={!perms.assign} onChange={(e) => set("account_manager_id", e.target.value)}>
              {lookups.reps.map((r) => <option key={r.id} value={r.id}>{r.full_name || r.email}</option>)}
            </Select>
          </Field>
          <Field label="Status" htmlFor="status" hint={perms.setCredit ? undefined : "Hold/block is set by Accounts"}>
            <Select id="status" value={v.status} onChange={(e) => set("status", e.target.value)}>
              <option value="active">Active</option>
              <option value="on_hold" disabled={!perms.setCredit}>On hold</option>
              <option value="blocked" disabled={!perms.setCredit}>Blocked</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contacts</CardTitle>
          <Button type="button" size="sm" variant="outline" onClick={() => setContacts([...contacts, { name: "", is_primary: contacts.length === 0 }])}><Plus /> Add contact</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {contacts.map((c, i) => (
            <div key={c.id ?? i} className="grid gap-2 rounded-md border border-slate-200 p-3 md:grid-cols-12">
              <Input className="md:col-span-3" placeholder="Name" value={c.name} onChange={(e) => setContacts(contacts.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
              <Input className="md:col-span-2" placeholder="Designation" value={c.designation ?? ""} onChange={(e) => setContacts(contacts.map((x, j) => j === i ? { ...x, designation: e.target.value } : x))} />
              <Input className="md:col-span-3" type="email" placeholder="Email" value={c.email ?? ""} onChange={(e) => setContacts(contacts.map((x, j) => j === i ? { ...x, email: e.target.value } : x))} />
              <Input className="md:col-span-2" placeholder="Mobile" value={c.mobile ?? ""} onChange={(e) => setContacts(contacts.map((x, j) => j === i ? { ...x, mobile: e.target.value } : x))} />
              <div className="flex items-center justify-end gap-1 md:col-span-2">
                <Button type="button" size="sm" variant={c.is_primary ? "secondary" : "ghost"} title="Primary contact"
                  onClick={() => setContacts(contacts.map((x, j) => ({ ...x, is_primary: j === i })))}><Star className={c.is_primary ? "fill-amber-400 text-amber-500" : ""} />{c.is_primary ? "Primary" : ""}</Button>
                <Button type="button" size="icon" variant="ghost" aria-label="Remove contact" onClick={() => setContacts(contacts.filter((_, j) => j !== i))}><Trash2 /></Button>
              </div>
            </div>
          ))}
          {contacts.length === 0 && <p className="text-sm text-slate-500">No contacts.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Addresses</CardTitle>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setAddresses([...addresses, { kind: "billing", line1: "", city: "", country: "United Arab Emirates" }])}><Plus /> Billing</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setAddresses([...addresses, { kind: "shipping", line1: "", city: "", country: "United Arab Emirates" }])}><Plus /> Delivery</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {addresses.map((a, i) => {
            const upd = (patch: Partial<Address>) => setAddresses(addresses.map((x, j) => j === i ? { ...x, ...patch } : x));
            return (
              <div key={a.id ?? i} className="grid gap-2 rounded-md border border-slate-200 p-3 md:grid-cols-6">
                <div className="flex items-center gap-2 md:col-span-6">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{a.kind === "billing" ? "Billing" : "Delivery"}</span>
                  <Input placeholder="Label (e.g. Head office, Site A)" value={a.label ?? ""} onChange={(e) => upd({ label: e.target.value })} className="h-8 max-w-xs" />
                  <label className="ml-auto flex items-center gap-1.5 text-sm">
                    <input type="radio" name={`default-${a.kind}`} checked={!!a.is_default}
                      onChange={() => setAddresses(addresses.map((x) => x.kind === a.kind ? { ...x, is_default: x === a } : x))} /> Default
                  </label>
                  <Button type="button" size="icon" variant="ghost" aria-label="Remove address" onClick={() => setAddresses(addresses.filter((_, j) => j !== i))}><Trash2 /></Button>
                </div>
                <Input className="md:col-span-3" placeholder="Address line 1" value={a.line1} onChange={(e) => upd({ line1: e.target.value })} />
                <Input className="md:col-span-3" placeholder="Address line 2" value={a.line2 ?? ""} onChange={(e) => upd({ line2: e.target.value })} />
                <Input className="md:col-span-2" placeholder="City / area" value={a.city} onChange={(e) => upd({ city: e.target.value })} />
                <Select className="md:col-span-2" value={a.emirate ?? ""} onChange={(e) => upd({ emirate: e.target.value })}>
                  <option value="">Emirate / region</option>{EMIRATES.map((em) => <option key={em}>{em}</option>)}
                </Select>
                <Input placeholder="P.O. Box" value={a.po_box ?? ""} onChange={(e) => upd({ po_box: e.target.value })} />
                <Input placeholder="Country" value={a.country ?? ""} onChange={(e) => upd({ country: e.target.value })} />
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
        <CardContent><Textarea value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value)} rows={3} /></CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Link href={initial?.id ? `/customers/${initial.id}` : "/customers"} className={buttonVariants({ variant: "outline" })}>Cancel</Link>
        <Button onClick={submit} disabled={saving}>{saving && <Loader2 className="animate-spin" />}{initial?.id ? "Save changes" : "Create customer"}</Button>
      </div>
    </div>
  );
}
