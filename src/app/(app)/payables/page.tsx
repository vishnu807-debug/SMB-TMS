import Link from "next/link";
import type { Metadata } from "next";
import { Plus, Wallet } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, StatCard } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { cn, formatDate, formatMoney, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Payables" };
const TABS = [["bills", "Supplier bills"], ["payments", "Supplier payments"], ["to-bill", "Received, not billed"]] as const;

export default async function PayablesPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; supplier?: string }> }) {
  const user = await requirePermission("payable.view");
  const sp = await searchParams;
  const tab = sp.tab ?? "bills";
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  let bq = supabase.from("supplier_bills").select("id, doc_no, supplier_invoice_no, bill_date, due_date, currency_code, total, balance, status, max_variance_pct, supplier:suppliers(id, name), po:purchase_orders(id, doc_no)")
    .order("bill_date", { ascending: false }).limit(300);
  if (sp.status === "due") bq = bq.in("status", ["approved", "partially_paid"]).lte("due_date", new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
  else if (sp.status) bq = bq.eq("status", sp.status);
  if (sp.supplier) bq = bq.eq("supplier_id", sp.supplier);
  let pq = supabase.from("supplier_payments").select("id, doc_no, payment_date, method, reference, currency_code, amount, status, supplier:suppliers(name), bank:bank_accounts(name)")
    .order("payment_date", { ascending: false }).limit(300);
  if (sp.supplier) pq = pq.eq("supplier_id", sp.supplier);
  const [{ data: bills }, { data: payments }, { data: ap }, { data: suppliers }, { data: toBill }] = await Promise.all([
    tab === "bills" ? bq : Promise.resolve({ data: [] as any[] }),
    tab === "payments" ? pq : Promise.resolve({ data: [] as any[] }),
    supabase.from("v_payables").select("balance_base, due_date, bucket"),
    supabase.from("suppliers").select("id, name").order("name"),
    tab === "to-bill" ? supabase.from("purchase_order_lines").select("id, description, qty_received, qty_billed, unit_cost, po:purchase_orders!inner(id, doc_no, currency_code, status, supplier:suppliers(name))")
      .gt("qty_received", 0).neq("po.status", "cancelled").limit(500) : Promise.resolve({ data: [] as any[] }),
  ]);
  const totalAp = (ap ?? []).reduce((a, r) => a + Number(r.balance_base), 0);
  const overdue = (ap ?? []).filter((r) => r.due_date && r.due_date < today).reduce((a, r) => a + Number(r.balance_base), 0);
  const dueWeek = (ap ?? []).filter((r) => r.due_date && r.due_date >= today && r.due_date <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).reduce((a, r) => a + Number(r.balance_base), 0);
  const unbilled = (toBill ?? []).filter((l: any) => Number(l.qty_received) > Number(l.qty_billed));
  return (
    <>
      <PageHeader title="Payables" description="Supplier invoices matched to purchase orders and goods received, and the payments that settle them."
        actions={can(user, "payable.manage") && <>
          <Link href="/payables/payments/new" className={buttonVariants({ variant: "outline" })}><Wallet /> Pay supplier</Link>
          <Link href="/payables/bills/new" className={buttonVariants()}><Plus /> Enter bill</Link></>} />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        <StatCard label="Payable (AED)" value={formatMoney(totalAp)} />
        <StatCard label="Overdue (AED)" value={formatMoney(overdue)} tone="danger" />
        <StatCard label="Due in 7 days (AED)" value={<Link href="/payables?status=due" className="hover:underline">{formatMoney(dueWeek)}</Link>} tone="warning" />
        <StatCard label="Open bills" value={(ap ?? []).length} />
      </div>
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map(([k, label]) => <Link key={k} href={`/payables?tab=${k}`} className={cn("-mb-px border-b-2 px-4 py-2 text-sm font-medium", tab === k ? "border-navy-700 text-navy-800" : "border-transparent text-slate-500 hover:text-slate-800")}>{label}</Link>)}
      </div>
      {tab !== "to-bill" && (
        <form className="mb-0 flex gap-3 rounded-t-lg border border-b-0 border-slate-200 bg-white p-4">
          <input type="hidden" name="tab" value={tab} />
          <Select name="supplier" defaultValue={sp.supplier ?? ""} className="w-64"><option value="">All suppliers</option>{(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          {tab === "bills" && <Select name="status" defaultValue={sp.status ?? ""} className="w-48"><option value="">All statuses</option><option value="due">Due within 7 days</option>
            {["draft", "pending_approval", "approved", "partially_paid", "paid", "void"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>}
          <button className={buttonVariants({ variant: "outline" })}>Filter</button>
        </form>
      )}
      <Card className={tab !== "to-bill" ? "rounded-t-none" : ""}>
        {tab === "bills" && (
          <Table>
            <THead><TR><TH>Bill</TH><TH>Supplier</TH><TH>Supplier inv.</TH><TH>PO</TH><TH>Date</TH><TH>Due</TH><TH numeric>Total</TH><TH numeric>Balance</TH><TH>Status</TH></TR></THead>
            <TBody>
              {(bills ?? []).length === 0 && <EmptyRow colSpan={9}>No bills.</EmptyRow>}
              {(bills ?? []).map((b: any) => (
                <TR key={b.id}>
                  <TD><Link href={`/payables/bills/${b.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{b.doc_no}</Link></TD>
                  <TD>{b.supplier?.name}</TD><TD>{b.supplier_invoice_no}</TD>
                  <TD>{b.po ? <Link href={`/purchase-orders/${b.po.id}`} className="font-mono text-xs hover:underline">{b.po.doc_no}</Link> : "—"}</TD>
                  <TD>{formatDate(b.bill_date)}</TD>
                  <TD className={["approved", "partially_paid"].includes(b.status) && b.due_date < today ? "font-medium text-red-700" : ""}>{formatDate(b.due_date)}</TD>
                  <TD numeric>{formatMoney(b.total, b.currency_code)}</TD><TD numeric>{b.status === "void" ? "—" : formatMoney(b.balance)}</TD>
                  <TD><StatusBadge status={b.status} />{Number(b.max_variance_pct) > 2 && <span className="ml-1 text-xs text-red-700">±{Number(b.max_variance_pct)}%</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {tab === "payments" && (
          <Table>
            <THead><TR><TH>Payment</TH><TH>Supplier</TH><TH>Date</TH><TH>Method</TH><TH>Account / ref.</TH><TH numeric>Amount</TH><TH>Status</TH></TR></THead>
            <TBody>
              {(payments ?? []).length === 0 && <EmptyRow colSpan={7}>No payments.</EmptyRow>}
              {(payments ?? []).map((p: any) => (
                <TR key={p.id}><TD><Link href={`/payables/payments/${p.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{p.doc_no}</Link></TD>
                  <TD>{p.supplier?.name}</TD><TD>{formatDate(p.payment_date)}</TD><TD>{humanize(p.method)}</TD>
                  <TD>{p.bank?.name ?? "—"}{p.reference && <p className="text-xs text-slate-500">{p.reference}</p>}</TD>
                  <TD numeric>{formatMoney(p.amount, p.currency_code)}</TD><TD><StatusBadge status={p.status} /></TD></TR>
              ))}
            </TBody>
          </Table>
        )}
        {tab === "to-bill" && (
          <Table>
            <THead><TR><TH>PO</TH><TH>Supplier</TH><TH>Item</TH><TH numeric>Received</TH><TH numeric>Billed</TH><TH numeric>Value to bill</TH><TH /></TR></THead>
            <TBody>
              {unbilled.length === 0 && <EmptyRow colSpan={7}>All received goods have been billed.</EmptyRow>}
              {unbilled.map((l: any) => (
                <TR key={l.id}><TD><Link href={`/purchase-orders/${l.po.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{l.po.doc_no}</Link></TD>
                  <TD>{l.po.supplier?.name}</TD><TD>{l.description}</TD><TD numeric>{Number(l.qty_received)}</TD><TD numeric>{Number(l.qty_billed)}</TD>
                  <TD numeric>{formatMoney((Number(l.qty_received) - Number(l.qty_billed)) * Number(l.unit_cost), l.po.currency_code)}</TD>
                  <TD className="text-right">{can(user, "payable.manage") && <Link href={`/payables/bills/new?po=${l.po.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>Enter bill</Link>}</TD></TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
