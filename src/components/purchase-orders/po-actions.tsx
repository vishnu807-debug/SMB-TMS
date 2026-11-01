"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, FileDown, Loader2, PackagePlus, Pencil, Send, Undo2, XCircle, Ban, Lock } from "lucide-react";
import { runPurchaseOrderAction } from "@/app/(app)/purchase-orders/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";

export type PoAction = "edit" | "submit" | "reopen" | "approve" | "reject" | "send" | "receive" | "close" | "cancel" | "pdf";
const CONFIRM: Partial<Record<PoAction, string>> = {
  submit: "Submit this purchase order? Orders above the approval limit go to a manager; others are approved immediately.",
  reopen: "Withdraw the approval request and return the order to draft?",
  approve: "Approve this purchase order?",
  send: "Mark this purchase order as sent to the supplier?",
};
const NEEDS_REASON: PoAction[] = ["reject", "close", "cancel"];

export function PurchaseOrderActions({ id, actions }: { id: string; actions: PoAction[] }) {
  const [busy, start] = useTransition();
  const [running, setRunning] = useState<PoAction | null>(null);
  const [asking, setAsking] = useState<PoAction | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const run = (a: PoAction, comment?: string) => {
    if (CONFIRM[a] && !confirm(CONFIRM[a])) return;
    setMsg(null); setRunning(a);
    start(async () => {
      const r = await runPurchaseOrderAction(id, a, comment);
      if (!r.ok) setMsg({ tone: "error", text: r.error });
      else { setAsking(null); setReason(""); if (r.data?.message) setMsg({ tone: "success", text: r.data.message }); }
      setRunning(null);
    });
  };
  const btn = (a: PoAction, label: string, icon: React.ReactNode, variant: "default" | "outline" | "success" | "destructive" = "outline") => (
    <Button key={a} variant={variant} disabled={busy} onClick={() => (NEEDS_REASON.includes(a) ? setAsking(asking === a ? null : a) : run(a))}>
      {running === a ? <Loader2 className="animate-spin" /> : icon} {label}
    </Button>
  );

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {actions.includes("pdf") && <a href={`/purchase-orders/${id}/pdf`} className={buttonVariants({ variant: "outline" })}><FileDown /> PDF</a>}
        {actions.includes("edit") && <Link href={`/purchase-orders/${id}/edit`} className={buttonVariants({ variant: "outline" })}><Pencil /> Edit</Link>}
        {actions.includes("reopen") && btn("reopen", "Return to draft", <Undo2 />)}
        {actions.includes("cancel") && btn("cancel", "Cancel order", <Ban />)}
        {actions.includes("close") && btn("close", "Close short", <Lock />)}
        {actions.includes("reject") && btn("reject", "Reject", <XCircle />)}
        {actions.includes("approve") && btn("approve", "Approve", <CheckCircle2 />, "success")}
        {actions.includes("submit") && btn("submit", "Submit", <Send />, "default")}
        {actions.includes("send") && btn("send", "Mark as sent", <Send />, "default")}
        {actions.includes("receive") && <Link href={`/inventory/receipts/new?po=${id}`} className={buttonVariants({ variant: "success" })}><PackagePlus /> Receive goods</Link>}
      </div>
      {asking && (
        <div className="flex w-full max-w-md gap-2">
          <Input autoFocus placeholder={asking === "reject" ? "Reason for rejecting" : asking === "close" ? "Why the rest won't be delivered" : "Reason for cancelling"}
            value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => run(asking, reason)}>Confirm</Button>
        </div>
      )}
      {msg && <Alert tone={msg.tone} className="max-w-xl">{msg.text}</Alert>}
    </div>
  );
}
