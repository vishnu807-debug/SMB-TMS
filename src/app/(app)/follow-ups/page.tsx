import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CompleteButton } from "@/components/sales/activity-panel";
import { cn, formatDateTime, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Follow-ups" };

export default async function FollowUpsPage({ searchParams }: { searchParams: Promise<{ view?: string; owner?: string }> }) {
  const user = await requirePermission(["activity.manage", "activity.view_all"]);
  const sp = await searchParams;
  const view = sp.view ?? "open";
  const supabase = await createClient();
  const all = can(user, "activity.view_all");
  // Without activity.view_all you only ever see your own; with it, choose a person or everyone.
  const owner = all ? sp.owner ?? user.id : user.id;
  let q = supabase.from("activities")
    .select("id, activity_type, subject, due_at, completed_at, outcome, owner_id, owner:profiles!activities_owner_id_fkey(full_name), lead:leads(id, doc_no, title), customer:customers(id, name), quotation:quotations(id, doc_no), sales_order:sales_orders(id, doc_no)")
    .limit(300);
  q = view === "open"
    ? q.is("completed_at", null).order("due_at", { ascending: true, nullsFirst: false })
    : q.not("completed_at", "is", null).order("completed_at", { ascending: false });
  if (owner !== "all") q = q.eq("owner_id", owner);
  const [{ data: rows }, { data: owners }] = await Promise.all([
    q, all ? supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name") : Promise.resolve({ data: [] }),
  ]);
  const now = Date.now();
  const today = new Date().toDateString();

  return (
    <>
      <PageHeader title="Follow-ups" description="Calls, meetings and follow-ups across enquiries, customers, quotations and orders." />
      <Card>
        <form className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <Select name="view" defaultValue={view} className="w-44"><option value="open">Open</option><option value="done">Completed</option></Select>
          {all && (
            <Select name="owner" defaultValue={sp.owner ?? user.id} className="w-56">
              <option value={user.id}>My follow-ups</option><option value="all">Everyone</option>
              {(owners ?? []).filter((o) => o.id !== user.id).map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
            </Select>
          )}
          <button className={buttonVariants({ variant: "outline" })}>Show</button>
        </form>
        <Table>
          <THead><TR><TH>{view === "open" ? "Due" : "Completed"}</TH><TH>Type</TH><TH>Subject</TH><TH>Related to</TH>{all && <TH>Owner</TH>}<TH /></TR></THead>
          <TBody>
            {(rows ?? []).length === 0 && <EmptyRow colSpan={6}>{view === "open" ? "Nothing to follow up. " : "Nothing completed yet."}</EmptyRow>}
            {(rows ?? []).map((a: any) => {
              const overdue = !a.completed_at && a.due_at && new Date(a.due_at).getTime() < now;
              const isToday = a.due_at && new Date(a.due_at).toDateString() === today;
              const rel = a.lead ? { href: `/leads/${a.lead.id}`, label: `${a.lead.doc_no} · ${a.lead.title}` }
                : a.quotation ? { href: `/quotations/${a.quotation.id}`, label: a.quotation.doc_no }
                : a.sales_order ? { href: `/sales-orders/${a.sales_order.id}`, label: a.sales_order.doc_no }
                : a.customer ? { href: `/customers/${a.customer.id}`, label: a.customer.name } : null;
              const path = rel?.href ?? "/follow-ups";
              return (
                <TR key={a.id}>
                  <TD className={cn("whitespace-nowrap", overdue && "font-semibold text-red-700", isToday && !overdue && "font-semibold text-amber-700")}>
                    {formatDateTime(view === "open" ? a.due_at : a.completed_at)}{overdue && " · overdue"}{isToday && !overdue && " · today"}
                  </TD>
                  <TD>{humanize(a.activity_type)}</TD>
                  <TD>{a.subject}{a.outcome && <p className="text-xs text-slate-500">{a.outcome}</p>}</TD>
                  <TD>{rel ? <Link href={rel.href} className="text-navy-800 hover:underline">{rel.label}</Link> : "—"}</TD>
                  {all && <TD>{a.owner?.full_name}</TD>}
                  <TD className="text-right">{view === "open" && (a.owner_id === user.id || all) && <CompleteButton id={a.id} path={path} />}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
