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
import { BillActions } from "@/components/finance/bill-actions";
import { formatDate, formatDateTime, formatMoney, formatQty } from "@/lib/utils";

export const metadata: Metadata = { title: "Supplier bill" };

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("payable.view");
  const supabase = await createClient();
  const [{ data: b }, { data: lines }, { data: pays }, { data: approvals }] = await Promise.all([
    supabase.from("supplier_bills").select("*, supplier:suppliers(id, name), po:purchase_orders(id, doc_no), approver:profiles!supplier_bills_approved_by_fkey(full_name)").eq("id", id).maybeSingle(),
    supabase.from("supplier_bill_lines").select("*, pol:purchase_order_lines(qty, qty_received, qty_billed), product:products(sku)").eq("bill_id", id).order("line_no"),
    supabase.from("supplier_payment_allocations").select("amount, is_reversed, payment:supplier_payments(id, doc_no, payment_date, method)").eq("bill_id", id),
    supabase.from("approval_requests").select("*, requester:profiles!approval_requests_requested_by_fkey(full_name), decider:profiles!approval_requests_decided_by_fkey(full_name)")
      .eq("doc_type", "supplier_bill").eq("doc_id", id).order("requested_at", { ascending: false }),
  ]);
  if (!b) notFound();
  const pending = (approvals ?? []).find((a) => a.status === "pending");
  const fileUrl = b.attachment_path ? (await supabase.storage.from("finance-docs").createSignedUrl(b.attachment_path, 300)).data?.signedUrl : null;
  const manage = can(user, "payable.manage");
  const actions = {
    attach: manage && b.status !== "void", edit: manage && b.status === "draft", submit: manage && b.status === "draft",
    approve: b.status === "pending_approval" && !!pending && can(user, pending.approver_permission) && (pending.requested_by !== user.id || can(user, "approval.self_approve")),
    void: can(user, "payable.approve") && ["draft", "pending_approval", "approved"].includes(b.status) && Number(b.amount_paid) === 0,
    pay: manage && ["approved", "partially_paid"].includes(b.status),
  };
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3">Bill <span className="font-mono">{b.doc_no}</span> <StatusBadge status={b.status} /></span>}
        description={<><Link href={`/suppliers/${b.supplier?.id}`} className="text-navy-700 hover:underline">{b.supplier?.name}</Link> · invoice {b.supplier_invoice_no}
          {b.po && <> · <Link href={`/purchase-orders/${b.po.id}`} className="text-navy-700 hover:underline">{b.po.doc_no}</Link></>}</>}
        back={{ href: "/payables", label: "Payables" }} actions={<BillActions id={id} can={actions} />} />
      {pending && <Alert tone="warning" className="mb-6">Waiting for approval: {pending.reasons.join("; ")}</Alert>}
      {b.status === "draft" && approvals?.[0]?.status === "rejected" && <Alert tone="error" className="mb-6">Returned by {approvals[0].decider?.full_name}: {approvals[0].comment}</Alert>}
      {b.status === "void" && <Alert tone="info" className="mb-6">Void: {b.void_reason}</Alert>}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Lines and three-way match</CardTitle></CardHeader>
          <Table>
            <THead><TR><TH>Description</TH><TH numeric>Billed qty</TH><TH numeric>Ordered / received</TH><TH numeric>Unit cost</TH><TH numeric>PO cost</TH><TH numeric>Variance</TH><TH numeric>Net</TH></TR></THead>
            <TBody>
              {(lines ?? []).map((l: any) => (
                <TR key={l.id}>
                  <TD>{l.product?.sku && <span className="font-mono text-xs text-slate-500">{l.product.sku} </span>}{l.description}</TD>
                  <TD numeric>{formatQty(l.qty)}</TD>
                  <TD numeric>{l.pol ? `${formatQty(l.pol.qty)} / ${formatQty(l.pol.qty_received)}` : "—"}</TD>
                  <TD numeric>{formatMoney(l.unit_cost)}</TD>
                  <TD numeric>{l.po_unit_cost != null ? formatMoney(l.po_unit_cost) : "—"}</TD>
                  <TD numeric className={Math.abs(Number(l.variance_pct ?? 0)) > 2 ? "font-medium text-red-700" : ""}>{l.variance_pct != null ? `${Number(l.variance_pct) > 0 ? "+" : ""}${Number(l.variance_pct)}%` : "—"}</TD>
                  <TD numeric>{formatMoney(l.net_amount)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="flex justify-end border-t border-slate-100 px-5 py-4">
            <dl className="w-64 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Net</dt><dd className="tabular-nums">{formatMoney(b.net_total, b.currency_code)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">VAT (input)</dt><dd className="tabular-nums">{formatMoney(b.tax_total, b.currency_code)}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(b.total, b.currency_code)}</dd></div>
              <div className="flex justify-between text-slate-600"><dt>Paid</dt><dd className="tabular-nums">−{formatMoney(b.amount_paid)}</dd></div>
              <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-navy-800"><dt>Balance</dt><dd className="tabular-nums">{formatMoney(b.balance, b.currency_code)}</dd></div>
            </dl>
          </div>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                {([["Supplier TRN", b.supplier_trn ?? "—"], ["Invoice date", formatDate(b.bill_date)], ["Due", formatDate(b.due_date)],
                  ["Currency", b.currency_code === "AED" ? "AED" : `${b.currency_code} @ ${Number(b.exchange_rate)}`], ["In AED", formatMoney(b.total_base)],
                  ["Approved", b.approved_at ? `${b.approver?.full_name ?? "automatic"} · ${formatDateTime(b.approved_at)}` : "—"]] as [string, string][])
                  .map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="text-right">{v}</dd></div>)}
              </dl>
              {fileUrl && <a href={fileUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm text-navy-700 underline">View supplier invoice</a>}
              {b.notes && <p className="mt-3 text-sm text-slate-600">{b.notes}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Payments</CardTitle></CardHeader>
            <Table><TBody>
              {(pays ?? []).length === 0 && <EmptyRow colSpan={3}>No payments yet.</EmptyRow>}
              {(pays ?? []).map((p: any, n) => (
                <TR key={n} className={p.is_reversed ? "opacity-50 line-through" : ""}><TD><Link href={`/payables/payments/${p.payment?.id}`} className="font-mono text-xs text-navy-800 hover:underline">{p.payment?.doc_no}</Link></TD>
                  <TD>{formatDate(p.payment?.payment_date)}</TD><TD numeric>{formatMoney(p.amount)}</TD></TR>
              ))}
            </TBody></Table>
          </Card>
        </div>
      </div>
    </>
  );
}
