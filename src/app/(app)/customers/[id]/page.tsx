import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FilePlus, Pencil } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadActivities } from "@/lib/activities";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, StatCard } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ActivityPanel } from "@/components/sales/activity-panel";
import { formatDate, formatMoney, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("customer.view");
  const supabase = await createClient();
  const { data: c } = await supabase.from("customers")
    .select("*, rep:profiles!customers_account_manager_id_fkey(full_name), terms:payment_terms(name), dterms:delivery_terms(code, name), tax:tax_codes(name), contacts:customer_contacts(*), addresses:customer_addresses(*)")
    .eq("id", id).maybeSingle();
  if (!c) notFound();

  const [{ data: credit }, { data: quotes }, { data: orders }, { data: leads }, activities] = await Promise.all([
    supabase.rpc("customer_credit_summary", { p_customer_id: id }).maybeSingle(),
    supabase.from("quotations").select("id, doc_no, quotation_date, valid_until, status, total, currency_code").eq("customer_id", id).neq("status", "superseded").order("quotation_date", { ascending: false }).limit(10),
    supabase.from("sales_orders").select("id, doc_no, order_date, status, total, currency_code, customer_po_ref").eq("customer_id", id).order("order_date", { ascending: false }).limit(10),
    supabase.from("leads").select("id, doc_no, title, stage, estimated_value, currency_code").eq("customer_id", id).order("created_at", { ascending: false }).limit(10),
    loadActivities({ customer_id: id }),
  ]);
  const cr: any = credit;

  return (
    <>
      <PageHeader
        back={{ href: "/customers", label: "Customers" }}
        title={<span className="flex items-center gap-3">{c.name} <StatusBadge status={c.status} /></span>}
        description={<span><span className="font-mono">{c.code}</span> · {humanize(c.customer_type)} · Sales rep: {c.rep?.full_name ?? "—"}</span>}
        actions={<>
          {can(user, "quotation.create") && c.status === "active" && <Link href={`/quotations/new?customer=${c.id}`} className={buttonVariants({ variant: "outline" })}><FilePlus /> New quotation</Link>}
          {can(user, "customer.edit") && <Link href={`/customers/${c.id}/edit`} className={buttonVariants()}><Pencil /> Edit</Link>}
        </>}
      />
      {c.status !== "active" && <Alert tone="warning" className="mb-4">This customer is {humanize(c.status).toLowerCase()}; new quotations and orders are restricted.</Alert>}

      {cr && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <StatCard label="Credit limit" value={Number(cr.credit_limit) > 0 ? formatMoney(cr.credit_limit) : "No limit"} hint="AED" />
          <StatCard label="Open orders" value={formatMoney(cr.open_orders)} hint="Not yet invoiced" />
          <StatCard label="Available credit" value={cr.available === null ? "—" : formatMoney(cr.available)} tone={cr.available !== null && Number(cr.available) < 0 ? "danger" : "default"} />
          <StatCard label="Open quotations" value={formatMoney(cr.open_quotes)} />
          <StatCard label="Orders this year" value={formatMoney(cr.orders_ytd)} hint={cr.last_order_date ? `Last ${formatDate(cr.last_order_date)}` : "No orders yet"} />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader><CardTitle>Company details</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ["TRN", c.trn ? <span className="font-mono">{c.trn}</span> : "—"], ["VAT registered", c.vat_registered ? "Yes" : "No"],
                  ["Default VAT", c.tax?.name ?? "Per product"], ["Trade licence", c.trade_license_no ?? "—"],
                  ["Payment terms", c.terms?.name ?? "—"], ["Delivery terms", c.dterms ? `${c.dterms.code} — ${c.dterms.name}` : "—"],
                  ["Currency", c.currency_code], ["Email", c.email ?? "—"], ["Phone", c.phone ?? "—"],
                  ["Website", c.website ?? "—"], ["Industry", c.industry ?? "—"], ["Source", c.source ?? "—"],
                ].map(([k, v]) => (
                  <div key={k as string}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-slate-900">{v}</dd></div>
                ))}
              </dl>
              {c.notes && <p className="mt-4 whitespace-pre-line border-t border-slate-100 pt-3 text-sm text-slate-700">{c.notes}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Quotations</CardTitle>{can(user, "quotation.view") && <Link href={`/quotations?customer=${c.id}`} className="text-sm text-navy-700 hover:underline">All</Link>}</CardHeader>
            <Table>
              <THead><TR><TH>Number</TH><TH>Date</TH><TH>Valid until</TH><TH numeric>Total</TH><TH>Status</TH></TR></THead>
              <TBody>
                {(quotes ?? []).length === 0 && <EmptyRow colSpan={5}>No quotations.</EmptyRow>}
                {(quotes ?? []).map((q) => (
                  <TR key={q.id}>
                    <TD><Link href={`/quotations/${q.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{q.doc_no}</Link></TD>
                    <TD>{formatDate(q.quotation_date)}</TD><TD>{formatDate(q.valid_until)}</TD>
                    <TD numeric>{formatMoney(q.total, q.currency_code)}</TD><TD><StatusBadge status={q.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>

          <Card>
            <CardHeader><CardTitle>Sales orders</CardTitle></CardHeader>
            <Table>
              <THead><TR><TH>Number</TH><TH>Date</TH><TH>Customer PO</TH><TH numeric>Total</TH><TH>Status</TH></TR></THead>
              <TBody>
                {(orders ?? []).length === 0 && <EmptyRow colSpan={5}>No orders.</EmptyRow>}
                {(orders ?? []).map((o) => (
                  <TR key={o.id}>
                    <TD><Link href={`/sales-orders/${o.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{o.doc_no}</Link></TD>
                    <TD>{formatDate(o.order_date)}</TD><TD>{o.customer_po_ref ?? "—"}</TD>
                    <TD numeric>{formatMoney(o.total, o.currency_code)}</TD><TD><StatusBadge status={o.status} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>

          {(leads ?? []).length > 0 && (
            <Card>
              <CardHeader><CardTitle>Enquiries</CardTitle></CardHeader>
              <Table>
                <THead><TR><TH>Number</TH><TH>Title</TH><TH numeric>Est. value</TH><TH>Stage</TH></TR></THead>
                <TBody>
                  {(leads ?? []).map((l) => (
                    <TR key={l.id}>
                      <TD><Link href={`/leads/${l.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{l.doc_no}</Link></TD>
                      <TD>{l.title}</TD><TD numeric>{formatMoney(l.estimated_value, l.currency_code)}</TD><TD><StatusBadge status={l.stage} /></TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Contacts</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(c.contacts ?? []).length === 0 && <p className="text-sm text-slate-500">No contacts.</p>}
              {(c.contacts ?? []).sort((a: any, b: any) => Number(b.is_primary) - Number(a.is_primary)).map((p: any) => (
                <div key={p.id} className="text-sm">
                  <p className="font-medium text-slate-900">{p.name} {p.is_primary && <Badge tone="navy" className="ml-1">Primary</Badge>}</p>
                  {p.designation && <p className="text-slate-500">{p.designation}</p>}
                  <p className="text-slate-600">{[p.email, p.mobile, p.phone].filter(Boolean).join(" · ")}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Addresses</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(c.addresses ?? []).length === 0 && <p className="text-sm text-slate-500">No addresses.</p>}
              {(c.addresses ?? []).map((a: any) => (
                <div key={a.id} className="text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{a.kind === "billing" ? "Billing" : "Delivery"}{a.label ? ` · ${a.label}` : ""}{a.is_default ? " · default" : ""}</p>
                  <p className="text-slate-700">{[a.line1, a.line2, a.city, a.emirate, a.po_box && `P.O. Box ${a.po_box}`, a.country].filter(Boolean).join(", ")}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <ActivityPanel activities={activities} link={{ customer_id: c.id }} path={`/customers/${c.id}`} canManage={can(user, "activity.manage")} />
        </div>
      </div>
    </>
  );
}
