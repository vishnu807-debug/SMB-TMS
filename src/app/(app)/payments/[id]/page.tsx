import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { AllocateRemaining, VoidPaymentButton } from "@/components/finance/payment-detail-actions";
import { formatDate, formatDateTime, formatMoney, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Receipt" };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("payment.view");
  const supabase = await createClient();
  const [{ data: p }, { data: allocs }] = await Promise.all([
    supabase.from("customer_payments").select("*, customer:customers(id, name), bank:bank_accounts(name), creator:profiles!customer_payments_created_by_fkey(full_name)").eq("id", id).maybeSingle(),
    supabase.from("customer_payment_allocations").select("id, amount, is_reversed, created_at, invoice:customer_invoices(id, doc_no, invoice_date, total, balance, status)").eq("payment_id", id).order("created_at"),
  ]);
  if (!p) notFound();
  const open = p.status === "posted" && Number(p.unallocated) > 0 && can(user, "payment.record")
    ? ((await supabase.from("v_receivables").select("id, doc_no, invoice_date, due_date, currency_code, total, balance, days_overdue").eq("customer_id", p.customer_id).order("due_date")).data ?? [])
    : [];
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3">Receipt <span className="font-mono">{p.doc_no}</span> <StatusBadge status={p.status} /></span>}
        description={<Link href={`/customers/${p.customer?.id}`} className="text-navy-700 hover:underline">{p.customer?.name}</Link>}
        back={{ href: "/payments", label: "Receipts" }}
        actions={p.status === "posted" && can(user, "payment.void") && <VoidPaymentButton id={id} />} />
      {p.status === "void" && <Alert tone="info" className="mb-6">Void: {p.void_reason}. Its allocations were reversed and the invoices reopened.</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {([["Date", formatDate(p.payment_date)], ["Method", humanize(p.method)], ["Account", p.bank?.name ?? "—"], ["Reference", p.reference ?? "—"],
                ["Cheque date", formatDate(p.cheque_date)], ["Amount", formatMoney(p.amount, p.currency_code)],
                ["In AED", formatMoney(p.amount_base)], ["Unallocated", formatMoney(p.unallocated)], ["Recorded by", `${p.creator?.full_name ?? "—"} · ${formatDateTime(p.created_at)}`]] as [string, string][])
                .map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="text-right">{v}</dd></div>)}
            </dl>
            {p.notes && <p className="mt-4 text-sm text-slate-600">{p.notes}</p>}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Applied to</CardTitle></CardHeader>
          <Table>
            <THead><TR><TH>Invoice</TH><TH>Date</TH><TH numeric>Invoice total</TH><TH numeric>Applied</TH><TH>Invoice status</TH></TR></THead>
            <TBody>
              {(allocs ?? []).length === 0 && <EmptyRow colSpan={5}>Not applied to any invoice yet.</EmptyRow>}
              {(allocs ?? []).map((a: any) => (
                <TR key={a.id} className={a.is_reversed ? "opacity-50 line-through" : ""}>
                  <TD><Link href={`/invoices/${a.invoice?.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{a.invoice?.doc_no}</Link></TD>
                  <TD>{formatDate(a.invoice?.invoice_date)}</TD><TD numeric>{formatMoney(a.invoice?.total)}</TD><TD numeric>{formatMoney(a.amount)}</TD>
                  <TD><StatusBadge status={a.invoice?.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
      {open.length > 0 && <AllocateRemaining id={id} currency={p.currency_code} available={Number(p.unallocated)}
        items={open.map((o: any) => ({ ...o, total: Number(o.total), balance: Number(o.balance) }))} />}
    </>
  );
}
