"use client";
import { useActionState, useTransition, useState } from "react";
import { changeMyPassword, signOutEverywhere, signOutOtherDevices, updateMyProfile } from "./actions";
import type { ActionResult } from "@/lib/errors";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { PASSWORD_HINT } from "@/lib/validation/password";

export function ProfileForm({ fullName, phone }: { fullName: string; phone: string | null }) {
  const [state, action] = useActionState<ActionResult | undefined, FormData>(updateMyProfile, undefined);
  return (
    <form action={action} className="space-y-4">
      {state && <Alert tone={state.ok ? "success" : "error"}>{state.ok ? state.message : state.error}</Alert>}
      <Field label="Full name" htmlFor="full_name"><Input id="full_name" name="full_name" defaultValue={fullName} required /></Field>
      <Field label="Phone" htmlFor="phone"><Input id="phone" name="phone" defaultValue={phone ?? ""} /></Field>
      <div className="flex justify-end"><SubmitButton>Save</SubmitButton></div>
    </form>
  );
}

export function PasswordForm({ email }: { email: string }) {
  const [state, action] = useActionState<ActionResult | undefined, FormData>(changeMyPassword, undefined);
  return (
    <form action={action} className="space-y-4">
      {state && <Alert tone={state.ok ? "success" : "error"}>{state.ok ? state.message : state.error}</Alert>}
      <input type="hidden" name="username" value={email} autoComplete="username" />
      <Field label="Current password" htmlFor="current"><Input id="current" name="current" type="password" autoComplete="current-password" required /></Field>
      <Field label="New password" htmlFor="password" hint={PASSWORD_HINT}><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} /></Field>
      <Field label="Confirm new password" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
      <div className="flex justify-end"><SubmitButton>Change password</SubmitButton></div>
    </form>
  );
}

export function SessionButtons() {
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<ActionResult | null>(null);
  return (
    <div className="space-y-3">
      {msg && <Alert tone={msg.ok ? "success" : "error"}>{msg.ok ? msg.message : msg.error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => start(async () => setMsg(await signOutOtherDevices()))}>Sign out other devices</Button>
        <Button variant="destructive" disabled={busy} onClick={() => confirm("Sign out of every device, including this one?") && start(() => signOutEverywhere())}>Sign out everywhere</Button>
      </div>
    </div>
  );
}
