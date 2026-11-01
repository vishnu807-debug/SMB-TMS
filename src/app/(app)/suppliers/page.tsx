import Link from "next/link";
import type { Metadata } from "next";
import { Plus, Search } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requirePermission("supplier.view");
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("suppliers")
    .select("id, code, name, trn, category, city, country, email, phone, currency_code, lead_time_days, status, terms:payment_terms(name), contacts:supplier_contacts(name, is_primary)")
    .order("name").limit(500);
  const term = (sp.q ?? "").trim().replace(/[%,()]/g, " ");
  if (term) q = q.or(`name.ilike.%${term}%,code.ilike.%${term}%,trn.ilike.%${term}%,category.ilike.%${term}%,email.ilike.%${term}%`);
  if (sp.status) q = q.eq("status", sp.status);
  const { data: rows } = await q;

  return (
    <>
      <PageHeader title="Suppliers" description={`${rows?.length ?? 0} suppliers`}
        actions={can(user, "supplier.edit") && <Link href="/suppliers/new" className={buttonVariants()}><Plus /> New supplier</Link>} />
      <Card>
        <form className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <Input name="q" defaultValue={sp.q} placeholder="Search name, code, TRN, category or email" className="pl-9" />
          </div>
          <Select name="status" defaultValue={sp.status ?? ""} className="w-40">
            <option value="">All statuses</option><option value="active">Active</option><option value="on_hold">On hold</option>
            <option value="blocked">Blocked</option><option value="inactive">Inactive</option>
          </Select>
          <button className={buttonVariants({ variant: "outline" })}>Filter</button>
        </form>
        <Table>
          <THead><TR><TH>Code</TH><TH>Supplier</TH><TH>Category</TH><TH>Contact</TH><TH>Location</TH><TH>Currency</TH><TH>Terms</TH><TH numeric>Lead time</TH><TH>Status</TH></TR></THead>
          <TBody>
            {(rows ?? []).length === 0 && <EmptyRow colSpan={9}>No suppliers found.</EmptyRow>}
            {(rows ?? []).map((s: any) => (
              <TR key={s.id}>
                <TD className="font-mono text-xs">{s.code}</TD>
                <TD><Link href={`/suppliers/${s.id}`} className="font-medium text-navy-800 hover:underline">{s.name}</Link>
                  <p className="text-xs text-slate-500">{s.email ?? s.phone ?? ""}</p></TD>
                <TD>{s.category ?? "—"}</TD>
                <TD>{s.contacts?.find((c: any) => c.is_primary)?.name ?? s.contacts?.[0]?.name ?? "—"}</TD>
                <TD>{[s.city, s.country].filter(Boolean).join(", ") || "—"}</TD>
                <TD>{s.currency_code}</TD>
                <TD>{s.terms?.name ?? "—"}</TD>
                <TD numeric>{s.lead_time_days ? `${s.lead_time_days} d` : "—"}</TD>
                <TD><StatusBadge status={s.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
