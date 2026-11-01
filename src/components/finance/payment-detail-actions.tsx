"use client";
import { useState, useTransition } from "react";
import { Ban, Loader2 } from "lucide-react";
import { allocatePayment, voidPayment } from "@/app/(app)/payments/actions";
import { voidSupplierPayment } from "@/app/(app)/payables/actions";
import { AllocationTable, type OpenItem } from "./allocation-table";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";

export function VoidPaymentButton({ id, kind = "customer" }: { id: string; kind?: "customer" | "supplier" }) {
  const onVoid = kind === "customer" ? voidPayment : voidSupplierPayment;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="outline" onClick={() => setOpen(!open)}><Ban /> Void</Button>
      {open && <div className="flex w-full max-w-md gap-2">
        <Input autoFocus placeholder="Reason (e.g. cheque returned)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => start(async () => { const r = await onVoid(id, reason); setError(r.ok ? null : r.error); if (r.ok) setOpen(false); })}>Void</Button>
      </div>}
      {error && <Alert tone="error" className="max-w-md">{error}</Alert>}
    </div>
  );
}

export function AllocateRemaining({ id, items, currency, available }: { id: string; items: OpenItem[]; currency: string; available: number }) {
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="mt-6">
      <CardHeader><CardTitle>Allocate the remaining amount</CardTitle>
        <Button size="sm" disabled={busy} onClick={() => start(async () => {
          const r = await allocatePayment(id, Object.entries(alloc).map(([invoice_id, amount]) => ({ invoice_id, amount: amount || 0 })));
          setError(r.ok ? null : r.error); if (r.ok) setAlloc({});
        })}>{busy && <Loader2 className="animate-spin" />} Save allocation</Button></CardHeader>
      {error && <Alert tone="error" className="m-4">{error}</Alert>}
      <AllocationTable items={items} currency={currency} amounts={alloc} onChange={setAlloc} available={available} link={(i) => `/invoices/${i}`} />
    </Card>
  );
}
