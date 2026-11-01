import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ToOrderTable } from "@/components/procurement/to-order-table";
import { ReorderButton } from "@/components/procurement/reorder-button";
import { cn, formatDate, formatMoney, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Procurement" };
const TABS = [["to-order", "To order"], ["requisitions", "Requisitions"], ["quotes", "Supplier quotations"]] as const;

export default async function ProcurementPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePermission("purchase_requisition.manage");
  const tab = (await searchParams).tab ?? "to-order";
  const supabase = await createClient();
  const [{ data: open }, { data: reqs }, { data: quotes }, { data: suppliers }, { data: warehouses }, { count: belowCount }] = await Promise.all([
    supabase.from("v_open_requisition_lines").select("*").order("required_date", { ascending: true, nullsFirst: false }).order("created_at"),
    tab === "requisitions" ? supabase.from("purchase_requisitions").select("id, doc_no, source, status, required_date, created_at, sales_order:sales_orders(id, doc_no), lines:purchase_requisition_lines(id)")
      .order("created_at", { ascending: false }).limit(200) : Promise.resolve({ data: [] as any[] }),
    tab === "quotes" ? supabase.from("supplier_quotations").select("id, doc_no, quote_date, valid_until, status, currency_code, supplier_reference, supplier:suppliers(name), requisition:purchase_requisitions(id, doc_no), lines:supplier_quotation_lines(qty, unit_price)")
      .order("quote_date", { ascending: false }).limit(200) : Promise.resolve({ data: [] as any[] }),
    supabase.from("suppliers").select("id, name").in("status", ["active", "on_hold"]).order("name"),
    supabase.from("warehouses").select("id, code, name").eq("is_active", true).order("code"),
    supabase.from("v_product_inventory").select("product_id", { count: "exact", head: true }).eq("below_min", true).eq("is_active", true),
  ]);
  const rows = open ?? [];
  const forOrders = rows.filter((r: any) => r.sales_order_line_id).length;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Procurement" description="What needs buying, supplier quotations and requisitions."
        actions={<>
          <ReorderButton />
          <Link href="/procurement/requisitions/new" className={buttonVariants({ variant: "outline" })}><Plus /> New requisition</Link>
          {can(user, "purchase_order.create") && <Link href="/procurement/quotes/new" className={buttonVariants()}><Plus /> Record supplier quote</Link>}
        </>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Lines to order" value={rows.length} />
        <StatCard label="For customer orders" value={forOrders} hint="Back-to-back items" />
        <StatCard label="Overdue (required date passed)" value={rows.filter((r: any) => r.required_date && r.required_date < today).length} tone="danger" />
        <StatCard label="Stock items below minimum" value={belowCount ?? "—"} tone="warning" hint={<Link href="/inventory?filter=low" className="hover:underline">View stock</Link>} />
      </div>
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/procurement?tab=${k}`} className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-medium",
            tab === k ? "border-navy-700 text-navy-800" : "border-transparent text-slate-500 hover:text-slate-800")}>{label}</Link>
        ))}
      </div>
      {tab === "to-order" && <ToOrderTable rows={rows as any[]} suppliers={suppliers ?? []} warehouses={warehouses ?? []} canCreatePo={can(user, "purchase_order.create")} />}
      {tab === "requisitions" && (
        <Card>
          <Table>
            <THead><TR><TH>Requisition</TH><TH>Source</TH><TH>Sales order</TH><TH numeric>Lines</TH><TH>Required by</TH><TH>Raised</TH><TH>Status</TH></TR></THead>
            <TBody>
              {(reqs ?? []).length === 0 && <EmptyRow colSpan={7}>No requisitions.</EmptyRow>}
              {(reqs ?? []).map((r: any) => (
                <TR key={r.id}>
                  <TD><Link href={`/procurement/requisitions/${r.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{r.doc_no}</Link></TD>
                  <TD>{humanize(r.source)}</TD>
                  <TD>{r.sales_order ? <Link href={`/sales-orders/${r.sales_order.id}`} className="font-mono text-xs hover:underline">{r.sales_order.doc_no}</Link> : "—"}</TD>
                  <TD numeric>{r.lines?.length ?? 0}</TD>
                  <TD>{formatDate(r.required_date)}</TD>
                  <TD>{formatDate(r.created_at)}</TD>
                  <TD><StatusBadge status={r.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      {tab === "quotes" && (
        <Card>
          <Table>
            <THead><TR><TH>Quote</TH><TH>Supplier</TH><TH>Requisition</TH><TH>Date</TH><TH>Valid until</TH><TH numeric>Value (net)</TH><TH>Status</TH></TR></THead>
            <TBody>
              {(quotes ?? []).length === 0 && <EmptyRow colSpan={7}>No supplier quotations recorded.</EmptyRow>}
              {(quotes ?? []).map((q: any) => (
                <TR key={q.id}>
                  <TD><Link href={`/procurement/quotes/${q.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{q.doc_no}</Link>
                    {q.supplier_reference && <p className="text-xs text-slate-500">{q.supplier_reference}</p>}</TD>
                  <TD>{q.supplier?.name}</TD>
                  <TD>{q.requisition ? <Link href={`/procurement/requisitions/${q.requisition.id}`} className="font-mono text-xs hover:underline">{q.requisition.doc_no}</Link> : "—"}</TD>
                  <TD>{formatDate(q.quote_date)}</TD>
                  <TD className={q.valid_until && q.valid_until < today ? "text-red-700" : ""}>{formatDate(q.valid_until)}</TD>
                  <TD numeric>{formatMoney((q.lines ?? []).reduce((a: number, l: any) => a + Number(l.qty) * Number(l.unit_price), 0), q.currency_code)}</TD>
                  <TD><StatusBadge status={q.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
