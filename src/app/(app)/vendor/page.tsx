import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle, StatCard } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { EmptyRow, TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import { ModuleForm, type ModuleRow } from "./module-form";
import { getBranding } from "@/lib/branding";
import { BrandingForm } from "@/components/settings/branding-form";

export const metadata: Metadata = { title: "Vendor console" };

/** For the software vendor's support account only: licensed modules for this client installation. */
export default async function VendorConsolePage() {
  const user = await requirePlatformAdmin();
  const supabase = await createClient();
  const [{ data: modules }, { data: log }, { data: summary }] = await Promise.all([
    supabase.from("system_modules").select("code, name, description, is_core, is_enabled, requires").order("sort_order"),
    supabase.from("module_change_log").select("id, changed_at, module_code, enabled, changed_by_label, reference").order("changed_at", { ascending: false }).limit(50),
    supabase.rpc("vendor_installation_summary"),
  ]);
  const s = (summary ?? {}) as { company?: string; active_users?: number; total_users?: number; departments?: number; last_sign_in?: string };
  const rows = (modules ?? []) as ModuleRow[];
  const name = (c: string) => rows.find((m) => m.code === c)?.name ?? c;
  const licensed = rows.filter((m) => !m.is_core && m.is_enabled).length;

  return (
    <>
      <PageHeader title="Vendor console"
        description={<>Licensed modules for <strong>{s.company || "this client"}</strong>. Only the system provider sees this page — signed in as {user.email}.</>} />
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Client" value={<span className="text-lg">{s.company || "—"}</span>} hint="From System Settings → Company" />
          <StatCard label="Licensed modules" value={`${licensed} of ${rows.filter((m) => !m.is_core).length}`} hint="Core is always included" />
          <StatCard label="Active users" value={s.active_users ?? 0} hint={`${s.total_users ?? 0} in total · ${s.departments ?? 0} departments`} />
          <StatCard label="Last user sign-in" value={<span className="text-lg">{s.last_sign_in ? formatDateTime(s.last_sign_in) : "—"}</span>} />
        </div>

        <Card>
          <CardHeader><CardTitle>Licensed modules</CardTitle><span className="text-xs text-slate-500">Applies to every department and user of this client</span></CardHeader>
          <CardContent className="space-y-4">
            <Alert tone="info">
              A module that is switched off disappears from menus, pages, reports and the database for everyone — including the client&apos;s
              Super Administrator. Its data is kept. Inside a licensed module, the client&apos;s own administrator decides which departments
              and users get access through roles.
            </Alert>
            <ModuleForm modules={rows} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Product name, logos and login screen</CardTitle><span className="text-xs text-slate-500">The client&apos;s Super Administrator can change everything here except the product name and product logo</span></CardHeader>
          <CardContent><BrandingForm initial={await getBranding()} vendor /></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Change history</CardTitle><span className="text-xs text-slate-500">Last 50 changes</span></CardHeader>
          <Table>
            <THead><TR><TH>When</TH><TH>Module</TH><TH>Change</TH><TH>By</TH><TH>Reference</TH></TR></THead>
            <TBody>
              {(log ?? []).length === 0 && <EmptyRow colSpan={5}>No changes recorded yet.</EmptyRow>}
              {(log ?? []).map((l) => (
                <TR key={l.id}>
                  <TD className="whitespace-nowrap">{formatDateTime(l.changed_at)}</TD>
                  <TD className="font-medium">{name(l.module_code)}</TD>
                  <TD>{l.enabled ? <Badge tone="green">Switched on</Badge> : <Badge tone="red">Switched off</Badge>}</TD>
                  <TD className="text-slate-600">{l.changed_by_label}</TD>
                  <TD className="text-slate-600">{l.reference ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
