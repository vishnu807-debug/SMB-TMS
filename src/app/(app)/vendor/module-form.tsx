"use client";
import { useActionState, useMemo, useState } from "react";
import { saveLicensedModules } from "./actions";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { Badge } from "@/components/ui/badge";

export type ModuleRow = { code: string; name: string; description: string; is_core: boolean; is_enabled: boolean; requires: string[] };

export function ModuleForm({ modules }: { modules: ModuleRow[] }) {
  const [state, action] = useActionState(saveLicensedModules, undefined);
  const initial = useMemo(() => new Set(modules.filter((m) => m.is_enabled || m.is_core).map((m) => m.code)), [modules]);
  const [on, setOn] = useState<Set<string>>(initial);
  const name = (c: string) => modules.find((m) => m.code === c)?.name ?? c;

  // Switching a module on also switches on what it needs; switching it off also
  // switches off the modules that depend on it.
  function toggle(code: string, value: boolean) {
    const next = new Set(on);
    const add = (c: string) => { if (next.has(c)) return; next.add(c); modules.find((m) => m.code === c)?.requires.forEach(add); };
    const remove = (c: string) => { if (!next.has(c)) return; next.delete(c); modules.filter((m) => m.requires.includes(c)).forEach((m) => remove(m.code)); };
    if (value) add(code); else remove(code);
    setOn(next);
  }

  const turningOn = modules.filter((m) => on.has(m.code) && !initial.has(m.code));
  const turningOff = modules.filter((m) => !on.has(m.code) && initial.has(m.code));
  const changed = turningOn.length + turningOff.length > 0;

  return (
    <form action={action} className="space-y-5">
      {state && <Alert tone={state.ok ? "success" : "error"}>{state.ok ? state.message : state.error}</Alert>}
      <div className="grid gap-3 md:grid-cols-2">
        {modules.map((m) => {
          const checked = on.has(m.code);
          return (
            <label key={m.code}
              className={`flex cursor-pointer gap-3 rounded-lg border p-4 transition ${checked ? "border-navy-600 bg-navy-50/50" : "border-slate-200 bg-white"} ${m.is_core ? "cursor-default opacity-90" : "hover:border-navy-400"}`}>
              <input type="checkbox" name="modules" value={m.code} checked={checked} disabled={m.is_core}
                onChange={(e) => toggle(m.code, e.target.checked)} className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{m.name}</span>
                  {m.is_core ? <Badge tone="slate">Always on</Badge> : checked ? <Badge tone="green">Licensed</Badge> : <Badge tone="slate">Not licensed</Badge>}
                </span>
                <span className="mt-1 block text-sm text-slate-600">{m.description}</span>
                {m.requires.length > 0 && <span className="mt-1 block text-xs text-slate-500">Needs {m.requires.map(name).join(", ")}</span>}
              </span>
            </label>
          );
        })}
      </div>

      <div className="grid items-end gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            {!changed ? "No changes yet. Tick the modules the client has bought." : <>
              {turningOn.length > 0 && <>Switch <strong>on</strong>: {turningOn.map((m) => m.name).join(", ")}. </>}
              {turningOff.length > 0 && <>Switch <strong>off</strong>: {turningOff.map((m) => m.name).join(", ")}. Their data is kept and comes back when switched on again.</>}
            </>}
          </p>
          <Field label="Licence / order reference" hint="Recorded in the change history, e.g. the client's licence or purchase order number">
            <Input name="reference" required minLength={3} maxLength={120} placeholder="e.g. LIC-2026-014 / client PO 4471" />
          </Field>
        </div>
        <SubmitButton disabled={!changed} pendingText="Saving…">Save licensed modules</SubmitButton>
      </div>
    </form>
  );
}
