"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { inviteUser, removeUserPermission, resendInvite, revokeSessions, setTemporaryPassword, setUserActive, setUserPermission, setUserRoles, updateUserDetails } from "./actions";
import type { ActionResult } from "@/lib/errors";
import { Field, Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

type Opt = { id: string; name: string };
type Role = { code: string; name: string; description: string | null; department: string | null };

function Msg({ r }: { r: ActionResult<any> | null }) {
  if (!r) return null;
  return <Alert tone={r.ok ? "success" : "error"}>{r.ok ? r.message ?? "Saved." : r.error}</Alert>;
}

/** A random password that meets the policy (no look-alike characters). */
function generatePassword() {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%*?"];
  const all = sets.join("");
  const pick = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  const chars = [...sets.map(pick), ...Array.from({ length: 10 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}

function TempPassword({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" autoComplete="new-password" aria-label="Temporary password" />
      <Button type="button" variant="outline" onClick={() => onChange(generatePassword())}>Generate</Button>
      <Button type="button" variant="outline" disabled={!value} onClick={() => navigator.clipboard?.writeText(value)}>Copy</Button>
    </div>
  );
}

function DetailsFields({ v, set, departments, managers }: { v: Record<string, string>; set: (k: string, x: string) => void; departments: Opt[]; managers: Opt[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Full name" htmlFor="full_name" required><Input id="full_name" value={v.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} /></Field>
      <Field label="Job title" htmlFor="job_title"><Input id="job_title" value={v.job_title ?? ""} onChange={(e) => set("job_title", e.target.value)} /></Field>
      <Field label="Department" htmlFor="department_id">
        <Select id="department_id" value={v.department_id ?? ""} onChange={(e) => set("department_id", e.target.value)}>
          <option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      </Field>
      <Field label="Reports to" htmlFor="manager_id">
        <Select id="manager_id" value={v.manager_id ?? ""} onChange={(e) => set("manager_id", e.target.value)}>
          <option value="">—</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </Select>
      </Field>
      <Field label="Employee code" htmlFor="employee_code"><Input id="employee_code" value={v.employee_code ?? ""} onChange={(e) => set("employee_code", e.target.value)} className="uppercase" /></Field>
      <Field label="Phone" htmlFor="phone"><Input id="phone" value={v.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></Field>
    </div>
  );
}

function RoleChecklist({ roles, selected, onChange, disabled }: { roles: Role[]; selected: string[]; onChange: (s: string[]) => void; disabled?: boolean }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {roles.map((r) => (
        <label key={r.code} className="flex cursor-pointer gap-2.5 rounded-md border border-slate-200 p-2.5 hover:bg-slate-50 has-[:checked]:border-navy-400 has-[:checked]:bg-navy-50/50">
          <input type="checkbox" className="mt-0.5 size-4" disabled={disabled} checked={selected.includes(r.code)}
            onChange={(e) => onChange(e.target.checked ? [...selected, r.code] : selected.filter((c) => c !== r.code))} />
          <span><span className="text-sm font-medium text-slate-900">{r.name}</span>{r.department && <span className="ml-1 text-xs text-slate-500">· {r.department}</span>}
            {r.description && <span className="block text-xs text-slate-500">{r.description}</span>}</span>
        </label>
      ))}
    </div>
  );
}

export function InviteForm({ roles, departments, managers }: { roles: Role[]; departments: Opt[]; managers: Opt[] }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const [res, setRes] = useState<ActionResult<{ id: string }> | null>(null);
  const [method, setMethod] = useState<"email" | "password">("email");
  const [password, setPassword] = useState("");
  const set = (k: string, x: string) => setV((p) => ({ ...p, [k]: x }));
  return (
    <div className="space-y-5">
      <Msg r={res} />
      <Field label="Work email" htmlFor="email" required hint="Used to sign in.">
        <Input id="email" type="email" value={v.email ?? ""} onChange={(e) => set("email", e.target.value)} />
      </Field>
      <div className="space-y-2 rounded-md border border-slate-200 p-3">
        <p className="text-sm font-medium text-slate-700">How will they get access?</p>
        <label className="flex items-start gap-2 text-sm"><input type="radio" className="mt-1" checked={method === "email"} onChange={() => setMethod("email")} />
          <span>Email an invitation <span className="block text-xs text-slate-500">They receive a link to set their own password. Needs email set up in Supabase.</span></span></label>
        <label className="flex items-start gap-2 text-sm"><input type="radio" className="mt-1" checked={method === "password"} onChange={() => { setMethod("password"); if (!password) setPassword(generatePassword()); }} />
          <span>Set a temporary password <span className="block text-xs text-slate-500">No email is sent. Give them the password yourself; they must choose their own when they first sign in.</span></span></label>
        {method === "password" && <TempPassword value={password} onChange={setPassword} />}
      </div>
      <DetailsFields v={v} set={set} departments={departments} managers={managers} />
      <div><p className="mb-2 text-sm font-medium text-slate-700">Roles</p><RoleChecklist roles={roles} selected={sel} onChange={setSel} /></div>
      <div className="flex justify-end">
        <Button disabled={busy} onClick={() => start(async () => {
          const r = await inviteUser({ ...v, roles: sel, method, password: method === "password" ? password : undefined });
          setRes(r);
          if (r.ok) router.push(`/users/${r.data!.id}`);
        })}>{busy && <Loader2 className="animate-spin" />} {method === "email" ? "Send invitation" : "Create user"}</Button>
      </div>
    </div>
  );
}

export function DetailsForm({ id, initial, departments, managers, disabled }: { id: string; initial: Record<string, string>; departments: Opt[]; managers: Opt[]; disabled: boolean }) {
  const [v, setV] = useState(initial);
  const [busy, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  return (
    <fieldset disabled={disabled} className="space-y-4">
      <Msg r={res} />
      <DetailsFields v={v} set={(k, x) => setV((p) => ({ ...p, [k]: x }))} departments={departments} managers={managers.filter((m) => m.id !== id)} />
      {!disabled && <div className="flex justify-end"><Button disabled={busy} onClick={() => start(async () => setRes(await updateUserDetails(id, v)))}>Save details</Button></div>}
    </fieldset>
  );
}

export function RolesForm({ id, roles, initial, disabled }: { id: string; roles: Role[]; initial: string[]; disabled: boolean }) {
  const [sel, setSel] = useState(initial);
  const [busy, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  return (
    <div className="space-y-3">
      <Msg r={res} />
      <RoleChecklist roles={roles} selected={sel} onChange={setSel} disabled={disabled} />
      {!disabled && <div className="flex justify-end"><Button disabled={busy} onClick={() => start(async () => setRes(await setUserRoles(id, sel)))}>Save roles</Button></div>}
    </div>
  );
}

export function StatusControl({ id, active, email }: { id: string; active: boolean; email: string }) {
  const [reason, setReason] = useState("");
  const [temp, setTemp] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  return (
    <div className="space-y-3">
      <Msg r={res} />
      {active ? (
        <div className="flex flex-wrap gap-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for deactivating (e.g. left the company)" className="min-w-[260px] flex-1" />
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => confirm("Deactivate this user? They are signed out everywhere immediately.") && start(async () => setRes(await setUserActive(id, false, reason)))}>Deactivate</Button>
        </div>
      ) : <Button variant="success" disabled={busy} onClick={() => start(async () => setRes(await setUserActive(id, true)))}>Reactivate</Button>}
      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => start(async () => setRes(await revokeSessions(id)))}>Sign out of all devices</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => start(async () => setRes(await resendInvite(email)))}>Send password-reset link</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setTemp(temp === null ? generatePassword() : null)}>Set temporary password</Button>
      </div>
      {temp !== null && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs text-slate-600">The user is signed out everywhere and must choose a new password when they next sign in. Copy the password before saving.</p>
          <TempPassword value={temp} onChange={setTemp} />
          <div className="flex justify-end"><Button size="sm" disabled={busy || !temp} onClick={() => start(async () => { const r = await setTemporaryPassword(id, temp); setRes(r); if (r.ok) setTemp(null); })}>Save temporary password</Button></div>
        </div>
      )}
    </div>
  );
}

type Perm = { code: string; module: string; description: string; granted: boolean; source: string | null };
type Custom = { code: string; effect: "grant" | "deny"; reason: string; expires_at: string | null };

export function PermissionsPanel({ id, perms, custom, canGrant }: { id: string; perms: Perm[]; custom: Custom[]; canGrant: boolean }) {
  const [code, setCode] = useState("");
  const [effect, setEffect] = useState<"grant" | "deny">("grant");
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [busy, start] = useTransition();
  const [res, setRes] = useState<ActionResult | null>(null);
  const [filter, setFilter] = useState("");
  const modules = Array.from(new Set(perms.map((p) => p.module)));
  const shown = perms.filter((p) => !filter || p.module === filter);
  return (
    <div className="space-y-5">
      <Msg r={res} />
      {custom.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">Individual changes for this user</p>
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {custom.map((c) => (
              <li key={c.code} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span><Badge tone={c.effect === "grant" ? "green" : "red"}>{c.effect === "grant" ? "Granted" : "Denied"}</Badge> <span className="font-mono text-xs">{c.code}</span>
                  <span className="block text-xs text-slate-500">{c.reason}{c.expires_at && ` · until ${new Date(c.expires_at).toLocaleDateString("en-GB")}`}</span></span>
                {canGrant && <Button size="sm" variant="ghost" disabled={busy} onClick={() => start(async () => setRes(await removeUserPermission(id, c.code)))}>Remove</Button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {canGrant && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-medium text-slate-700">Grant or deny a permission for this user only</p>
          <div className="grid gap-2 md:grid-cols-6">
            <Select value={effect} onChange={(e) => setEffect(e.target.value as "grant" | "deny")} className="md:col-span-1"><option value="grant">Grant</option><option value="deny">Deny</option></Select>
            <Select value={code} onChange={(e) => setCode(e.target.value)} className="md:col-span-3">
              <option value="">Choose a permission…</option>
              {modules.map((m) => <optgroup key={m} label={m}>{perms.filter((p) => p.module === m).map((p) => <option key={p.code} value={p.code}>{p.description}</option>)}</optgroup>)}
            </Select>
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="md:col-span-2" title="Optional expiry date" aria-label="Expires on (optional)" />
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (kept in the audit log)" className="md:col-span-5" />
            <Button disabled={busy || !code || reason.trim().length < 3} onClick={() => start(async () => { const r = await setUserPermission(id, code, effect, reason, until || undefined); setRes(r); if (r.ok) { setCode(""); setReason(""); setUntil(""); } })}>Apply</Button>
          </div>
          <p className="text-xs text-slate-500">A denial overrides the user's roles. You can only grant permissions you hold yourself; administration permissions need a Super Administrator.</p>
        </div>
      )}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-700">Effective access</p>
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-52"><option value="">All modules</option>{modules.map((m) => <option key={m}>{m}</option>)}</Select>
        </div>
        <div className="max-h-[420px] overflow-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {shown.map((p) => (
                <tr key={p.code} className={p.granted ? "" : "text-slate-400"}>
                  <td className="px-3 py-1.5">{p.granted ? "✓" : "—"}</td>
                  <td className="px-3 py-1.5">{p.description}<span className="block font-mono text-[11px] text-slate-400">{p.code}</span></td>
                  <td className="px-3 py-1.5 text-xs text-slate-500">{p.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
