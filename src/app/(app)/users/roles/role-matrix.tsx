"use client";
import { useMemo, useState, useTransition } from "react";
import { saveRole, saveRolePermissions } from "../actions";
import type { ActionResult } from "@/lib/errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type Perm = { code: string; module: string; description: string };
type Role = { id: string; code: string; name: string; description: string | null; is_system: boolean; is_active: boolean; perms: string[] };

export function RoleMatrix({ roles, perms, adminOnlyEditable }: { roles: Role[]; perms: Perm[]; adminOnlyEditable: boolean }) {
  const editable = roles.filter((r) => r.code !== "super_admin");
  const [roleCode, setRoleCode] = useState(editable[0]?.code ?? "");
  const role = roles.find((r) => r.code === roleCode);
  const [sel, setSel] = useState<Record<string, string[]>>(Object.fromEntries(roles.map((r) => [r.code, r.perms])));
  const [busy, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  const [newRole, setNewRole] = useState({ code: "", name: "", description: "" });
  const modules = useMemo(() => Array.from(new Set(perms.map((p) => p.module))), [perms]);
  const current = sel[roleCode] ?? [];
  const dirty = role && JSON.stringify([...current].sort()) !== JSON.stringify([...role.perms].sort());
  const isAdminPerm = (c: string) => ["user", "role", "session", "settings", "audit"].includes(c.split(".")[0]);
  const toggle = (code: string, on: boolean) => setSel((s) => ({ ...s, [roleCode]: on ? [...(s[roleCode] ?? []), code] : (s[roleCode] ?? []).filter((c) => c !== code) }));

  return (
    <div className="grid gap-6 lg:grid-cols-4">
      <Card className="h-fit">
        <CardHeader><CardTitle>Roles</CardTitle></CardHeader>
        <ul className="p-2">
          {roles.map((r) => (
            <li key={r.code}>
              <button disabled={r.code === "super_admin"} onClick={() => { setRoleCode(r.code); setRes(null); }}
                className={cn("w-full rounded-md px-3 py-2 text-left text-sm", r.code === roleCode ? "bg-navy-50 font-medium text-navy-900" : "hover:bg-slate-50", r.code === "super_admin" && "cursor-default opacity-60")}>
                {r.name} <span className="float-right text-xs text-slate-500">{r.code === "super_admin" ? "all" : (sel[r.code] ?? []).length}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="space-y-2 border-t border-slate-200 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">New role</p>
          <Input placeholder="Name, e.g. Sales Coordinator" value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value, code: e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") })} />
          <Input placeholder="Description" value={newRole.description} onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} />
          <Button size="sm" variant="outline" className="w-full" disabled={busy || newRole.name.length < 3}
            onClick={() => start(async () => { const r = await saveRole(newRole); setRes(r); if (r.ok) location.reload(); })}>Create role</Button>
        </div>
      </Card>

      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle>{role?.name} — permissions</CardTitle>
          <div className="flex gap-2">
            {dirty && <Button size="sm" variant="ghost" onClick={() => setSel((s) => ({ ...s, [roleCode]: role!.perms }))}>Undo changes</Button>}
            <Button size="sm" disabled={busy || !dirty} onClick={() => start(async () => setRes(await saveRolePermissions(roleCode, current)))}>Save role</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {res && <Alert tone={res.ok ? "success" : "error"}>{res.ok ? res.message : res.error}</Alert>}
          {role?.description && <p className="text-sm text-slate-500">{role.description}</p>}
          <p className="text-xs text-slate-500">Changes apply to every user with this role the next time they load a page. Individual exceptions are set on the user's own page.</p>
          {modules.map((m) => {
            const mp = perms.filter((p) => p.module === m);
            const all = mp.every((p) => current.includes(p.code));
            return (
              <div key={m}>
                <div className="mb-1.5 flex items-center justify-between border-b border-slate-100 pb-1">
                  <p className="text-sm font-semibold text-slate-800">{m}</p>
                  <button className="text-xs text-navy-700 hover:underline" onClick={() => mp.forEach((p) => (!isAdminPerm(p.code) || adminOnlyEditable) && toggle(p.code, !all))}>{all ? "Clear" : "Select all"}</button>
                </div>
                <div className="grid gap-1 sm:grid-cols-2">
                  {mp.map((p) => (
                    <label key={p.code} className={cn("flex gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50", isAdminPerm(p.code) && !adminOnlyEditable && "opacity-50")}>
                      <input type="checkbox" className="mt-0.5 size-4" checked={current.includes(p.code)} disabled={isAdminPerm(p.code) && !adminOnlyEditable}
                        onChange={(e) => toggle(p.code, e.target.checked)} />
                      <span>{p.description}<span className="block font-mono text-[11px] text-slate-400">{p.code}</span></span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
