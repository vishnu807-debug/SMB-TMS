import Link from "next/link";
import type { Metadata } from "next";
import { Search, ShieldCheck, UserPlus } from "lucide-react";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "User management" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; dept?: string }> }) {
  const user = await requirePermission("user.view");
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("v_users").select("*").order("full_name");
  if (sp.status !== "all") q = q.eq("is_active", sp.status !== "inactive");
  if (sp.dept) q = q.eq("department_id", sp.dept);
  const term = (sp.q ?? "").trim().replace(/[%,()]/g, " ");
  if (term) q = q.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,employee_code.ilike.%${term}%,job_title.ilike.%${term}%`);
  const [{ data: rows }, { data: depts }] = await Promise.all([q, supabase.from("departments").select("id, name").order("name")]);

  return (
    <>
      <PageHeader title="User management" description="Employees, their departments, roles and access."
        actions={<>
          {can(user, "role.manage") && <Link href="/users/roles" className={buttonVariants({ variant: "outline" })}><ShieldCheck /> Roles & permissions</Link>}
          {can(user, "user.manage") && <Link href="/users/new" className={buttonVariants()}><UserPlus /> Add user</Link>}
        </>} />
      <Card>
        <form className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-slate-400" />
            <Input name="q" defaultValue={sp.q} placeholder="Name, email, employee code or job title" className="pl-9" />
          </div>
          <Select name="dept" defaultValue={sp.dept ?? ""} className="w-56">
            <option value="">All departments</option>{(depts ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select name="status" defaultValue={sp.status ?? "active"} className="w-36">
            <option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option>
          </Select>
          <button className={buttonVariants({ variant: "outline" })}>Filter</button>
        </form>
        <Table>
          <THead><TR><TH>Name</TH><TH>Department</TH><TH>Roles</TH><TH>Last sign-in</TH><TH>Status</TH></TR></THead>
          <TBody>
            {(rows ?? []).length === 0 && <EmptyRow colSpan={5}>No users found.</EmptyRow>}
            {(rows ?? []).map((u) => (
              <TR key={u.id}>
                <TD>
                  <Link href={`/users/${u.id}`} className="font-medium text-navy-800 hover:underline">{u.full_name || u.email}</Link>
                  <p className="text-xs text-slate-500">{u.email}{u.employee_code && ` · ${u.employee_code}`}{u.job_title && ` · ${u.job_title}`}</p>
                </TD>
                <TD>{u.department_name ?? "—"}</TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {u.role_names.length === 0 && <span className="text-xs text-amber-700">No role</span>}
                    {u.role_names.map((r: string) => <Badge key={r} tone="navy">{r}</Badge>)}
                    {u.extra_permissions > 0 && <Badge tone="amber">+{u.extra_permissions} custom</Badge>}
                  </div>
                </TD>
                <TD className="whitespace-nowrap text-slate-600">{u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : "Never"}</TD>
                <TD>{u.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
