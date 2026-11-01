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

export const metadata: Metadata = { title: "Customer receipts" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ customer?: string; unallocated?: string }> }) {
  const user = await requirePermission("payment.view");
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("customer_payments").select("id, doc_no, payment_date, method, reference, currency_code, amount, unallocated, status, customer:customers(id, name), bank:bank_accounts(name)")
    .order("payment_date", { ascending: false }).order("doc_no", { ascending: false }).limit(300);
  if (sp.customer) q = q.eq("customer_id", sp.customer);
  if (sp.unallocated) q = q.eq("status", "posted").gt("unallocated", 0);
  const monthStart = new Date().toISOString().slice(0, 8) + "01";
  const [{ data: rows }, { data: customers }, { data: month }] = await Promise.all([
    q, supabase.from("customers").select("id, name").order("name"),
    supabase.from("customer_payments").select("amount_base, unallocated, exchange_rate").eq("status", "posted").gte("payment_date", monthStart),
  ]);
  return (
    <>
      <PageHeader title="Customer receipts" description="Money received and the invoices it settles."
        actions={can(user, "payment.record") && <Link href="/payments/new" className={buttonVariants()}><Plus /> Record receipt</Link>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Received this month (AED)" value={formatMoney((month ?? []).reduce((a, p) => a + Number(p.amount_base), 0))} tone="success" />
        <StatCard label="Receipts this month" value={(month ?? []).length} />
        <StatCard label="Unallocated (all time)" value={<Link href="/payments?unallocated=1" className="hover:underline">{(rows ?? []).filter((r: any) => r.status === "posted" && Number(r.unallocated) > 0).length} receipts</Link>} tone="warning" />
      </div>
      <Card>
        <form className="flex gap-3 border-b border-slate-200 p-4">
          <Select name="customer" defaultValue={sp.customer ?? ""} className="w-64"><option value="">All customers</option>{(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="unallocated" value="1" defaultChecked={!!sp.unallocated} className="size-4" /> Only with unallocated amount</label>
          <button className={buttonVariants({ variant: "outline" })}>Filter</button>
        </form>
        <Table>
          <THead><TR><TH>Receipt</TH><TH>Customer</TH><TH>Date</TH><TH>Method</TH><TH>Account / ref.</TH><TH numeric>Amount</TH><TH numeric>Unallocated</TH><TH>Status</TH></TR></THead>
          <TBody>
            {(rows ?? []).length === 0 && <EmptyRow colSpan={8}>No receipts.</EmptyRow>}
            {(rows ?? []).map((p: any) => (
              <TR key={p.id}>
                <TD><Link href={`/payments/${p.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{p.doc_no}</Link></TD>
                <TD>{p.customer?.name}</TD><TD>{formatDate(p.payment_date)}</TD><TD>{humanize(p.method)}</TD>
                <TD>{p.bank?.name ?? "—"}{p.reference && <p className="text-xs text-slate-500">{p.reference}</p>}</TD>
                <TD numeric>{formatMoney(p.amount, p.currency_code)}</TD>
                <TD numeric className={Number(p.unallocated) > 0 && p.status === "posted" ? "text-amber-700" : ""}>{p.status === "posted" ? formatMoney(p.unallocated) : "—"}</TD>
                <TD><StatusBadge status={p.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
