import Link from "next/link";
import type { Metadata } from "next";
import { Plus, Search } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatMoney, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Purchase orders" };
const STATUSES = ["draft", "pending_approval", "approved", "sent", "partially_received", "received", "closed", "cancelled"];
const PAGE = 50;

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; supplier?: string; page?: string }> }) {
  const user = await requirePermission("purchase_order.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  let q = supabase.from("purchase_orders")
    .select("id, doc_no, order_date, expected_date, status, total, total_base, currency_code, supplier_reference, supplier:suppliers(id, name), warehouse:warehouses(code)", { count: "exact" })
    .order("order_date", { ascending: false }).order("doc_no", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
  const term = (sp.q ?? "").trim().replace(/[%,()]/g, " ");
  if (term) q = q.or(`doc_no.ilike.%${term}%,supplier_reference.ilike.%${term}%`);
  if (sp.status === "open") q = q.in("status", ["approved", "sent", "partially_received"]);
  else if (sp.status) q = q.eq("status", sp.status);
  if (sp.supplier) q = q.eq("supplier_id", sp.supplier);
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: rows, count }, { data: suppliers }, { data: open }] = await Promise.all([
    q,
    supabase.from("suppliers").select("id, name").order("name"),
    supabase.from("purchase_orders").select("status, total_base, expected_date").in("status", ["pending_approval", "approved", "sent", "partially_received"]),
  ]);
  const openRows = (open ?? []).filter((p) => p.status !== "pending_approval");
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));

  return (
    <>
      <PageHeader title="Purchase orders" description="Orders placed with suppliers, from draft to fully received."
        actions={can(user, "purchase_order.create") && <Link href="/purchase-orders/new" className={buttonVariants()}><Plus /> New purchase order</Link>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Awaiting approval" value={(open ?? []).filter((p) => p.status === "pending_approval").length} tone="warning" />
        <StatCard label="Open orders" value={openRows.length} />
        <StatCard label="Open value (AED)" value={formatMoney(openRows.reduce((a, p) => a + Number(p.total_base), 0))} />
        <StatCard label="Overdue deliveries" value={openRows.filter((p) => p.expected_date && p.expected_date < today).length} tone="danger" />
      </div>
      <Card>
        <form className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <Input name="q" defaultValue={sp.q} placeholder="PO number or supplier reference" className="pl-9" />
          </div>
          <Select name="status" defaultValue={sp.status ?? ""} className="w-48">
            <option value="">All statuses</option><option value="open">Open (not fully received)</option>
            {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          <Select name="supplier" defaultValue={sp.supplier ?? ""} className="w-56">
            <option value="">All suppliers</option>
            {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <button className={buttonVariants({ variant: "outline" })}>Filter</button>
        </form>
        <Table>
          <THead><TR><TH>PO</TH><TH>Supplier</TH><TH>Order date</TH><TH>Expected</TH><TH>Warehouse</TH><TH numeric>Total</TH><TH>Status</TH></TR></THead>
          <TBody>
            {(rows ?? []).length === 0 && <EmptyRow colSpan={7}>No purchase orders found.</EmptyRow>}
            {(rows ?? []).map((p: any) => {
              const late = p.expected_date && p.expected_date < today && ["approved", "sent", "partially_received"].includes(p.status);
              return (
                <TR key={p.id}>
                  <TD><Link href={`/purchase-orders/${p.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{p.doc_no}</Link>
                    {p.supplier_reference && <p className="text-xs text-slate-500">{p.supplier_reference}</p>}</TD>
                  <TD><Link href={`/suppliers/${p.supplier?.id}`} className="hover:underline">{p.supplier?.name}</Link></TD>
                  <TD>{formatDate(p.order_date)}</TD>
                  <TD className={late ? "font-medium text-red-700" : ""}>{formatDate(p.expected_date)}{late && " · overdue"}</TD>
                  <TD>{p.warehouse?.code}</TD>
                  <TD numeric>{formatMoney(p.total, p.currency_code)}</TD>
                  <TD><StatusBadge status={p.status} /></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        {pages > 1 && (
          <div className="flex justify-between border-t border-slate-200 px-4 py-3 text-sm">
            <span className="text-slate-600">Page {page} of {pages}</span>
            <div className="flex gap-2">
              {page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`?${new URLSearchParams({ ...sp, page: String(page - 1) } as Record<string, string>)}`}>Previous</Link>}
              {page < pages && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={`?${new URLSearchParams({ ...sp, page: String(page + 1) } as Record<string, string>)}`}>Next</Link>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
