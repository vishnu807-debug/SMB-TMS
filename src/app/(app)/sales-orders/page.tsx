import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatMoney, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Sales orders" };
const STATUSES = ["draft", "pending_approval", "confirmed", "partially_fulfilled", "fulfilled", "invoiced", "closed", "on_hold", "cancelled"];
const OPEN = ["draft", "pending_approval", "confirmed", "partially_fulfilled", "on_hold"];

export default async function SalesOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; rep?: string }> }) {
  const user = await requirePermission("sales_order.view");
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("sales_orders")
    .select("id, doc_no, order_date, required_date, status, total, total_base, currency_code, customer_po_ref, customer:customers(id, name), rep:profiles!sales_orders_sales_rep_id_fkey(full_name), lines:sales_order_lines(fulfilment_mode, stock_status, procurement_status, delivery_status, is_cancelled)")
    .order("order_date", { ascending: false }).order("doc_no", { ascending: false }).limit(300);
  if (!sp.status || sp.status === "open") q = q.in("status", OPEN);
  else if (sp.status !== "all") q = q.eq("status", sp.status);
  if (sp.rep) q = q.eq("sales_rep_id", sp.rep);
  const term = (sp.q ?? "").trim().replace(/[%,()]/g, " ");
  if (term) q = q.or(`doc_no.ilike.%${term}%,customer_po_ref.ilike.%${term}%`);
  const [{ data: rows }, { data: reps }] = await Promise.all([
    q, can(user, "sales_order.view_all") ? supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name") : Promise.resolve({ data: [] }),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Sales orders" description="Orders are created by converting an approved quotation." />
      <Card>
        <form className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <Input name="q" defaultValue={sp.q} placeholder="Order number or customer PO" className="pl-9" />
          </div>
          <Select name="status" defaultValue={sp.status ?? "open"} className="w-48">
            <option value="open">Open orders</option><option value="all">All</option>
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
          <THead><TR><TH>Order</TH><TH>Date</TH><TH>Customer</TH><TH>Customer PO</TH><TH>Required</TH><TH>Fulfilment</TH><TH>Progress</TH><TH numeric>Total</TH><TH>Status</TH></TR></THead>
          <TBody>
            {(rows ?? []).length === 0 && <EmptyRow colSpan={9}>No orders found.</EmptyRow>}
            {(rows ?? []).map((o: any) => {
              const ls = (o.lines ?? []).filter((l: any) => !l.is_cancelled);
              const modes = new Set(ls.map((l: any) => l.fulfilment_mode));
              const reserved = ls.filter((l: any) => l.stock_status === "reserved").length;
              const delivered = ls.filter((l: any) => l.delivery_status === "delivered").length;
              const late = o.required_date && o.required_date < today && OPEN.includes(o.status);
              return (
                <TR key={o.id}>
                  <TD><Link href={`/sales-orders/${o.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{o.doc_no}</Link></TD>
                  <TD>{formatDate(o.order_date)}</TD>
                  <TD>{o.customer?.name}</TD>
                  <TD>{o.customer_po_ref ?? "—"}</TD>
                  <TD className={late ? "font-medium text-red-700" : ""}>{formatDate(o.required_date)}</TD>
                  <TD className="text-xs">{modes.size === 2 ? "Mixed" : modes.has("procure") ? "Procurement" : "Stock"}</TD>
                  <TD className="text-xs text-slate-600">{reserved}/{ls.length} ready · {delivered}/{ls.length} delivered</TD>
                  <TD numeric>{formatMoney(o.total, o.currency_code)}</TD>
                  <TD><StatusBadge status={o.status} /></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
