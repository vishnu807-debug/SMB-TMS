import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, humanize } from "@/lib/utils";
import { PasswordForm, ProfileForm, SessionButtons } from "./forms";

export const metadata: Metadata = { title: "My profile" };

function device(ua: string | null) {
  if (!ua) return "Unknown device";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "Other";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}

export default async function ProfilePage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [{ data: p }, { data: roles }, { data: sessions }, { data: events }] = await Promise.all([
    supabase.from("profiles").select("*, department:departments(name), manager:profiles!profiles_manager_id_fkey(full_name)").eq("id", user.id).single(),
    supabase.from("user_roles").select("role:roles(name)").eq("user_id", user.id),
    supabase.rpc("list_user_sessions", { p_user: user.id }),
    supabase.from("auth_events").select("event_type, created_at, ip").eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
  ]);
  return (
    <>
      <PageHeader title="My profile" description={user.email} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div><dt className="text-xs uppercase tracking-wide text-slate-500">Roles</dt><dd className="mt-1 flex flex-wrap gap-1">{(roles ?? []).map((r: any) => <Badge key={r.role.name} tone="navy">{r.role.name}</Badge>)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-slate-500">Department</dt><dd className="mt-1">{p?.department?.name ?? "—"}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-slate-500">Job title</dt><dd className="mt-1">{p?.job_title ?? "—"}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-slate-500">Manager</dt><dd className="mt-1">{p?.manager?.full_name ?? "—"}</dd></div>
            </dl>
            <p className="text-xs text-slate-500">Roles, department and job title are managed by your administrator.</p>
            <ProfileForm fullName={p?.full_name ?? ""} phone={p?.phone ?? null} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Change password</CardTitle></CardHeader>
          <CardContent><PasswordForm email={user.email} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Signed-in devices</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ul className="divide-y divide-slate-100 text-sm">
              {(sessions ?? []).length === 0 && <li className="py-2 text-slate-500">Session details are not available.</li>}
              {(sessions ?? []).map((s: any) => (
                <li key={s.id} className="flex justify-between py-2"><span>{device(s.user_agent)}{s.ip && <span className="text-slate-500"> · {s.ip}</span>}</span><span className="text-slate-500">Last active {formatDateTime(s.updated_at ?? s.created_at)}</span></li>
              ))}
            </ul>
            <SessionButtons />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent security activity</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y divide-slate-100 text-sm">
              {(events ?? []).length === 0 && <li className="py-2 text-slate-500">No activity recorded yet.</li>}
              {(events ?? []).map((e: any, i: number) => (
                <li key={i} className="flex justify-between py-2"><span>{humanize(e.event_type)}</span><span className="text-slate-500">{formatDateTime(e.created_at)}{e.ip && ` · ${e.ip}`}</span></li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
