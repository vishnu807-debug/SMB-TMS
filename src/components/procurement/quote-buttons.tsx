"use client";
import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { cancelRequisitionLine, selectSupplierQuotation } from "@/app/(app)/procurement/actions";
import { Button } from "@/components/ui/button";

export function SelectQuoteButton({ id, size = "sm" }: { id: string; size?: "sm" | "default" }) {
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button size={size} variant="success" disabled={busy} onClick={() => {
        if (!confirm("Select this quotation? Other quotations for the same requisition are marked rejected and the supplier's prices are saved.")) return;
        start(async () => { const r = await selectSupplierQuotation(id); setErr(r.ok ? null : r.error); });
      }}>{busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Select</Button>
      {err && <span className="mt-1 text-xs text-red-600">{err}</span>}
    </span>
  );
}

export function CancelLineButton({ id }: { id: string }) {
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
        const reason = prompt("Why is this item no longer needed?");
        if (!reason?.trim()) return;
        start(async () => { const r = await cancelRequisitionLine(id, reason); setErr(r.ok ? null : r.error); });
      }}><XCircle /> Cancel line</Button>
      {err && <span className="mt-1 max-w-[220px] text-right text-xs text-red-600">{err}</span>}
    </span>
  );
}
