import type { Metadata } from "next";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { BankForm, BankToggle, CompanyForm, EinvoicingForm, RateForm, RuleForm } from "./settings-forms";
import { formatDate, humanize } from "@/lib/utils";
import { getBranding } from "@/lib/branding";
import { BrandingForm } from "@/components/settings/branding-form";

export const metadata: Metadata = { title: "System settings" };
const RULE_MODULE: Record<string, string> = { quotation: "sales", sales_order: "sales", purchase_order: "procurement", supplier_bill: "finance", expense: "finance", stock_adjustment: "inventory" };
const UNITS: Record<string, string> = { max_discount_pct: "%", margin_pct: "%", price_variance_pct: "%", total_base: "AED", credit_exceeded: "" };

export default async function SettingsPage() {
  const user = await requirePermission(["settings.manage", "payable.approve"]);
  const supabase = await createClient();
  const [{ data: s }, { data: rates }, { data: rules }, { data: banks }, { data: cur }, { data: modules }] = await Promise.all([
    supabase.from("company_settings").select("*").single(),
    supabase.from("exchange_rates").select("id, currency_code, rate_date, rate_to_base").order("rate_date", { ascending: false }).limit(30),
    supabase.from("approval_rules").select("id, doc_type, name, metric, comparison, threshold, approver_permission, is_active").order("doc_type"),
    supabase.from("bank_accounts").select("id, name, kind, bank_name, iban, currency_code, is_active").order("name"),
    supabase.from("currencies").select("code").eq("is_active", true).order("code"),
    supabase.from("system_modules").select("code, name, description, is_core, is_enabled, requires, changed_at").order("sort_order"),
  ]);
  const manage = can(user, "settings.manage");
  const { data: canBrand } = await supabase.rpc("can_edit_branding");
  const base = s?.base_currency ?? "AED";
  const currencies = (cur ?? []).map((c) => c.code);
  const configured = !!process.env.EINVOICE_ASP_URL && !!process.env.EINVOICE_ASP_API_KEY;
  return (
    <>
      <PageHeader title="System settings" description="Company details printed on documents, licensed modules, exchange rates, approval limits and bank accounts." />
      <div className="space-y-6">
        <Card><CardHeader><CardTitle>Company</CardTitle></CardHeader><CardContent><CompanyForm s={s ?? {}} disabled={!manage} /></CardContent></Card>
        {canBrand === true && (
          <Card><CardHeader><CardTitle>Login screen and logos</CardTitle><span className="text-xs text-slate-500">Super Administrator only</span></CardHeader>
            <CardContent><BrandingForm initial={await getBranding()} vendor={user.isPlatformAdmin} /></CardContent></Card>
        )}
        {user.modules.has("einvoicing") && (
          <Card><CardHeader><CardTitle>UAE e-invoicing</CardTitle></CardHeader><CardContent><EinvoicingForm s={s ?? {}} disabled={!manage} configured={configured} /></CardContent></Card>
        )}
        {manage && (
          <Card>
            <CardHeader><CardTitle>Licensed modules</CardTitle><span className="text-xs text-slate-500">Activated by your system provider</span></CardHeader>
            <Table>
              <THead><TR><TH>Module</TH><TH>What it covers</TH><TH>Needs</TH><TH>Status</TH></TR></THead>
              <TBody>
                {(modules ?? []).map((m) => (
                  <TR key={m.code}><TD className="font-medium">{m.name}</TD><TD className="max-w-md text-slate-600">{m.description}</TD>
                    <TD>{m.requires.length ? m.requires.map((r: string) => modules?.find((x) => x.code === r)?.name ?? r).join(", ") : "—"}</TD>
                    <TD><StatusBadge status={m.is_core ? "active" : m.is_enabled ? "active" : "inactive"} />{m.changed_at && <p className="text-xs text-slate-500">since {formatDate(m.changed_at)}</p>}</TD></TR>
                ))}
              </TBody>
            </Table>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle>Approval limits</CardTitle></CardHeader>
          <Table>
            <THead><TR><TH>Document</TH><TH>Rule</TH><TH>Approver needs</TH><TH className="text-right">Limit</TH></TR></THead>
            <TBody>
              {(rules ?? []).filter((r) => user.modules.has(RULE_MODULE[r.doc_type] ?? "core")).map((r) => (
                <TR key={r.id}><TD>{humanize(r.doc_type)}</TD><TD>{r.name}</TD><TD className="font-mono text-xs">{r.approver_permission}</TD>
                  <TD>{r.metric === "credit_exceeded" ? <span className="block text-right text-xs text-slate-500">Always when over the credit limit</span>
                    : <RuleForm rule={{ id: r.id, threshold: Number(r.threshold), is_active: r.is_active }} disabled={!manage} unit={UNITS[r.metric] ?? ""} />}</TD></TR>
              ))}
            </TBody>
          </Table>
        </Card>
        <Card>
          <CardHeader><CardTitle>Exchange rates to {base}</CardTitle></CardHeader>
          {manage && <CardContent className="border-b border-slate-100"><RateForm currencies={currencies} base={base} /></CardContent>}
          <Table>
            <THead><TR><TH>Currency</TH><TH>Date</TH><TH numeric>1 unit = {base}</TH></TR></THead>
            <TBody>
              {(rates ?? []).length === 0 && <EmptyRow colSpan={3}>No rates.</EmptyRow>}
              {(rates ?? []).map((r) => <TR key={r.id}><TD>{r.currency_code}</TD><TD>{formatDate(r.rate_date)}</TD><TD numeric>{Number(r.rate_to_base)}</TD></TR>)}
            </TBody>
          </Table>
        </Card>
        {user.modules.has("finance") && (
        <Card>
          <CardHeader><CardTitle>Bank and cash accounts</CardTitle></CardHeader>
          {can(user, "payable.approve") && <CardContent className="border-b border-slate-100"><BankForm currencies={currencies} base={base} /></CardContent>}
          <Table>
            <THead><TR><TH>Name</TH><TH>Type</TH><TH>Bank</TH><TH>IBAN</TH><TH>Currency</TH><TH>Status</TH><TH /></TR></THead>
            <TBody>
              {(banks ?? []).length === 0 && <EmptyRow colSpan={7}>No accounts yet — add one before recording payments.</EmptyRow>}
              {(banks ?? []).map((b) => (
                <TR key={b.id}><TD className="font-medium">{b.name}</TD><TD>{humanize(b.kind)}</TD><TD>{b.bank_name ?? "—"}</TD><TD className="font-mono text-xs">{b.iban ?? "—"}</TD>
                  <TD>{b.currency_code}</TD><TD><StatusBadge status={b.is_active ? "active" : "inactive"} /></TD>
                  <TD className="text-right">{can(user, "payable.approve") && <BankToggle id={b.id} active={b.is_active} />}</TD></TR>
              ))}
            </TBody>
          </Table>
        </Card>
        )}
      </div>
    </>
  );
}
