import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDateTime, humanize } from "@/lib/utils";
import { Decide } from "./decide";

export const metadata: Metadata = { title: "Approvals" };
const LINK: Record<string, string> = { quotation: "/quotations/", sales_order: "/sales-orders/", stock_adjustment: "/inventory/adjustments/", purchase_order: "/purchase-orders/" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requirePermission(["approval.view", "quotation.approve", "sales_order.approve", "inventory.approve_adjustment", "purchase_order.approve"]);
  const sp = await searchParams;
  const status = sp.status ?? "pending";
  const supabase = await createClient();
  let q = supabase.from("approval_requests")
    .select("*, requester:profiles!approval_requests_requested_by_fkey(full_name), decider:profiles!approval_requests_decided_by_fkey(full_name)")
    .order("requested_at", { ascending: status === "pending" }).limit(200);
  if (status !== "all") q = q.eq("status", status);
  const { data: rows } = await q;

  return (
    <>
      <PageHeader title="Approvals" description="Quotations above discount or margin limits, orders over credit limit, purchase orders above the limit, and stock adjustments." />
      <Card>
        <form className="flex gap-3 border-b border-slate-200 p-4">
          <Select name="status" defaultValue={status} className="w-44">
            <option value="pending">Waiting</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All</option>
          </Select>
          <button className={buttonVariants({ variant: "outline" })}>Show</button>
        </form>
        <Table>
          <THead><TR><TH>Requested</TH><TH>Document</TH><TH>Why approval is needed</TH><TH>Requested by</TH><TH>Status</TH><TH /></TR></THead>
          <TBody>
            {(rows ?? []).length === 0 && <EmptyRow colSpan={6}>{status === "pending" ? "Nothing waiting for approval." : "No requests."}</EmptyRow>}
            {(rows ?? []).map((a) => {
              const mayDecide = a.status === "pending" && can(user, a.approver_permission) && (a.requested_by !== user.id || can(user, "approval.self_approve"));
              return (
                <TR key={a.id}>
                  <TD className="whitespace-nowrap">{formatDateTime(a.requested_at)}</TD>
                  <TD><span className="text-xs text-slate-500">{humanize(a.doc_type)}</span><br />
                    <Link href={`${LINK[a.doc_type] ?? "/"}${a.doc_id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{a.doc_no}</Link></TD>
                  <TD className="max-w-md">{a.reasons.join("; ")}{a.comment && <p className="text-xs text-slate-500">“{a.comment}” — {a.decider?.full_name}</p>}</TD>
                  <TD>{a.requester?.full_name}</TD>
                  <TD><StatusBadge status={a.status} /></TD>
                  <TD className="text-right">
                    {mayDecide ? <Decide requestId={a.id} /> : a.status === "pending" && a.requested_by === user.id ? <span className="text-xs text-slate-500">Your request</span> : null}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
