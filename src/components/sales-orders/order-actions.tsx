"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Pause, Play, XCircle } from "lucide-react";
import { orderAction } from "@/app/(app)/sales-orders/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

type A = "confirm" | "approve" | "reject" | "hold" | "release" | "cancel";

export function OrderActions({ id, actions }: { id: string; actions: A[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [panel, setPanel] = useState<null | "reject" | "hold" | "cancel">(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = (a: A, r?: string) => start(async () => {
    setError(null); setNotice(null);
    const res = await orderAction(id, a, r);
    if (!res.ok) return setError(res.error);
    if (a === "confirm") setNotice(res.data?.status === "pending_approval" ? "Sent for credit approval." : "Order confirmed: stock reserved and requisitions raised for items to procure.");
    setPanel(null); setReason(""); router.refresh();
  });
  if (!actions.length) return null;
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {actions.includes("cancel") && <Button variant="outline" disabled={busy} onClick={() => setPanel(panel === "cancel" ? null : "cancel")}><XCircle /> Cancel order</Button>}
        {actions.includes("hold") && <Button variant="outline" disabled={busy} onClick={() => setPanel(panel === "hold" ? null : "hold")}><Pause /> Put on hold</Button>}
        {actions.includes("release") && <Button variant="outline" disabled={busy} onClick={() => run("release")}><Play /> Release hold</Button>}
        {actions.includes("reject") && <Button variant="outline" disabled={busy} onClick={() => setPanel(panel === "reject" ? null : "reject")}><XCircle /> Reject</Button>}
        {actions.includes("approve") && <Button variant="success" disabled={busy} onClick={() => run("approve")}><CheckCircle2 /> Approve & confirm</Button>}
        {actions.includes("confirm") && (
          <Button variant="success" disabled={busy} onClick={() => confirm("Confirm this order? Stock will be reserved and purchase requisitions raised for items to procure.") && run("confirm")}>
            {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Confirm order
          </Button>
        )}
      </div>
      {panel && (
        <div className="flex w-full max-w-lg gap-2">
          <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder={panel === "cancel" ? "Reason for cancelling" : panel === "hold" ? "Reason for the hold" : "Reason for rejecting"} />
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => run(panel, reason)}>Confirm</Button>
        </div>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error" className="max-w-xl">{error}</Alert>}
    </div>
  );
}
