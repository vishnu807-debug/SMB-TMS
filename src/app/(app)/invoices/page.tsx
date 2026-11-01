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
import { CreateInvoiceButton } from "@/components/finance/create-invoice-button";
import { cn, formatDate, formatMoney, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Invoices" };
const TABS = [["invoices", "Invoices"], ["to-invoice", "Delivered, not invoiced"], ["credit-notes", "Credit notes"]] as const;
const BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; status?: string }> }) {
  const user = await requirePermission("invoice.view");
  const sp = await searchParams;
  const tab = sp.tab ?? "invoices";
  const supabase = await createClient();
  let q = supabase.from("customer_invoices").select("id, kind, doc_no, invoice_date, due_date, customer_name, customer_id, total, balance, currency_code, status, einvoice_status, so:sales_orders(id, doc_no)")
    .eq("kind", tab === "credit-notes" ? "credit_note" : "invoice").order("invoice_date", { ascending: false }).order("created_at", { ascending: false }).limit(300);
  const term = (sp.q ?? "").trim().replace(/[%,()]/g, " ");
  if (term) q = q.or(`doc_no.ilike.%${term}%,customer_name.ilike.%${term}%,customer_reference.ilike.%${term}%`);
  if (sp.status === "overdue") q = q.in("status", ["posted", "partially_paid"]).lt("due_date", new Date().toISOString().slice(0, 10));
  else if (sp.status) q = q.eq("status", sp.status);
  const [{ data: rows }, { data: ar }, { data: todo }] = await Promise.all([
    tab === "to-invoice" ? Promise.resolve({ data: [] as any[] }) : q,
    supabase.from("v_receivables").select("bucket, balance_base"),
    supabase.from("v_uninvoiced_deliveries").select("*").order("delivery_date"),
  ]);
  const aging = Object.fromEntries(BUCKETS.map((b) => [b, (ar ?? []).filter((r) => r.bucket === b).reduce((a, r) => a + Number(r.balance_base), 0)]));
  const total = Object.values(aging).reduce((a, b) => a + b, 0);
  const todoOrders = new Map<string, { id: string; doc_no: string; customer: string; notes: { id: string; doc_no: string; date: string }[]; value: number; ccy: string }>();
  (todo ?? []).forEach((r: any) => {
    const o = todoOrders.get(r.sales_order_id) ?? { id: r.sales_order_id, doc_no: r.sales_order_no, customer: r.customer_name, notes: [] as { id: string; doc_no: string; date: string }[], value: 0, ccy: r.currency_code };
    o.notes.push({ id: r.delivery_note_id, doc_no: r.delivery_note_no, date: r.delivery_date }); o.value += Number(r.value_uninvoiced);
    todoOrders.set(r.sales_order_id, o);
  });

  return (
    <>
      <PageHeader title="Invoices" description="Tax invoices and credit notes. Invoices are raised from delivered quantities at the ordered prices."
        actions={can(user, "invoice.create") && <Link href="/invoices/new" className={buttonVariants({ variant: "outline" })}><Plus /> Invoice without order</Link>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Receivable (AED)" value={formatMoney(total)} />
        {BUCKETS.map((b) => <StatCard key={b} label={b === "current" ? "Not yet due" : `${b} days overdue`} value={formatMoney(aging[b])} tone={b === "current" ? "default" : b === "90+" || b === "61-90" ? "danger" : "warning"} />)}
      </div>
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/invoices?tab=${k}`} className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-medium",
            tab === k ? "border-navy-700 text-navy-800" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {label}{k === "to-invoice" && todoOrders.size > 0 && <span className="ml-2 rounded-full bg-amber-100 px-2 text-xs text-amber-800">{todoOrders.size}</span>}
          </Link>
        ))}
      </div>
      {tab === "to-invoice" ? (
        <Card>
          <Table>
            <THead><TR><TH>Sales order</TH><TH>Customer</TH><TH>Delivery notes</TH><TH numeric>Value to invoice</TH><TH /></TR></THead>
            <TBody>
              {todoOrders.size === 0 && <EmptyRow colSpan={5}>Everything delivered has been invoiced.</EmptyRow>}
              {[...todoOrders.values()].map((o) => (
                <TR key={o.id}>
                  <TD><Link href={`/sales-orders/${o.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{o.doc_no}</Link></TD>
                  <TD>{o.customer}</TD>
                  <TD>{o.notes.map((n) => <Link key={n.id} href={`/logistics/deliveries/${n.id}`} className="mr-2 font-mono text-xs hover:underline">{n.doc_no}</Link>)}</TD>
                  <TD numeric>{formatMoney(o.value, o.ccy)}</TD>
                  <TD className="text-right">{can(user, "invoice.create") && <CreateInvoiceButton orderId={o.id} label="Create invoice" />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : (
        <Card>
          <form className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
            <input type="hidden" name="tab" value={tab} />
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
              <Input name="q" defaultValue={sp.q} placeholder="Number, customer or customer reference" className="pl-9" />
            </div>
            <Select name="status" defaultValue={sp.status ?? ""} className="w-44">
              <option value="">All statuses</option><option value="overdue">Overdue</option>
              {["draft", "posted", "partially_paid", "paid", "void"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </Select>
            <button className={buttonVariants({ variant: "outline" })}>Filter</button>
          </form>
          <Table>
            <THead><TR><TH>Number</TH><TH>Customer</TH><TH>Order</TH><TH>Date</TH><TH>Due</TH><TH numeric>Total</TH><TH numeric>Balance</TH><TH>Status</TH><TH>E-invoice</TH></TR></THead>
            <TBody>
              {(rows ?? []).length === 0 && <EmptyRow colSpan={9}>Nothing found.</EmptyRow>}
              {(rows ?? []).map((i: any) => {
                const overdue = ["posted", "partially_paid"].includes(i.status) && i.due_date && i.due_date < new Date().toISOString().slice(0, 10);
                return (
                  <TR key={i.id}>
                    <TD><Link href={`/invoices/${i.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{i.doc_no ?? "Draft"}</Link></TD>
                    <TD>{i.customer_name}</TD>
                    <TD>{i.so ? <Link href={`/sales-orders/${i.so.id}`} className="font-mono text-xs hover:underline">{i.so.doc_no}</Link> : "—"}</TD>
                    <TD>{formatDate(i.invoice_date)}</TD>
                    <TD className={overdue ? "font-medium text-red-700" : ""}>{formatDate(i.due_date)}</TD>
                    <TD numeric>{formatMoney(i.total, i.currency_code)}</TD>
                    <TD numeric>{i.kind === "invoice" && i.status !== "void" && i.status !== "draft" ? formatMoney(i.balance) : "—"}</TD>
                    <TD><StatusBadge status={i.status} /></TD>
                    <TD>{i.einvoice_status !== "not_enabled" ? <StatusBadge status={i.einvoice_status} /> : <span className="text-xs text-slate-400">—</span>}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}
