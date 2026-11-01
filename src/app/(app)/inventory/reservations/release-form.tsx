"use client";
import { useActionState, useState } from "react";
import { releaseReservation } from "../actions";
import type { ActionResult } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";

export function ReleaseForm({ reservationId, max }: { reservationId: string; max: number }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ActionResult | undefined, FormData>(releaseReservation, undefined);
  if (state?.ok) return <span className="text-xs text-emerald-700">{state.message}</span>;
  if (!open) return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Release</Button>;
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="reservation_id" value={reservationId} />
      <Input name="qty" type="number" step="0.001" min="0.001" max={max} defaultValue={max} className="w-24 text-right" aria-label="Quantity to release" />
      <Input name="reason" placeholder="Reason" required minLength={3} className="w-56" />
      <SubmitButton size="sm" variant="destructive" pendingText="Releasing…">Release</SubmitButton>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      {state && !state.ok && <p className="w-full text-right text-xs text-red-600">{state.error}</p>}
    </form>
  );
}
