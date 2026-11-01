import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { InvoiceActions } from "@/components/finance/invoice-actions";
import { InvoiceDraftEditor, type DraftLine } from "@/components/finance/invoice-draft-editor";
import { formatDate, formatDateTime, formatMoney, formatQty } from "@/lib/utils";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("invoice.view");
  const supabase = await createClient();
  const [{ data: inv }, { data: lines }, { data: allocs }, { data: credits }, { data: tx }, { data: taxCodes }, { data: terms }, { data: settings }] = await Promise.all([
    supabase.from("customer_invoices").select("*, so:sales_orders(id, doc_no), orig:customer_invoices!customer_invoices_credit_for_invoice_id_fkey(id, doc_no), pterm:payment_terms(name)").eq("id", id).maybeSingle(),
    supabase.from("customer_invoice_lines").select("*, dnl:delivery_note_lines(id, qty, qty_invoiced, note:delivery_notes(id, doc_no))").eq("invoice_id", id).order("line_no"),
    supabase.from("customer_payment_allocations").select("amount, is_reversed, payment:customer_payments(id, doc_no, payment_date, method, status)").eq("invoice_id", id),
    supabase.from("customer_invoices").select("id, doc_no, invoice_date, total, status").eq("credit_for_invoice_id", id).order("created_at"),
    supabase.from("einvoice_transmissions").select("id, status, attempt, provider_ref, error, updated_at").eq("invoice_id", id).order("created_at", { ascending: false }).limit(5),
    supabase.from("tax_codes").select("id, code, rate").eq("is_active", true).order("code"),
    supabase.from("payment_terms").select("id, name").eq("is_active", true).order("name"),
    supabase.from("company_settings").select("base_currency").single(),
  ]);
  if (!inv) notFound();
  const i: any = inv;
  const isCN = i.kind === "credit_note";
  const title = isCN ? "Credit note" : "Tax invoice";

  // Draft invoice → editable lines; max per delivered line = delivered − invoiced − other drafts.
  let draftLines: DraftLine[] = [];
  if (i.status === "draft" && !isCN) {
    const dnIds = (lines ?? []).map((l: any) => l.delivery_note_line_id).filter(Boolean);
    const { data: others } = dnIds.length
      ? await supabase.from("customer_invoice_lines").select("delivery_note_line_id, qty, inv:customer_invoices!inner(id, status)").in("delivery_note_line_id", dnIds).eq("inv.status", "draft").neq("invoice_id", id)
      : { data: [] as any[] };
    draftLines = (lines ?? []).map((l: any) => ({
      id: l.id, key: l.id, fromDelivery: !!l.delivery_note_line_id, description: l.description, uom_code: l.uom_code ?? "", qty: String(Number(l.qty)),
      unit_price: String(Number(l.unit_price)), discount_pct: Number(l.discount_pct), tax_code_id: l.tax_code_id,
      max: l.dnl ? Number(l.dnl.qty) - Number(l.dnl.qty_invoiced) - (others ?? []).filter((o: any) => o.delivery_note_line_id === l.delivery_note_line_id).reduce((a: number, o: any) => a + Number(o.qty), 0) : undefined,
    }));
  }
  const open = ["posted", "partially_paid"].includes(i.status);
  const perms = {
    pdf: i.status !== "draft",
    post: i.status === "draft" && can(user, "invoice.post"),
    delete: i.status === "draft" && can(user, "invoice.create"),
    void: i.status === "posted" && Number(i.amount_paid) === 0 && Number(i.amount_credited) === 0 && can(user, "invoice.void") && !["submitted", "accepted"].includes(i.einvoice_status),
    credit: !isCN && open && can(user, "invoice.create"),
    pay: !isCN && open && can(user, "payment.record"),
    retry: i.status !== "draft" && i.status !== "void" && ["failed", "rejected"].includes(i.einvoice_status) && can(user, "invoice.post"),
  };

  return (
    <>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3">{title} <span className="font-mono">{i.doc_no ?? "(draft)"}</span> <StatusBadge status={i.status} />
          {i.einvoice_status !== "not_enabled" && <Badge tone={i.einvoice_status === "accepted" ? "green" : ["rejected", "failed"].includes(i.einvoice_status) ? "red" : "blue"}>E-invoice: {i.einvoice_status}</Badge>}</span>}
        description={<>{i.customer_name}{i.so && <> · <Link href={`/sales-orders/${i.so.id}`} className="text-navy-700 hover:underline">{i.so.doc_no}</Link></>}
          {i.orig && <> · credits <Link href={`/invoices/${i.orig.id}`} className="text-navy-700 hover:underline">{i.orig.doc_no}</Link></>}</>}
        back={{ href: isCN ? "/invoices?tab=credit-notes" : "/invoices", label: "Invoices" }}
        actions={<InvoiceActions id={id} kind={i.kind} perms={perms} creditLines={(lines ?? []).map((l: any) => ({ id: l.id, description: l.description, qty: Number(l.qty) }))} />} />
      {i.status === "void" && <Alert tone="info" className="mb-6">Void: {i.void_reason}</Alert>}
      {["rejected", "failed"].includes(i.einvoice_status) && <Alert tone="error" className="mb-6">E-invoicing {i.einvoice_status}: {i.einvoice_message ?? "see the transmission log below"}. Correct the customer or invoice data and resend, or issue a credit note.</Alert>}
      {isCN && i.reason && <Alert tone="info" className="mb-6">Reason: {i.reason}</Alert>}

      {i.status === "draft" && !isCN ? (
        <InvoiceDraftEditor invoice={{ id, invoice_date: i.invoice_date, supply_date: i.supply_date ?? "", due_date: i.due_date ?? "", payment_term_id: i.payment_term_id ?? "",
            customer_reference: i.customer_reference ?? "", billing_address: i.billing_address ?? "", notes: i.notes ?? "", terms: i.terms ?? "", currency_code: i.currency_code }}
          lines={draftLines} taxCodes={(taxCodes ?? []).map((t) => ({ ...t, rate: Number(t.rate) }))} paymentTerms={terms ?? []} baseCurrency={settings?.base_currency ?? "AED"} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Lines</CardTitle></CardHeader>
            <Table>
              <THead><TR><TH>#</TH><TH>Description</TH><TH numeric>Qty</TH><TH numeric>Unit price</TH><TH numeric>Disc.</TH><TH>VAT</TH><TH numeric>Net</TH><TH numeric>VAT amt</TH></TR></THead>
              <TBody>
                {(lines ?? []).map((l: any) => (
                  <TR key={l.id}>
                    <TD className="text-slate-400">{l.line_no}</TD>
                    <TD>{l.description}{l.dnl?.note && <p className="text-xs text-slate-500">Delivered on <Link href={`/logistics/deliveries/${l.dnl.note.id}`} className="hover:underline">{l.dnl.note.doc_no}</Link></p>}</TD>
                    <TD numeric>{formatQty(l.qty)} <span className="text-xs text-slate-400">{l.uom_code}</span></TD>
                    <TD numeric>{formatMoney(l.unit_price)}</TD>
                    <TD numeric>{Number(l.discount_pct) ? `${Number(l.discount_pct)}%` : "—"}</TD>
                    <TD>{l.tax_category} {Number(l.tax_rate)}%</TD>
                    <TD numeric>{formatMoney(l.net_amount)}</TD>
                    <TD numeric>{formatMoney(l.tax_amount)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="flex justify-end border-t border-slate-100 px-5 py-4">
              <dl className="w-72 space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Net</dt><dd className="tabular-nums">{formatMoney(i.net_total, i.currency_code)}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">VAT</dt><dd className="tabular-nums">{formatMoney(i.tax_total, i.currency_code)}</dd></div>
                <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(i.total, i.currency_code)}</dd></div>
                {!isCN && i.status !== "draft" && <>
                  <div className="flex justify-between text-slate-600"><dt>Paid</dt><dd className="tabular-nums">−{formatMoney(i.amount_paid)}</dd></div>
                  {Number(i.amount_credited) > 0 && <div className="flex justify-between text-slate-600"><dt>Credited</dt><dd className="tabular-nums">−{formatMoney(i.amount_credited)}</dd></div>}
                  <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-navy-800"><dt>Balance due</dt><dd className="tabular-nums">{formatMoney(i.balance, i.currency_code)}</dd></div>
                </>}
              </dl>
            </div>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>Details</CardTitle></CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  {([["Customer TRN", i.customer_trn ?? "—"], ["Invoice date", formatDate(i.invoice_date)], ["Date of supply", formatDate(i.supply_date)],
                    ["Due", formatDate(i.due_date)], ["Payment terms", i.pterm?.name ?? "—"], ["Customer ref.", i.customer_reference ?? "—"],
                    ["Currency", i.currency_code === "AED" ? "AED" : `${i.currency_code} @ ${Number(i.exchange_rate)} (AED ${formatMoney(i.total_base)})`],
                    ["Posted", i.posted_at ? formatDateTime(i.posted_at) : "—"]] as [string, string][]).map(([k, v]) =>
                    <div key={k} className="flex justify-between gap-4"><dt className="shrink-0 text-slate-500">{k}</dt><dd className="text-right">{v}</dd></div>)}
                </dl>
                {i.billing_address && <p className="mt-3 text-sm text-slate-600">{i.billing_address}</p>}
              </CardContent>
            </Card>
            {!isCN && (
              <Card>
                <CardHeader><CardTitle>Payments & credits</CardTitle></CardHeader>
                <Table>
                  <TBody>
                    {(allocs ?? []).length === 0 && (credits ?? []).length === 0 && <EmptyRow colSpan={3}>None yet.</EmptyRow>}
                    {(allocs ?? []).map((a: any, n) => (
                      <TR key={n} className={a.is_reversed ? "opacity-50 line-through" : ""}><TD><Link href={`/payments/${a.payment?.id}`} className="font-mono text-xs text-navy-800 hover:underline">{a.payment?.doc_no}</Link></TD>
                        <TD>{formatDate(a.payment?.payment_date)}</TD><TD numeric>{formatMoney(a.amount)}</TD></TR>
                    ))}
                    {(credits ?? []).map((c: any) => (
                      <TR key={c.id}><TD><Link href={`/invoices/${c.id}`} className="font-mono text-xs text-navy-800 hover:underline">{c.doc_no ?? "Draft CN"}</Link></TD>
                        <TD><StatusBadge status={c.status} /></TD><TD numeric>{formatMoney(c.total)}</TD></TR>
                    ))}
                  </TBody>
                </Table>
              </Card>
            )}
            {(tx ?? []).length > 0 && (
              <Card>
                <CardHeader><CardTitle>E-invoicing log</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {(tx ?? []).map((t) => (
                    <div key={t.id}><div className="flex justify-between"><StatusBadge status={t.status} /><span className="text-xs text-slate-500">{formatDateTime(t.updated_at)} · attempt {t.attempt}</span></div>
                      {t.provider_ref && <p className="text-xs text-slate-600">Ref. {t.provider_ref}</p>}{t.error && <p className="text-xs text-red-700">{t.error}</p>}</div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
