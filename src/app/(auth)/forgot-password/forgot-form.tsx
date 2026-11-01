"use client";
import { useActionState } from "react";
import { requestReset } from "./actions";
import { Field, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";

export function ForgotForm() {
  const [state, action] = useActionState(requestReset, undefined);
  if (state?.done) return <Alert tone="success">If that email belongs to an SMP account, a reset link is on its way. The link expires in one hour.</Alert>;
  return (
    <form action={action} className="space-y-4">
      {state?.error && <Alert tone="error">{state.error}</Alert>}
      <Field label="Work email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="username" required autoFocus /></Field>
      <SubmitButton className="w-full" pendingText="Sending…">Send reset link</SubmitButton>
    </form>
  );
}
