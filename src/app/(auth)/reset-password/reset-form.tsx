"use client";
import { useActionState } from "react";
import { setNewPassword } from "./actions";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";

export function ResetForm({ email }: { email: string }) {
  const [state, action] = useActionState(setNewPassword, undefined);
  return (
    <form action={action} className="space-y-4">
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      <input type="hidden" name="username" value={email} autoComplete="username" />
      <Field label="New password" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} autoFocus /></Field>
      <Field label="Confirm new password" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
      <SubmitButton className="w-full" pendingText="Saving…">Set password</SubmitButton>
    </form>
  );
}
