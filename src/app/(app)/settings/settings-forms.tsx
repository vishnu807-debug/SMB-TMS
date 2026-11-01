"use client";
import { useActionState, useTransition } from "react";
import type { ActionResult } from "@/lib/errors";
import { addBankAccount, addExchangeRate, saveApprovalRule, saveCompany, saveEinvoicing, setBankAccountActive } from "./actions";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

function Result({ state }: { state?: ActionResult }) {
  if (!state) return null;
  return <Alert tone={state.ok ? "success" : "error"} className="md:col-span-3">{state.ok ? state.message ?? "Saved." : state.error}</Alert>;
}

export function CompanyForm({ s, disabled }: { s: Record<string, any>; disabled: boolean }) {
  const [state, action] = useActionState(saveCompany, undefined);
  const t = (name: string, label: string, props: Record<string, any> = {}) => (
    <Field label={label} className={props.className} hint={props.hint}><Input name={name} defaultValue={s[name] ?? ""} disabled={disabled} maxLength={props.max ?? 200} type={props.type} /></Field>
  );
  const area = (name: string, label: string, hint?: string) => (
    <Field label={label} hint={hint} className="md:col-span-3"><Textarea name={name} rows={4} defaultValue={s[name] ?? ""} disabled={disabled} maxLength={8000} /></Field>
  );
  return (
    <form action={action} className="grid gap-4 md:grid-cols-3">
      <Result state={state} />
      {t("legal_name", "Legal name", { className: "md:col-span-2" })}{t("trade_name", "Trade name")}
      {t("trn", "TRN", { max: 15, hint: "Printed on tax invoices" })}{t("phone", "Phone", { max: 40 })}{t("email", "Email", { type: "email" })}
      {t("address", "Address", { className: "md:col-span-2", max: 400 })}{t("city", "City", { max: 80 })}
      {t("website", "Website")}
      <Field label="Quotation validity (days)"><Input name="quotation_validity_days" type="number" min={1} max={365} defaultValue={s.quotation_validity_days} disabled={disabled} /></Field>
      {t("invoice_footer", "Invoice footer", { max: 300 })}
      <Field label="Bank details (printed on quotations and invoices)" className="md:col-span-3"><Textarea name="bank_details" rows={3} defaultValue={s.bank_details ?? ""} disabled={disabled} maxLength={1000} /></Field>
      {area("quotation_terms", "Standard quotation terms")}
      {area("purchase_order_terms", "Standard purchase order terms")}
      {area("invoice_terms", "Standard invoice terms")}
      {!disabled && <div className="md:col-span-3 flex justify-end"><SubmitButton>Save company settings</SubmitButton></div>}
    </form>
  );
}

export function EinvoicingForm({ s, disabled, configured }: { s: Record<string, any>; disabled: boolean; configured: boolean }) {
  const [state, action] = useActionState(saveEinvoicing, undefined);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-3">
      <Result state={state} />
      <Alert tone={configured ? "success" : "warning"} className="md:col-span-3">
        {configured ? "The connection to the service provider is configured on the server." :
          "The server has no service-provider credentials yet (EINVOICE_ASP_URL and EINVOICE_ASP_API_KEY). Invoices will wait in the queue until they are added."}
      </Alert>
      <label className="flex items-center gap-2 text-sm font-medium md:col-span-3">
        <input type="checkbox" name="einvoicing_enabled" defaultChecked={s.einvoicing_enabled} disabled={disabled} className="size-4" />
        Send every posted invoice and credit note through e-invoicing (PINT AE)
      </label>
      <Field label="Service provider (ASP)"><Input name="einvoice_provider" defaultValue={s.einvoice_provider ?? ""} disabled={disabled} maxLength={120} /></Field>
      <Field label="Peppol participant ID" hint="e.g. 0235:1XXXXXXXXXXXXXX — from your ASP"><Input name="einvoice_participant_id" defaultValue={s.einvoice_participant_id ?? ""} disabled={disabled} maxLength={80} /></Field>
      {!disabled && <div className="flex items-end justify-end"><SubmitButton>Save</SubmitButton></div>}
    </form>
  );
}

export function RateForm({ currencies, base }: { currencies: string[]; base: string }) {
  const [state, action] = useActionState(addExchangeRate, undefined);
  return (
    <form action={action} className="grid items-end gap-3 md:grid-cols-4">
      <Field label="Currency"><Select name="currency_code">{currencies.filter((c) => c !== base).map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <Field label="Date"><Input name="rate_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /></Field>
      <Field label={`1 unit = ? ${base}`}><Input name="rate_to_base" type="number" step="0.000001" min="0" /></Field>
      <SubmitButton>Add rate</SubmitButton>
      {state && <div className="md:col-span-4"><Result state={state} /></div>}
    </form>
  );
}

export function RuleForm({ rule, disabled, unit }: { rule: { id: string; threshold: number; is_active: boolean }; disabled: boolean; unit: string }) {
  const [state, action] = useActionState(saveApprovalRule, undefined);
  return (
    <form action={action} className="flex items-center justify-end gap-2">
      <input type="hidden" name="id" value={rule.id} />
      <Input name="threshold" type="number" step="0.01" min="0" defaultValue={rule.threshold} className="h-8 w-28 text-right" disabled={disabled} aria-label="Threshold" />
      <span className="w-10 text-xs text-slate-500">{unit}</span>
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="is_active" defaultChecked={rule.is_active} disabled={disabled} className="size-4" /> On</label>
      {!disabled && <SubmitButton size="sm" variant="outline" pendingText="…">Save</SubmitButton>}
      {state && !state.ok && <span className="text-xs text-red-600">{state.error}</span>}
    </form>
  );
}

export function BankForm({ currencies, base }: { currencies: string[]; base: string }) {
  const [state, action] = useActionState(addBankAccount, undefined);
  return (
    <form action={action} className="grid items-end gap-3 md:grid-cols-6">
      <Field label="Name" className="md:col-span-2"><Input name="name" placeholder="e.g. ENBD Current AED" maxLength={80} /></Field>
      <Field label="Type"><Select name="kind"><option value="bank">Bank</option><option value="cash">Cash / petty cash</option><option value="card">Card</option></Select></Field>
      <Field label="Bank"><Input name="bank_name" maxLength={80} /></Field>
      <Field label="IBAN"><Input name="iban" maxLength={34} /></Field>
      <Field label="Currency"><Select name="currency_code" defaultValue={base}>{currencies.map((c) => <option key={c}>{c}</option>)}</Select></Field>
      <input type="hidden" name="account_no" value="" />
      <div className="md:col-span-6 flex justify-end"><SubmitButton>Add account</SubmitButton></div>
      {state && <div className="md:col-span-6"><Result state={state} /></div>}
    </form>
  );
}

export function BankToggle({ id, active }: { id: string; active: boolean }) {
  const [busy, start] = useTransition();
  return <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => { await setBankAccountActive(id, !active); })}>{active ? "Deactivate" : "Activate"}</Button>;
}
