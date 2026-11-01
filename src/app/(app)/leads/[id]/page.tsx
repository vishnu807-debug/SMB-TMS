import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FilePlus, Pencil } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadActivities } from "@/lib/activities";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ActivityPanel } from "@/components/sales/activity-panel";
import { formatDate, formatMoney, formatQty, humanize } from "@/lib/utils";
import { LeadControls } from "./lead-controls";

export const metadata: Metadata = { title: "Enquiry" };

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("lead.view");
  const supabase = await createClient();
  const { data: l } = await supabase.from("leads")
    .select("*, customer:customers(id, name, code), owner:profiles!leads_owner_id_fkey(full_name), items:lead_items(*, product:products(sku, name))")
    .eq("id", id).maybeSingle();
  if (!l) notFound();
  const [{ data: quotes }, activities] = await Promise.all([
    supabase.from("quotations").select("id, doc_no, quotation_date, status, total, currency_code").eq("lead_id", id).order("created_at", { ascending: false }),
    loadActivities({ lead_id: id }),
  ]);
  const closed = l.stage === "won" || l.stage === "lost";

  return (
    <>
      <PageHeader
        back={{ href: "/leads", label: "Leads & enquiries" }}
        title={<span className="flex items-center gap-3">{l.title} <StatusBadge status={l.stage} />{l.priority === "high" && <Badge tone="red">High priority</Badge>}</span>}
        description={<span><span className="font-mono">{l.doc_no}</span> · {l.customer ? <Link className="text-navy-700 hover:underline" href={`/customers/${l.customer.id}`}>{l.customer.name}</Link> : l.company_name} · Owner: {l.owner?.full_name}</span>}
        actions={<>
          <LeadControls id={l.id} stage={l.stage} hasCustomer={!!l.customer_id} canEdit={can(user, "lead.edit")} canCreateCustomer={can(user, "customer.create")} />
          {!closed && can(user, "lead.edit") && <Link href={`/leads/${l.id}/edit`} className={buttonVariants({ variant: "outline" })}><Pencil /> Edit</Link>}
          {!closed && l.customer_id && can(user, "quotation.create") && <Link href={`/quotations/new?lead=${l.id}`} className={buttonVariants()}><FilePlus /> Create quotation</Link>}
        </>}
      />
      {l.stage === "lost" && <Alert tone="error" className="mb-4">Lost: {l.lost_reason}</Alert>}
      {!l.customer_id && !closed && <Alert tone="info" className="mb-4">This enquiry is from a new company. Create the customer to prepare a quotation.</Alert>}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader><CardTitle>Opportunity</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
                {[
                  ["Estimated value", formatMoney(l.estimated_value, l.currency_code)], ["Probability", `${l.probability}%`],
                  ["Weighted value", l.estimated_value ? formatMoney(Number(l.estimated_value) * l.probability / 100, l.currency_code) : "—"],
                  ["Expected close", formatDate(l.expected_close_date)], ["Source", humanize(l.source)], ["Registered", formatDate(l.created_at)],
                  ["Contact", l.contact_name ?? "—"], ["Email", l.contact_email ?? "—"], ["Phone", l.contact_phone ?? "—"],
                ].map(([k, v]) => <div key={k}><dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 text-slate-900">{v}</dd></div>)}
              </dl>
              {l.requirement && (
                <div className="mt-5 border-t border-slate-100 pt-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Customer requirement</p>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{l.requirement}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Requirement lines</CardTitle></CardHeader>
            <Table>
              <THead><TR><TH>Item</TH><TH numeric>Qty</TH><TH numeric>Target price</TH></TR></THead>
              <TBody>
                {(l.items ?? []).length === 0 && <EmptyRow colSpan={3}>No requirement lines.</EmptyRow>}
                {(l.items ?? []).map((i: any) => (
                  <TR key={i.id}><TD>{i.description}{i.product && <span className="ml-2 font-mono text-xs text-slate-500">{i.product.sku}</span>}</TD>
                    <TD numeric>{formatQty(i.qty)}</TD><TD numeric>{formatMoney(i.target_price)}</TD></TR>
                ))}
              </TBody>
            </Table>
          </Card>
          <Card>
            <CardHeader><CardTitle>Quotations</CardTitle></CardHeader>
            <Table>
              <THead><TR><TH>Number</TH><TH>Date</TH><TH numeric>Total</TH><TH>Status</TH></TR></THead>
              <TBody>
                {(quotes ?? []).length === 0 && <EmptyRow colSpan={4}>No quotations yet.</EmptyRow>}
                {(quotes ?? []).map((q) => (
                  <TR key={q.id}><TD><Link href={`/quotations/${q.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{q.doc_no}</Link></TD>
                    <TD>{formatDate(q.quotation_date)}</TD><TD numeric>{formatMoney(q.total, q.currency_code)}</TD><TD><StatusBadge status={q.status} /></TD></TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </div>
        <ActivityPanel activities={activities} link={{ lead_id: l.id }} path={`/leads/${l.id}`} canManage={can(user, "activity.manage")} />
      </div>
    </>
  );
}
