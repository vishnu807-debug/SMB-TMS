import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { cn, formatDateTime, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Audit log" };
const PAGE = 100;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ view?: string; table?: string; user?: string; from?: string; to?: string; record?: string; page?: string }> }) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const view = sp.view === "security" ? "security" : "changes";
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const { data: people } = await supabase.from("profiles").select("id, full_name").order("full_name");
  const name = new Map((people ?? []).map((p) => [p.id, p.full_name]));

  let rows: any[] = [];
  let count = 0;
  if (view === "changes") {
    let q = supabase.from("audit_log").select("*", { count: "exact" }).order("changed_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
    if (sp.table) q = q.eq("table_name", sp.table);
    if (sp.user) q = q.eq("changed_by", sp.user);
    if (sp.record) q = q.eq("record_id", sp.record);
    if (sp.from) q = q.gte("changed_at", `${sp.from}T00:00:00+04:00`);
    if (sp.to) q = q.lte("changed_at", `${sp.to}T23:59:59+04:00`);
    const r = await q; rows = r.data ?? []; count = r.count ?? 0;
  } else {
    let q = supabase.from("auth_events").select("*", { count: "exact" }).order("created_at", { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);
    if (sp.user) q = q.eq("user_id", sp.user);
    if (sp.from) q = q.gte("created_at", `${sp.from}T00:00:00+04:00`);
    if (sp.to) q = q.lte("created_at", `${sp.to}T23:59:59+04:00`);
    const r = await q; rows = r.data ?? []; count = r.count ?? 0;
  }
  const pages = Math.max(1, Math.ceil(count / PAGE));
  const qs = (patch: Record<string, string>) => `?${new URLSearchParams({ ...(sp as Record<string, string>), ...patch })}`;
  const summary = (r: any) => {
    if (r.action === "UPDATE") return (r.changed_fields ?? []).map((f: string) => `${f}: ${JSON.stringify(r.old_data?.[f])} → ${JSON.stringify(r.new_data?.[f])}`).join("; ");
    const d = r.new_data ?? r.old_data ?? {};
    return [d.doc_no, d.code, d.name, d.full_name, d.sku].filter(Boolean).join(" · ");
  };

  return (
    <>
      <PageHeader title="Audit log" description="Every change to business records, and every sign-in and access change. Entries can never be edited or deleted." />
      <div className="mb-4 flex gap-2">
        <Link href="?view=changes" className={buttonVariants({ variant: view === "changes" ? "default" : "outline", size: "sm" })}>Record changes</Link>
        <Link href="?view=security" className={buttonVariants({ variant: view === "security" ? "default" : "outline", size: "sm" })}>Sign-ins & security</Link>
      </div>
      <Card>
        <form className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <input type="hidden" name="view" value={view} />
          {view === "changes" && <Input name="table" defaultValue={sp.table} placeholder="Table (e.g. quotations)" className="w-48" />}
          <Select name="user" defaultValue={sp.user ?? ""} className="w-52"><option value="">All users</option>{(people ?? []).map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</Select>
          <Input type="date" name="from" defaultValue={sp.from} className="w-40" aria-label="From" />
          <Input type="date" name="to" defaultValue={sp.to} className="w-40" aria-label="To" />
          <button className={buttonVariants({ variant: "outline" })}>Filter</button>
        </form>
        <Table>
          {view === "changes" ? (
            <>
              <THead><TR><TH>When</TH><TH>User</TH><TH>Table</TH><TH>Action</TH><TH>Details</TH></TR></THead>
              <TBody>
                {rows.length === 0 && <EmptyRow colSpan={5}>No entries.</EmptyRow>}
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap">{formatDateTime(r.changed_at)}</TD>
                    <TD>{r.changed_by ? name.get(r.changed_by) ?? "—" : "System"}</TD>
                    <TD><Link href={qs({ table: r.table_name, page: "1" })} className="font-mono text-xs hover:underline">{r.table_name}</Link></TD>
                    <TD><span className={cn("text-xs font-semibold", r.action === "DELETE" ? "text-red-700" : r.action === "INSERT" ? "text-emerald-700" : "text-slate-700")}>{r.action}</span></TD>
                    <TD className="max-w-xl"><p className="line-clamp-2 break-all font-mono text-[11px] text-slate-600" title={summary(r)}>{summary(r)}</p></TD>
                  </TR>
                ))}
              </TBody>
            </>
          ) : (
            <>
              <THead><TR><TH>When</TH><TH>Event</TH><TH>User / email</TH><TH>By</TH><TH>IP</TH><TH>Details</TH></TR></THead>
              <TBody>
                {rows.length === 0 && <EmptyRow colSpan={6}>No entries.</EmptyRow>}
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD className="whitespace-nowrap">{formatDateTime(r.created_at)}</TD>
                    <TD className={cn(["sign_in_failed", "account_locked"].includes(r.event_type) && "font-medium text-red-700")}>{humanize(r.event_type)}</TD>
                    <TD>{r.user_id ? name.get(r.user_id) ?? r.email : r.email}</TD>
                    <TD>{r.actor_id && r.actor_id !== r.user_id ? name.get(r.actor_id) : "—"}</TD>
                    <TD className="font-mono text-xs">{r.ip ?? "—"}</TD>
                    <TD className="max-w-md truncate font-mono text-[11px] text-slate-600">{Object.keys(r.details ?? {}).length ? JSON.stringify(r.details) : ""}</TD>
                  </TR>
                ))}
              </TBody>
            </>
          )}
        </Table>
        {pages > 1 && (
          <div className="flex justify-between border-t border-slate-200 px-4 py-3 text-sm">
            <span className="text-slate-600">Page {page} of {pages} · {count} entries</span>
            <div className="flex gap-2">
              {page > 1 && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs({ page: String(page - 1) })}>Previous</Link>}
              {page < pages && <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={qs({ page: String(page + 1) })}>Next</Link>}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
