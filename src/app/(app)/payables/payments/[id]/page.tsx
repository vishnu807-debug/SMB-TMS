import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { VoidPaymentButton } from "@/components/finance/payment-detail-actions";
import { formatDate, formatDateTime, formatMoney, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Supplier payment" };

export default async function SupplierPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("payable.view");
  const supabase = await createClient();
  const [{ data: p }, { data: allocs }] = await Promise.all([
    supabase.from("supplier_payments").select("*, supplier:suppliers(id, name), bank:bank_accounts(name), creator:profiles!supplier_payments_created_by_fkey(full_name)").eq("id", id).maybeSingle(),
    supabase.from("supplier_payment_allocations").select("id, amount, is_reversed, bill:supplier_bills(id, doc_no, supplier_invoice_no, total, status)").eq("payment_id", id),
  ]);
  if (!p) notFound();
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3">Payment <span className="font-mono">{p.doc_no}</span> <StatusBadge status={p.status} /></span>}
        description={<Link href={`/suppliers/${p.supplier?.id}`} className="text-navy-700 hover:underline">{p.supplier?.name}</Link>}
        back={{ href: "/payables?tab=payments", label: "Supplier payments" }}
        actions={p.status === "posted" && can(user, "payable.approve") && <VoidPaymentButton id={id} kind="supplier" />} />
      {p.status === "void" && <Alert tone="info" className="mb-6">Void: {p.void_reason}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card><CardHeader><CardTitle>Details</CardTitle></CardHeader><CardContent>
          <dl className="space-y-2 text-sm">
            {([["Date", formatDate(p.payment_date)], ["Method", humanize(p.method)], ["From", p.bank?.name ?? "—"], ["Reference", p.reference ?? "—"],
              ["Amount", formatMoney(p.amount, p.currency_code)], ["In AED", formatMoney(p.amount_base)], ["Recorded by", `${p.creator?.full_name ?? "—"} · ${formatDateTime(p.created_at)}`]] as [string, string][])
              .map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="text-right">{v}</dd></div>)}
          </dl>{p.notes && <p className="mt-3 text-sm text-slate-600">{p.notes}</p>}
        </CardContent></Card>
        <Card className="lg:col-span-2"><CardHeader><CardTitle>Bills settled</CardTitle></CardHeader>
          <Table><THead><TR><TH>Bill</TH><TH>Supplier invoice</TH><TH numeric>Bill total</TH><TH numeric>Paid</TH><TH>Status</TH></TR></THead>
            <TBody>{(allocs ?? []).map((a: any) => (
              <TR key={a.id} className={a.is_reversed ? "opacity-50 line-through" : ""}><TD><Link href={`/payables/bills/${a.bill?.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{a.bill?.doc_no}</Link></TD>
                <TD>{a.bill?.supplier_invoice_no}</TD><TD numeric>{formatMoney(a.bill?.total)}</TD><TD numeric>{formatMoney(a.amount)}</TD><TD><StatusBadge status={a.bill?.status} /></TD></TR>
            ))}</TBody></Table>
        </Card>
      </div>
    </>
  );
}
