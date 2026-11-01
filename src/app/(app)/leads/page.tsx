import Link from "next/link";
import type { Metadata } from "next";
import { Plus, Search } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { cn, formatDate, formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Leads & enquiries" };
const STAGES = ["new", "contacted", "qualified", "quoted", "won", "lost"] as const;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ q?: string; stage?: string; owner?: string }> }) {
  const user = await requirePermission("lead.view");
  const sp = await searchParams;
  const supabase = await createClient();
  const open = !sp.stage || sp.stage === "open";
  let q = supabase.from("leads")
    .select("id, doc_no, title, company_name, stage, priority, probability, estimated_value, currency_code, expected_close_date, created_at, customer:customers(name), owner:profiles!leads_owner_id_fkey(full_name)")
    .order("created_at", { ascending: false }).limit(300);
  if (open) q = q.in("stage", ["new", "contacted", "qualified", "quoted"]);
  else if (sp.stage !== "all") q = q.eq("stage", sp.stage!);
  const term = (sp.q ?? "").trim().replace(/[%,()]/g, " ");
  if (term) q = q.or(`title.ilike.%${term}%,company_name.ilike.%${term}%,doc_no.ilike.%${term}%,contact_name.ilike.%${term}%`);
  if (sp.owner) q = q.eq("owner_id", sp.owner);
  const [{ data: rows }, { data: pipeline }, { data: owners }, { data: nextFollow }] = await Promise.all([
    q,
    supabase.from("leads").select("stage, estimated_value"),
    can(user, "lead.view_all") ? supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name") : Promise.resolve({ data: [] }),
    supabase.from("activities").select("lead_id, due_at").not("lead_id", "is", null).is("completed_at", null).order("due_at"),
  ]);
  const byStage = Object.fromEntries(STAGES.map((s) => {
    const r = (pipeline ?? []).filter((p) => p.stage === s);
    return [s, { n: r.length, v: r.reduce((a, b) => a + Number(b.estimated_value ?? 0), 0) }];
  }));
  const next = new Map<string, string>();
  (nextFollow ?? []).forEach((a) => { if (a.lead_id && a.due_at && !next.has(a.lead_id)) next.set(a.lead_id, a.due_at); });
  const now = Date.now();

  return (
    <>
      <PageHeader title="Leads & enquiries" description="Register customer enquiries, follow them up and track the opportunity through to a quotation."
        actions={can(user, "lead.create") && <Link href="/leads/new" className={buttonVariants()}><Plus /> Register enquiry</Link>} />

      <div className="mb-6 grid grid-cols-3 gap-3 lg:grid-cols-6">
        {STAGES.map((s) => (
          <Link key={s} href={`?stage=${s}`} className={cn("rounded-lg border bg-white p-3 shadow-sm transition hover:border-navy-300",
            sp.stage === s ? "border-navy-500 ring-1 ring-navy-500" : "border-slate-200")}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{s}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{byStage[s].n}</p>
            <p className="text-xs text-slate-500">{formatMoney(byStage[s].v)}</p>
          </Link>
        ))}
      </div>

      <Card>
        <form className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <Input name="q" defaultValue={sp.q} placeholder="Search title, company, contact or number" className="pl-9" />
          </div>
          <Select name="stage" defaultValue={sp.stage ?? "open"} className="w-44">
            <option value="open">Open enquiries</option><option value="all">All</option>
            {STAGES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </Select>
          {(owners ?? []).length > 0 && (
            <Select name="owner" defaultValue={sp.owner ?? ""} className="w-52">
              <option value="">All owners</option>{(owners ?? []).map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
            </Select>
          )}
          <button className={buttonVariants({ variant: "outline" })}>Filter</button>
        </form>
        <Table>
          <THead><TR><TH>Number</TH><TH>Enquiry</TH><TH>Company</TH><TH numeric>Est. value</TH><TH numeric>Prob.</TH><TH>Next follow-up</TH><TH>Owner</TH><TH>Stage</TH></TR></THead>
          <TBody>
            {(rows ?? []).length === 0 && <EmptyRow colSpan={8}>No enquiries found.</EmptyRow>}
            {(rows ?? []).map((l: any) => {
              const due = next.get(l.id);
              return (
                <TR key={l.id}>
                  <TD className="font-mono text-xs">{l.doc_no}</TD>
                  <TD><Link href={`/leads/${l.id}`} className="font-medium text-navy-800 hover:underline">{l.title}</Link>
                    {l.priority === "high" && <Badge tone="red" className="ml-2">High</Badge>}</TD>
                  <TD>{l.customer?.name ?? l.company_name}</TD>
                  <TD numeric>{formatMoney(l.estimated_value, l.currency_code)}</TD>
                  <TD numeric>{l.probability}%</TD>
                  <TD className={due && new Date(due).getTime() < now ? "font-medium text-red-700" : ""}>{due ? formatDate(due) : "—"}</TD>
                  <TD>{l.owner?.full_name}</TD>
                  <TD><StatusBadge status={l.stage} /></TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
