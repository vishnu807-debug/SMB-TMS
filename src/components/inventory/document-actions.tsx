"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Pencil, Send, Truck, XCircle } from "lucide-react";
import { runDocumentAction } from "@/app/(app)/inventory/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";

export type DocAction = "edit" | "post" | "submit" | "dispatch" | "receive" | "approve" | "reject" | "cancel";

const META: Record<Exclude<DocAction, "edit">, { label: string; confirm: string; variant: "default" | "success" | "outline" | "destructive" }> = {
  post: { label: "Post", confirm: "Post this document? Stock balances will change and the document can no longer be edited.", variant: "success" },
  submit: { label: "Submit for approval", confirm: "Submit this adjustment for approval?", variant: "default" },
  dispatch: { label: "Dispatch", confirm: "Dispatch this transfer? Stock leaves the source warehouse now.", variant: "success" },
  receive: { label: "Receive", confirm: "Confirm the goods have arrived at the destination warehouse?", variant: "success" },
  approve: { label: "Approve & post", confirm: "Approve this adjustment? It will be posted to stock immediately.", variant: "success" },
  reject: { label: "Reject", confirm: "", variant: "outline" },
  cancel: { label: "Cancel document", confirm: "Cancel this document? This cannot be undone.", variant: "outline" },
};

const ICON: Partial<Record<DocAction, React.ReactNode>> = {
  post: <CheckCircle2 />, submit: <Send />, dispatch: <Truck />, receive: <CheckCircle2 />, approve: <CheckCircle2 />, reject: <XCircle />,
};

export function DocumentActions({ kind, id, actions }: { kind: string; id: string; actions: DocAction[] }) {
  const [busy, start] = useTransition();
  const [running, setRunning] = useState<DocAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const run = (action: DocAction, comment?: string) => {
    if (action !== "reject" && !confirm(META[action as Exclude<DocAction, "edit">].confirm)) return;
    setError(null);
    setRunning(action);
    start(async () => {
      const res = await runDocumentAction(kind, id, action, comment);
      if (!res.ok) setError(res.error);
      else setRejecting(false);
      setRunning(null);
    });
  };

  if (actions.length === 0) return null;
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {actions.map((a) =>
          a === "edit" ? (
            <Link key={a} href={`/inventory/${kind}/${id}/edit`} className={buttonVariants({ variant: "outline" })}><Pencil /> Edit</Link>
          ) : a === "reject" ? (
            <Button key={a} variant="outline" disabled={busy} onClick={() => setRejecting((r) => !r)}><XCircle /> Reject</Button>
          ) : (
            <Button key={a} variant={META[a].variant} disabled={busy} onClick={() => run(a)}>
              {running === a ? <Loader2 className="animate-spin" /> : ICON[a]} {META[a].label}
            </Button>
          ),
        )}
      </div>
      {rejecting && (
        <div className="flex w-full max-w-md gap-2">
          <Input autoFocus placeholder="Reason for rejecting" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => run("reject", reason)}>Reject</Button>
        </div>
      )}
      {error && <Alert tone="error" className="max-w-xl">{error}</Alert>}
    </div>
  );
}
