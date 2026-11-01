import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ExpenseActions } from "@/components/finance/expense-actions";
import { formatDate, formatDateTime, formatMoney, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Expense claim" };

export default async function ExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission(["expense.submit", "expense.view_all", "expense.approve"]);
  const supabase = await createClient();
  const [{ data: e }, { data: pending }, { data: banks }] = await Promise.all([
    supabase.from("expenses").select("*, category:expense_categories(name), so:sales_orders(id, doc_no), owner:profiles!expenses_created_by_fkey(full_name), approver:profiles!expenses_approved_by_fkey(full_name), bank:bank_accounts(name)").eq("id", id).maybeSingle(),
    supabase.from("approval_requests").select("id, approver_permission, requested_by").eq("doc_type", "expense").eq("doc_id", id).eq("status", "pending").maybeSingle(),
    can(user, "expense.pay") ? supabase.from("bank_accounts").select("id, name").eq("is_active", true).order("name") : Promise.resolve({ data: [] as any[] }),
  ]);
  if (!e) notFound();
  const mine = e.created_by === user.id;
  const receiptUrl = e.receipt_path ? (await supabase.storage.from("finance-docs").createSignedUrl(e.receipt_path, 300)).data?.signedUrl : null;
  const actions = {
    edit: mine && ["draft", "rejected"].includes(e.status), submit: mine && ["draft", "rejected"].includes(e.status),
    cancel: mine && ["draft", "submitted", "rejected"].includes(e.status),
    approve: e.status === "submitted" && !!pending && can(user, pending.approver_permission) && (!mine || can(user, "approval.self_approve")),
    pay: e.status === "approved" && can(user, "expense.pay"),
  };
  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3">Expense <span className="font-mono">{e.doc_no}</span> <StatusBadge status={e.status} /></span>}
        description={`${e.owner?.full_name ?? ""} · ${e.category?.name ?? ""}`} back={{ href: "/expenses", label: "Expenses" }}
        actions={<ExpenseActions id={id} can={actions} banks={banks ?? []} />} />
      {e.status === "rejected" && <Alert tone="error" className="mb-6">Rejected: {e.rejection_reason}. Edit and submit again, or cancel the claim.</Alert>}
      {e.status === "draft" && !e.receipt_path && <Alert tone="warning" className="mb-6">No receipt attached. Edit the claim to add a photo of the receipt before submitting.</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Claim</CardTitle></CardHeader><CardContent>
          <dl className="space-y-2 text-sm">
            {([["Date", formatDate(e.expense_date)], ["Description", e.description], ["Vendor", e.vendor_name ?? "—"], ["Vendor TRN", e.vendor_trn ?? "—"],
              ["Receipt no.", e.receipt_no ?? "—"], ["Amount", formatMoney(e.amount, "AED")], ["VAT", formatMoney(e.vat_amount, "AED")], ["Total", formatMoney(e.total, "AED")],
              ["Paid by", e.paid_by === "employee" ? "Employee (to reimburse)" : "Company"]] as [string, string][])
              .map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="text-right">{v}</dd></div>)}
            {e.so && <div className="flex justify-between"><dt className="text-slate-500">For order</dt><dd><Link href={`/sales-orders/${e.so.id}`} className="text-navy-700 hover:underline">{e.so.doc_no}</Link></dd></div>}
          </dl>
          {e.notes && <p className="mt-3 text-sm text-slate-600">{e.notes}</p>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Receipt & status</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
          {receiptUrl ? <a href={receiptUrl} target="_blank" rel="noreferrer" className="text-navy-700 underline">View receipt</a> : <p className="text-slate-500">No receipt attached.</p>}
          <p><span className="text-slate-500">Submitted</span> {formatDateTime(e.updated_at)}</p>
          {e.approved_at && <p><span className="text-slate-500">Approved</span> {e.approver?.full_name ?? "automatic"} · {formatDateTime(e.approved_at)}</p>}
          {e.paid_at && <p><span className="text-slate-500">Paid</span> {formatDate(e.paid_at)} from {e.bank?.name}{e.payment_reference ? ` · ${e.payment_reference}` : ""}</p>}
          <p className="text-xs text-slate-500">Status: {humanize(e.status)}</p>
        </CardContent></Card>
      </div>
    </>
  );
}
