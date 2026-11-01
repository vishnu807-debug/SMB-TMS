import Link from "next/link";
import type { Metadata } from "next";
import { Plus, Search } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatMoney, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Quotations" };
const STATUSES = ["draft", "pending_approval", "approved", "rejected", "sent", "accepted", "converted", "lost", "expired", "superseded"];

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; customer?: string; rep?: string }> }) {
  const user = await requirePermission("quotation.view");
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("quotations")
    .select("id, doc_no, quotation_date, valid_until, status, total, total_base, currency_code, subject, customer:customers(id, name), rep:profiles!quotations_sales_rep_id_fkey(full_name)")
    .order("quotation_date", { ascending: false }).order("doc_no", { ascending: false }).limit(300);
  if (sp.status === "open" || !sp.status) q = q.in("status", ["draft", "pending_approval", "approved", "rejected", "sent", "accepted"]);
  else if (sp.status !== "all") q = q.eq("status", sp.status);
  if (sp.customer) q = q.eq("customer_id", sp.customer);
  if (sp.rep) q = q.eq("sales_rep_id", sp.rep);
  const term = (sp.q ?? "").trim().replace(/[%,()]/g, " ");
  if (term) q = q.or(`doc_no.ilike.%${term}%,subject.ilike.%${term}%,customer_reference.ilike.%${term}%`);
  const [{ data: rows }, { data: reps }] = await Promise.all([
    q, can(user, "quotation.view_all") ? supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name") : Promise.resolve({ data: [] }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const totalOpen = (rows ?? []).reduce((s, r) => s + Number(r.total_base), 0);

  return (
    <>
      <PageHeader title="Quotations" description={`${(rows ?? []).length} shown · AED ${formatMoney(totalOpen)}`}
        actions={can(user, "quotation.create") && <Link href="/quotations/new" className={buttonVariants()}><Plus /> New quotation</Link>} />
      <Card>
        <form className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          {sp.customer && <input type="hidden" name="customer" value={sp.customer} />}
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <Input name="q" defaultValue={sp.q} placeholder="Number, subject or customer reference" className="pl-9" />
          </div>
          <Select name="status" defaultValue={sp.status ?? "open"} className="w-48">
            <option value="open">Open</option><option value="all">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          {(reps ?? []).length > 0 && (
            <Select name="rep" defaultValue={sp.rep ?? ""} className="w-52">
              <option value="">All sales reps</option>{(reps ?? []).map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
            </Select>
          )}
          <button className={buttonVariants({ variant: "outline" })}>Filter</button>
        </form>
        <Table>
          <THead><TR><TH>Number</TH><TH>Date</TH><TH>Customer</TH><TH>Subject</TH><TH>Valid until</TH><TH numeric>Total</TH><TH>Sales rep</TH><TH>Status</TH></TR></THead>
          <TBody>
            {(rows ?? []).length === 0 && <EmptyRow colSpan={8}>No quotations found.</EmptyRow>}
            {(rows ?? []).map((r: any) => {
              const expiring = ["approved", "sent"].includes(r.status) && r.valid_until < today;
              return (
                <TR key={r.id}>
                  <TD><Link href={`/quotations/${r.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{r.doc_no}</Link></TD>
                  <TD>{formatDate(r.quotation_date)}</TD>
                  <TD>{r.customer?.name}</TD>
                  <TD className="max-w-[240px] truncate text-slate-500">{r.subject ?? "—"}</TD>
                  <TD className={expiring ? "font-medium text-red-700" : ""}>{formatDate(r.valid_until)}</TD>
                  <TD numeric>{formatMoney(r.total, r.currency_code)}</TD>
                  <TD>{r.rep?.full_name}</TD>
                  <TD><StatusBadge status={r.status} /></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
