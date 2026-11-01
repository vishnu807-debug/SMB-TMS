import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, StatCard } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Supplier" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("supplier.view");
  const supabase = await createClient();
  const canPo = can(user, "purchase_order.view");
  const [{ data: s }, { data: pos }, { data: prices }] = await Promise.all([
    supabase.from("suppliers").select("*, terms:payment_terms(name), contacts:supplier_contacts(id, name, designation, email, phone, is_primary)").eq("id", id).maybeSingle(),
    canPo ? supabase.from("purchase_orders").select("id, doc_no, order_date, expected_date, status, total, currency_code").eq("supplier_id", id).order("order_date", { ascending: false }).limit(50)
          : Promise.resolve({ data: [] as any[] }),
    can(user, "product.view_cost") ? supabase.from("supplier_products").select("id, last_cost, currency_code, lead_time_days, is_preferred, updated_at, product:products(id, sku, name)").eq("supplier_id", id).order("updated_at", { ascending: false }).limit(100)
          : Promise.resolve({ data: null }),
  ]);
  if (!s) notFound();
  const open = (pos ?? []).filter((p: any) => ["approved", "sent", "partially_received"].includes(p.status));

  const info: [string, React.ReactNode][] = [
    ["TRN", s.trn ?? "—"], ["Trade licence", s.trade_license_no ?? "—"], ["Category", s.category ?? "—"],
    ["Email", s.email ?? "—"], ["Phone", s.phone ?? "—"], ["Website", s.website ?? "—"],
    ["Address", [s.address, s.city, s.country].filter(Boolean).join(", ") || "—"],
    ["Currency", s.currency_code], ["Payment terms", s.terms?.name ?? "—"], ["Lead time", `${s.lead_time_days} days`],
  ];

  return (
    <>
      <PageHeader title={<span className="flex items-center gap-3">{s.name} <StatusBadge status={s.status} /></span>} description={s.code}
        back={{ href: "/suppliers", label: "Suppliers" }}
        actions={<>
          {can(user, "purchase_order.create") && <Link href={`/purchase-orders/new?supplier=${id}`} className={buttonVariants({ variant: "outline" })}><Plus /> Purchase order</Link>}
          {can(user, "supplier.edit") && <Link href={`/suppliers/${id}/edit`} className={buttonVariants()}><Pencil /> Edit</Link>}
        </>} />
      {canPo && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label="Open purchase orders" value={open.length} />
          <StatCard label="Open order value" value={formatMoney(open.reduce((a: number, p: any) => a + Number(p.total), 0), s.currency_code)} />
          <StatCard label="Orders (last 50)" value={(pos ?? []).length} />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {info.map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-slate-500">{k}</dt><dd className="text-right">{v}</dd></div>)}
            </dl>
            {s.bank_details && can(user, "supplier.edit") && <div className="mt-4 rounded-md bg-slate-50 p-3 text-xs whitespace-pre-line"><p className="mb-1 font-medium text-slate-600">Bank details</p>{s.bank_details}</div>}
            {s.notes && <p className="mt-4 whitespace-pre-line text-sm text-slate-600">{s.notes}</p>}
          </CardContent>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Contacts</CardTitle></CardHeader>
            <Table>
              <THead><TR><TH>Name</TH><TH>Designation</TH><TH>Email</TH><TH>Phone</TH></TR></THead>
              <TBody>
                {(s.contacts ?? []).length === 0 && <EmptyRow colSpan={4}>No contacts.</EmptyRow>}
                {(s.contacts ?? []).map((c: any) => (
                  <TR key={c.id}><TD className="font-medium">{c.name}{c.is_primary && <span className="ml-2 text-xs text-amber-600">Primary</span>}</TD>
                    <TD>{c.designation ?? "—"}</TD><TD>{c.email ?? "—"}</TD><TD>{c.phone ?? "—"}</TD></TR>
                ))}
              </TBody>
            </Table>
          </Card>
          {canPo && (
            <Card>
              <CardHeader><CardTitle>Purchase orders</CardTitle></CardHeader>
              <Table>
                <THead><TR><TH>PO</TH><TH>Date</TH><TH>Expected</TH><TH numeric>Total</TH><TH>Status</TH></TR></THead>
                <TBody>
                  {(pos ?? []).length === 0 && <EmptyRow colSpan={5}>No purchase orders yet.</EmptyRow>}
                  {(pos ?? []).map((p: any) => (
                    <TR key={p.id}><TD><Link href={`/purchase-orders/${p.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{p.doc_no}</Link></TD>
                      <TD>{formatDate(p.order_date)}</TD><TD>{formatDate(p.expected_date)}</TD><TD numeric>{formatMoney(p.total, p.currency_code)}</TD><TD><StatusBadge status={p.status} /></TD></TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
          {prices && (
            <Card>
              <CardHeader><CardTitle>Price list</CardTitle></CardHeader>
              <Table>
                <THead><TR><TH>Product</TH><TH numeric>Last cost</TH><TH numeric>Lead time</TH><TH>Updated</TH></TR></THead>
                <TBody>
                  {prices.length === 0 && <EmptyRow colSpan={4}>No prices recorded yet. Prices are saved from selected supplier quotations.</EmptyRow>}
                  {prices.map((p: any) => (
                    <TR key={p.id}><TD><Link href={`/products/${p.product?.id}`} className="hover:underline"><span className="font-mono text-xs text-slate-500">{p.product?.sku}</span> {p.product?.name}</Link>
                      {p.is_preferred && <span className="ml-2 text-xs text-emerald-700">Default supplier</span>}</TD>
                      <TD numeric>{formatMoney(p.last_cost, p.currency_code)}</TD><TD numeric>{p.lead_time_days != null ? `${p.lead_time_days} d` : "—"}</TD><TD>{formatDate(p.updated_at)}</TD></TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
