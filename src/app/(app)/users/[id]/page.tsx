import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission, can } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { DetailsForm, PermissionsPanel, RolesForm, StatusControl } from "../user-forms";
import { formatDateTime, humanize } from "@/lib/utils";

export const metadata: Metadata = { title: "User" };

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requirePermission("user.view");
  const supabase = await createClient();
  const { data: u } = await supabase.from("v_users").select("*").eq("id", id).maybeSingle();
  if (!u) notFound();
  const canSessions = can(me, "session.manage") || id === me.id;
  const [{ data: roles }, { data: depts }, { data: people }, { data: perms }, { data: custom }, { data: events }, { data: sessions }, { data: p }] = await Promise.all([
    supabase.from("roles").select("code, name, description, department:departments(name)").eq("is_active", true).order("sort_order"),
    supabase.from("departments").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.rpc("user_effective_permissions", { p_user: id }),
    supabase.from("user_permissions").select("effect, reason, expires_at, permission:permissions(code)").eq("user_id", id),
    supabase.from("auth_events").select("event_type, created_at, ip, details, actor:profiles!auth_events_actor_id_fkey(full_name)").eq("user_id", id).order("created_at", { ascending: false }).limit(15),
    canSessions ? supabase.rpc("list_user_sessions", { p_user: id }) : Promise.resolve({ data: [] }),
    supabase.from("profiles").select("phone").eq("id", id).single(),
  ]);
  const isSuper = u.role_codes.includes("super_admin");
  const iAmSuper = me.permissions.has("user.manage") && (await supabase.rpc("is_super_admin", { p_user: me.id })).data === true;
  const manage = can(me, "user.manage") && (!isSuper || iAmSuper);
  const grant = (can(me, "user.grant_permissions") || can(me, "user.manage")) && (!isSuper || iAmSuper) && (id !== me.id || iAmSuper);

  return (
    <>
      <PageHeader back={{ href: "/users", label: "User management" }}
        title={<span className="flex items-center gap-3">{u.full_name || u.email} {u.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</span>}
        description={`${u.email} · last sign-in ${u.last_sign_in_at ? formatDateTime(u.last_sign_in_at) : "never"}`} />
      {!u.is_active && <Alert tone="warning" className="mb-4">Deactivated {formatDateTime(u.deactivated_at)}: {u.deactivation_reason}</Alert>}
      {isSuper && !iAmSuper && <Alert tone="info" className="mb-4">This is a Super Administrator. Only another Super Administrator can change this account.</Alert>}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Employee details</CardTitle></CardHeader>
          <CardContent>
            <DetailsForm id={id} disabled={!manage} departments={depts ?? []} managers={(people ?? []).map((x) => ({ id: x.id, name: x.full_name }))}
              initial={{ full_name: u.full_name ?? "", job_title: u.job_title ?? "", employee_code: u.employee_code ?? "", phone: p?.phone ?? "",
                department_id: u.department_id ?? "", manager_id: u.manager_id ?? "" }} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Roles</CardTitle></CardHeader>
          <CardContent>
            <RolesForm id={id} disabled={!manage || (id === me.id && !iAmSuper)} initial={u.role_codes}
              roles={(roles ?? []).filter((r: any) => r.code !== "super_admin" || iAmSuper).map((r: any) => ({ code: r.code, name: r.name, description: r.description, department: r.department?.name ?? null }))} />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Permissions</CardTitle></CardHeader>
          <CardContent>
            <PermissionsPanel id={id} canGrant={grant} perms={(perms ?? []) as any}
              custom={(custom ?? []).map((c: any) => ({ code: c.permission.code, effect: c.effect, reason: c.reason, expires_at: c.expires_at }))} />
          </CardContent>
        </Card>
        {(manage || canSessions) && id !== me.id && (
          <Card>
            <CardHeader><CardTitle>Access status and sessions</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {manage && <StatusControl id={id} active={u.is_active} email={u.email} />}
              {canSessions && (
                <ul className="divide-y divide-slate-100 text-sm">
                  {(sessions ?? []).length === 0 && <li className="py-2 text-slate-500">No active sessions.</li>}
                  {(sessions ?? []).map((s: any) => <li key={s.id} className="flex justify-between py-2"><span className="truncate">{s.user_agent ?? "Unknown device"}</span><span className="text-slate-500">{formatDateTime(s.updated_at ?? s.created_at)}</span></li>)}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle>Security activity</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100 text-sm">
              {(events ?? []).length === 0 && <li className="py-2 text-slate-500">Nothing recorded.</li>}
              {(events ?? []).map((e: any, i: number) => (
                <li key={i} className="py-2">
                  <div className="flex justify-between"><span className="font-medium">{humanize(e.event_type)}</span><span className="text-slate-500">{formatDateTime(e.created_at)}</span></div>
                  <p className="text-xs text-slate-500">{[e.actor?.full_name && `by ${e.actor.full_name}`, e.ip, e.details?.reason, e.details?.permission && `${e.details.effect} ${e.details.permission}`, e.details?.to && `roles: ${e.details.to.join(", ")}`].filter(Boolean).join(" · ")}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
