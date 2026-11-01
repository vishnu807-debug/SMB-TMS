"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertLeadToCustomer, reopenLead, setLeadStage } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

const FLOW = ["new", "contacted", "qualified", "quoted"];

export function LeadControls({ id, stage, hasCustomer, canEdit, canCreateCustomer }: {
  id: string; stage: string; hasCustomer: boolean; canEdit: boolean; canCreateCustomer: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [losing, setLosing] = useState(false);
  const [reason, setReason] = useState("");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => { const r = await fn(); setError(r.ok ? null : r.error ?? "Failed"); if (r.ok) router.refresh(); });

  if (!canEdit) return null;
  const closed = stage === "won" || stage === "lost";
  const nextStage = FLOW[FLOW.indexOf(stage) + 1];

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {closed ? (
          <Button variant="outline" disabled={busy} onClick={() => run(() => reopenLead(id))}>Reopen enquiry</Button>
        ) : (
          <>
            {!hasCustomer && canCreateCustomer && (
              <Button variant="outline" disabled={busy} onClick={() => run(async () => {
                const r = await convertLeadToCustomer(id);
                if (r.ok) router.push(`/customers/${r.data!.customerId}`);
                return r;
              })}>Create customer</Button>
            )}
            {nextStage && nextStage !== "quoted" && <Button variant="outline" disabled={busy} onClick={() => run(() => setLeadStage(id, nextStage))}>Mark {nextStage}</Button>}
            <Button variant="outline" disabled={busy} onClick={() => setLosing((x) => !x)}>Mark lost</Button>
          </>
        )}
      </div>
      {losing && (
        <div className="flex w-full max-w-md gap-2">
          <Input autoFocus placeholder="Why was it lost? (price, timing, competitor…)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => run(async () => { const r = await setLeadStage(id, "lost", reason); if (r.ok) setLosing(false); return r; })}>Confirm</Button>
        </div>
      )}
      {error && <Alert tone="error" className="max-w-md">{error}</Alert>}
    </div>
  );
}
