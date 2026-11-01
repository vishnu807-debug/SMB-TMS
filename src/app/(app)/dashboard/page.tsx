import Link from "next/link";
import type { Metadata } from "next";
import { CalendarClock, FileText, Phone, ShoppingCart } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, StatCard } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { BarList, ColumnChart } from "@/components/dashboard/charts";
import { cn, formatDate, formatDateTime, formatMoney, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "Sales dashboard" };

const PERIODS = { month: "This month", last_month: "Last month", quarter: "This quarter", year: "This year" } as const;

function range(p: string): [string, string] {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Dubai" }));
  const y = now.getFullYear(), m = now.getMonth();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (p === "last_month") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
  if (p === "quarter") return [iso(new Date(y, Math.floor(m / 3) * 3, 1)), iso(now)];
  if (p === "year") return [iso(new Date(y, 0, 1)), iso(now)];
  return [iso(new Date(y, m, 1)), iso(now)];
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ period?: string; rep?: string }> }) {
  const user = await requirePermission("dashboard.sales");
  const sp = await searchParams;
  const period = sp.period && sp.period in PERIODS ? sp.period : "month";
  const [from, to] = range(period);
  const supabase = await createClient();
  const seeAll = can(user, "sales_order.view_all") && can(user, "quotation.view_all");
  const rep = seeAll ? sp.rep || null : null;
  const in7 = new Date(Date.now() + 7 * 864e5).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 14 * 864e5).toISOString();

  let followQ = supabase.from("activities")
    .select("id, subject, activity_type, due_at, lead:leads(id, doc_no, title), customer:customers(id, name), quotation:quotations(id, doc_no), sales_order:sales_orders(id, doc_no)")
    .is("completed_at", null).lte("due_at", in7).order("due_at").limit(8);
  followQ = followQ.eq("owner_id", rep ?? user.id);
  let ordersQ = supabase.from("sales_orders")
    .select("id, doc_no, required_date, status, total, currency_code, customer:customers(name), lines:sales_order_lines(stock_status, delivery_status, is_cancelled)")
    .in("status", ["pending_approval", "confirmed", "partially_fulfilled", "on_hold"]).order("required_date", { ascending: true, nullsFirst: false }).limit(8);
  let quotesQ = supabase.from("quotations")
    .select("id, doc_no, status, valid_until, total, currency_code, customer:customers(name)")
    .in("status", ["pending_approval", "approved", "sent"]).order("valid_until").limit(8);
  if (rep) { ordersQ = ordersQ.eq("sales_rep_id", rep); quotesQ = quotesQ.eq("sales_rep_id", rep); }
  let recentActs = supabase.from("activities")
    .select("id, subject, activity_type, completed_at, created_at, owner:profiles!activities_owner_id_fkey(full_name), lead:leads(id, doc_no, company_name), customer:customers(id, name)")
    .gte("created_at", since).order("created_at", { ascending: false }).limit(10);
  if (rep) recentActs = recentActs.eq("owner_id", rep);

  const [dash, follow, orders, quotes, acts, newQuotes, newOrders, reps] = await Promise.all([
    supabase.rpc("sales_dashboard", { p_from: from, p_to: to, p_rep: rep }),
    followQ, ordersQ, quotesQ, recentActs,
    supabase.from("quotations").select("id, doc_no, created_at, total, currency_code, customer:customers(id, name)").gte("created_at", since).order("created_at", { ascending: false }).limit(10),
    supabase.from("sales_orders").select("id, doc_no, created_at, total, currency_code, customer:customers(id, name)").gte("created_at", since).order("created_at", { ascending: false }).limit(10),
    seeAll ? supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name") : Promise.resolve({ data: [] }),
  ]);
  if (dash.error) return <Alert tone="error">The dashboard could not be loaded: {dash.error.message}</Alert>;
  const d: any = dash.data;
  const k = d.kpis;

  // Customer activity timeline: calls/meetings plus new quotations and orders.
  const timeline = [
    ...(acts.data ?? []).map((a: any) => ({ at: a.completed_at ?? a.created_at, icon: <Phone className="size-3.5" />, text: `${humanize(a.activity_type)}: ${a.subject}`,
      who: a.customer?.name ?? a.lead?.company_name ?? a.lead?.doc_no, href: a.customer ? `/customers/${a.customer.id}` : a.lead ? `/leads/${a.lead.id}` : null, by: a.owner?.full_name })),
    ...(newQuotes.data ?? []).map((q: any) => ({ at: q.created_at, icon: <FileText className="size-3.5" />, text: `Quotation ${q.doc_no} · ${formatMoney(q.total, q.currency_code)}`,
      who: q.customer?.name, href: `/quotations/${q.id}`, by: null })),
    ...(newOrders.data ?? []).map((o: any) => ({ at: o.created_at, icon: <ShoppingCart className="size-3.5" />, text: `Order ${o.doc_no} · ${formatMoney(o.total, o.currency_code)}`,
      who: o.customer?.name, href: `/sales-orders/${o.id}`, by: null })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 12);

  const STAGE_ORDER = ["new", "contacted", "qualified", "quoted", "won", "lost"];
  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Sales dashboard"
        description={`${formatDate(from)} – ${formatDate(to)} · ${d.scope === "all" && !rep ? "whole team" : rep ? "selected sales rep" : "your figures"} · amounts in AED`}
        actions={
          <form className="flex gap-2">
            <Select name="period" defaultValue={period} className="w-40">{Object.entries(PERIODS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
            {(reps.data ?? []).length > 0 && (
              <Select name="rep" defaultValue={sp.rep ?? ""} className="w-48">
                <option value="">Whole team</option>{(reps.data ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
              </Select>
            )}
            <button className={buttonVariants({ variant: "outline" })}>Apply</button>
          </form>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Sales (orders)" value={formatMoney(k.sales_value)} hint={`${k.orders_count} confirmed order${k.orders_count === 1 ? "" : "s"}`} />
        {d.can_view_cost
          ? <StatCard label="Gross profit" value={formatMoney(k.gross_profit)} hint={k.gross_margin_pct === null ? "—" : `${k.gross_margin_pct}% margin`} tone={k.gross_margin_pct !== null && k.gross_margin_pct < 15 ? "warning" : "default"} />
          : <StatCard label="Quotations sent" value={k.quotes_count} hint={formatMoney(k.quotes_value)} />}
        <StatCard label="Quotation win rate" value={k.quote_win_rate === null ? "—" : `${k.quote_win_rate}%`} hint="Converted ÷ decided quotations" />
        <StatCard label="Open quotations" value={formatMoney(k.open_quotes_value)} hint={`Pipeline ${formatMoney(k.pipeline_value)} · weighted ${formatMoney(k.weighted_pipeline)}`} />
        <StatCard label="Open orders" value={k.open_orders_count} hint={formatMoney(k.open_orders_value)} />
        <StatCard label="Follow-ups" value={k.overdue_followups} tone={k.overdue_followups > 0 ? "danger" : "success"} hint={`overdue · ${k.due_today_followups} due today`} />
      </div>
      {k.pending_approvals > 0 && (
        <Alert tone="warning" className="mb-6"><Link href="/approvals" className="font-medium underline">{k.pending_approvals} item{k.pending_approvals === 1 ? "" : "s"} waiting for your approval</Link></Alert>
      )}

      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Monthly sales — confirmed orders, last 12 months (AED incl. VAT)</CardTitle></CardHeader>
          <CardContent>
            <ColumnChart valueLabel="Sales" data={(d.monthly_sales ?? []).map((m: any) => ({ label: m.label, value: Number(m.sales), sub: `${m.orders} order${m.orders === 1 ? "" : "s"}` }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Quotations by status — this period</CardTitle></CardHeader>
          <CardContent>
            <BarList rows={(d.quotes_by_status ?? []).map((q: any) => ({ label: humanize(q.status), value: Number(q.value), note: `${q.count}`, href: `/quotations?status=${q.status}` }))} />
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Enquiry pipeline (estimated value)</CardTitle><Link href="/leads" className="text-sm text-navy-700 hover:underline">Enquiries</Link></CardHeader>
          <CardContent>
            <BarList rows={[...(d.leads_by_stage ?? [])].sort((a: any, b: any) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))
              .map((s: any) => ({ label: humanize(s.stage), value: Number(s.value), note: `${s.count}`, href: `/leads?stage=${s.stage}` }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Top customers — this period</CardTitle></CardHeader>
          <CardContent>
            <BarList rows={(d.top_customers ?? []).map((c: any) => ({ label: c.name, value: Number(c.value), note: `${c.orders} ord.`, href: `/customers/${c.customer_id}` }))} />
          </CardContent>
        </Card>
        {d.by_rep ? (
          <Card>
            <CardHeader><CardTitle>Sales by representative</CardTitle></CardHeader>
            <CardContent>
              <BarList rows={(d.by_rep ?? []).map((r: any) => ({ label: r.name, value: Number(r.sales), note: `${r.orders} ord. · ${r.quotes} qt.` }))} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader><CardTitle>Quotations needing attention</CardTitle></CardHeader>
            <QuoteList quotes={quotes.data ?? []} today={today} />
          </Card>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="size-4" /> Follow-ups due</CardTitle><Link href="/follow-ups" className="text-sm text-navy-700 hover:underline">All</Link></CardHeader>
          <ul className="divide-y divide-slate-100">
            {(follow.data ?? []).length === 0 && <li className="p-5 text-sm text-slate-500">Nothing due in the next 7 days.</li>}
            {(follow.data ?? []).map((a: any) => {
              const overdue = a.due_at && new Date(a.due_at).getTime() < now;
              const href = a.lead ? `/leads/${a.lead.id}` : a.quotation ? `/quotations/${a.quotation.id}` : a.sales_order ? `/sales-orders/${a.sales_order.id}` : a.customer ? `/customers/${a.customer.id}` : "/follow-ups";
              return (
                <li key={a.id} className="px-5 py-2.5">
                  <Link href={href} className="text-sm font-medium text-slate-900 hover:text-navy-800 hover:underline">{a.subject}</Link>
                  <p className={cn("text-xs", overdue ? "font-semibold text-red-700" : "text-slate-500")}>
                    {formatDateTime(a.due_at)}{overdue && " · overdue"} · {a.customer?.name ?? a.lead?.title ?? a.quotation?.doc_no ?? a.sales_order?.doc_no}
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader><CardTitle>Open orders</CardTitle><Link href="/sales-orders" className="text-sm text-navy-700 hover:underline">All</Link></CardHeader>
          <ul className="divide-y divide-slate-100">
            {(orders.data ?? []).length === 0 && <li className="p-5 text-sm text-slate-500">No open orders.</li>}
            {(orders.data ?? []).map((o: any) => {
              const ls = (o.lines ?? []).filter((l: any) => !l.is_cancelled);
              const ready = ls.filter((l: any) => l.stock_status === "reserved").length;
              const late = o.required_date && o.required_date < today;
              return (
                <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/sales-orders/${o.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{o.doc_no}</Link>
                    <p className="truncate text-sm text-slate-700">{o.customer?.name}</p>
                    <p className={cn("text-xs", late ? "font-semibold text-red-700" : "text-slate-500")}>{ready}/{ls.length} lines ready · due {formatDate(o.required_date)}</p>
                  </div>
                  <div className="text-right"><p className="text-sm tabular-nums">{formatMoney(o.total)}</p><StatusBadge status={o.status} /></div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader><CardTitle>Customer activity — last 14 days</CardTitle></CardHeader>
          <ul className="space-y-3 p-5">
            {timeline.length === 0 && <li className="text-sm text-slate-500">No recent activity.</li>}
            {timeline.map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy-700">{t.icon}</span>
                <div className="min-w-0 text-sm">
                  <p className="truncate text-slate-900">{t.href ? <Link href={t.href} className="hover:underline">{t.who ?? "—"}</Link> : t.who}</p>
                  <p className="truncate text-slate-600">{t.text}</p>
                  <p className="text-xs text-slate-500">{formatDateTime(t.at)}{t.by && ` · ${t.by}`}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {d.by_rep && (
        <Card className="mt-6">
          <CardHeader><CardTitle>Quotations needing attention</CardTitle></CardHeader>
          <QuoteList quotes={quotes.data ?? []} today={today} />
        </Card>
      )}
    </>
  );
}

function QuoteList({ quotes, today }: { quotes: any[]; today: string }) {
  return (
    <ul className="divide-y divide-slate-100">
      {quotes.length === 0 && <li className="p-5 text-sm text-slate-500">No quotations waiting.</li>}
      {quotes.map((q) => (
        <li key={q.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
          <div className="min-w-0">
            <Link href={`/quotations/${q.id}`} className="font-mono text-xs font-semibold text-navy-800 hover:underline">{q.doc_no}</Link>
            <p className="truncate text-sm text-slate-700">{q.customer?.name}</p>
            <p className={cn("text-xs", q.valid_until < today ? "font-semibold text-red-700" : "text-slate-500")}>Valid until {formatDate(q.valid_until)}</p>
          </div>
          <div className="text-right"><p className="text-sm tabular-nums">{formatMoney(q.total, q.currency_code)}</p><StatusBadge status={q.status} /></div>
        </li>
      ))}
    </ul>
  );
}
