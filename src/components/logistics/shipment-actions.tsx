"use client";
import { useState, useTransition } from "react";
import { Ban, Loader2, Truck } from "lucide-react";
import { runShipmentAction } from "@/app/(app)/logistics/actions";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export function ShipmentActions({ id, canDispatch }: { id: string; canDispatch: boolean }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const go = (a: "dispatch" | "cancel") => {
    if (!confirm(a === "dispatch" ? "Dispatch this shipment? All its draft delivery notes are dispatched and stock is issued." : "Cancel this shipment? Its delivery notes stay as drafts.")) return;
    start(async () => { const r = await runShipmentAction(id, a); setError(r.ok ? null : r.error); });
  };
  if (!canDispatch) return null;
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button variant="outline" disabled={busy} onClick={() => go("cancel")}><Ban /> Cancel</Button>
        <Button variant="success" disabled={busy} onClick={() => go("dispatch")}>{busy ? <Loader2 className="animate-spin" /> : <Truck />} Dispatch shipment</Button>
      </div>
      {error && <Alert tone="error" className="max-w-xl">{error}</Alert>}
    </div>
  );
}
