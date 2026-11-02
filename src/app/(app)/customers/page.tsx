import Link from "next/link";
import type { Metadata } from "next";
import { Plus, Search, Upload } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatMoney } from "@/lib/utils";

export const metadata: Metadata = { title: "Customers" };
const PAGE = 50;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; rep?: string; page?: string }> }) {
  const user = await requirePermission("customer.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  let q = supabase.from("customers")
    .select("id, code, name, trn, phone, email, status, credit_limit, currency_code, rep:profiles!customers_account_manager_id_fkey(full_name), terms:payment_terms(name), contacts:customer_contacts(name, is_primary)", { count: "exact" })
    .order("name").range((page - 1) * PAGE, page * PAGE - 1);
  const term = (sp.q ?? "").trim().replace(/[%,()]/g, " ");
  if (term) q = q.or(`name.ilike.%${term}%,code.ilike.%${term}%,trn.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%`);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.rep) q = q.eq("account_manager_id", sp.rep);
  const [{ data: rows, count }, { data: reps }] = await Promise.all([
    q, can(user, "customer.view_all") ? supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name") : Promise.resolve({ data: [] }),
  ]);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));

  return (
    <>
      <PageHeader title="Customers" description={can(user, "customer.view_all") ? `${count ?? 0} customers` : `${count ?? 0} customers assigned to you`}
        actions={can(user, "customer.create") && <>
          <Link href="/customers/import" className={buttonVariants({ variant: "outline" })}><Upload /> Import</Link>
          <Link href="/customers/new" className={buttonVariants()}><Plus /> New customer</Link>
        </>} />
      <Card>
        <form className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <Input name="q" defaultValue={sp.q} placeholder="Search name, code, TRN, email or phone" className="pl-9" />
          </div>
          <Select name="status" defaultValue={sp.status ?? ""} className="w-40">
            <option value="">All statuses</option><option value="active">Active</option><option value="on_hold">On hold</option>
            <option value="blocked">Blocked</option><option value="inactive">Inactive</option>
          </Select>
          {(reps ?? []).length > 0 && (
            <Select name="rep" defaultValue={sp.rep ?? ""} className="w-52">
              <option value="">All sales reps</option>
              {(reps ?? []).map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
            </Select>
          )}
          <button className={buttonVariants({ variant: "outline" })}>Filter</button>
        </form>
        <Table>
          <THead><TR><TH>Code</TH><TH>Customer</TH><TH>Primary contact</TH><TH>TRN</TH><TH>Payment terms</TH><TH numeric>Credit limit</TH><TH>Sales rep</TH><TH>Status</TH></TR></THead>
          <TBody>
            {(rows ?? []).length === 0 && <EmptyRow colSpan={8}>No customers found.</EmptyRow>}
            {(rows ?? []).map((c: any) => (
              <TR key={c.id}>
                <TD className="font-mono text-xs">{c.code}</TD>
                <TD><Link href={`/customers/${c.id}`} className="font-medium text-navy-800 hover:underline">{c.name}</Link>
                  <p className="text-xs text-slate-500">{c.email ?? c.phone ?? ""}</p></TD>
                <TD>{c.contacts?.find((x: any) => x.is_primary)?.name ?? c.contacts?.[0]?.name ?? "—"}</TD>
                <TD className="font-mono text-xs">{c.trn ?? "—"}</TD>
                <TD>{c.terms?.name ?? "—"}</TD>
                <TD numeric>{Number(c.credit_limit) > 0 ? formatMoney(c.credit_limit) : "—"}</TD>
                <TD>{c.rep?.full_name ?? "—"}</TD>
                <TD><StatusBadge status={c.status} /></TD>
              </TR>
            ))}
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
