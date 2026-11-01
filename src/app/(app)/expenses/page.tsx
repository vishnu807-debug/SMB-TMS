import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatMoney, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ status?: string; mine?: string }> }) {
  const user = await requirePermission(["expense.submit", "expense.view_all", "expense.approve"]);
  const sp = await searchParams;
  const seeAll = can(user, "expense.view_all") || can(user, "expense.approve");
  const supabase = await createClient();
  let q = supabase.from("expenses").select("id, doc_no, expense_date, description, vendor_name, total, status, paid_by, created_by, category:expense_categories(name), owner:profiles!expenses_created_by_fkey(full_name)")
    .order("expense_date", { ascending: false }).limit(300);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.mine || !seeAll) q = q.eq("created_by", user.id);
  const { data: rows } = await q;
  const sum = (s: string[]) => (rows ?? []).filter((r) => s.includes(r.status)).reduce((a, r) => a + Number(r.total), 0);
  return (
    <>
      <PageHeader title="Expenses" description={seeAll ? "Expense claims from all staff." : "Your expense claims."}
        actions={can(user, "expense.submit") && <Link href="/expenses/new" className={buttonVariants()}><Plus /> New claim</Link>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Waiting for approval" value={formatMoney(sum(["submitted"]), "AED")} tone="warning" />
        <StatCard label="Approved, not paid" value={formatMoney(sum(["approved"]), "AED")} />
        <StatCard label="Paid (listed)" value={formatMoney(sum(["paid"]), "AED")} tone="success" />
      </div>
      <Card>
        <form className="flex gap-3 border-b border-slate-200 p-4">
          <Select name="status" defaultValue={sp.status ?? ""} className="w-44"><option value="">All statuses</option>
            {["draft", "submitted", "approved", "rejected", "paid", "cancelled"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
          {seeAll && <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="mine" value="1" defaultChecked={!!sp.mine} className="size-4" /> Only mine</label>}
          <button className={buttonVariants({ variant: "outline" })}>Filter</button>
        </form>
        <Table>
          <THead><TR><TH>Claim</TH><TH>Date</TH>{seeAll && <TH>Employee</TH>}<TH>Category</TH><TH>Description</TH><TH numeric>Total</TH><TH>Status</TH></TR></THead>
          <TBody>
            {(rows ?? []).length === 0 && <EmptyRow colSpan={7}>No expense claims.</EmptyRow>}
            {(rows ?? []).map((e: any) => (
              <TR key={e.id}><TD><Link href={`/expenses/${e.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{e.doc_no}</Link></TD>
                <TD>{formatDate(e.expense_date)}</TD>{seeAll && <TD>{e.owner?.full_name}</TD>}<TD>{e.category?.name}</TD>
                <TD className="max-w-xs truncate">{e.description}{e.vendor_name && <span className="text-slate-500"> · {e.vendor_name}</span>}</TD>
                <TD numeric>{formatMoney(e.total)}</TD><TD><StatusBadge status={e.status} /></TD></TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
