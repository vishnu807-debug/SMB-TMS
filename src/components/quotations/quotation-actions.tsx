"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Copy, Download, Loader2, Pencil, Send, ShoppingCart, XCircle } from "lucide-react";
import { quotationAction } from "@/app/(app)/quotations/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

type A = "edit" | "submit" | "approve" | "reject" | "sent" | "accepted" | "lost" | "reopen" | "revise" | "convert" | "pdf";

export function QuotationActions({ id, actions }: { id: string; actions: A[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [panel, setPanel] = useState<null | "reject" | "lost" | "convert">(null);
  const [reason, setReason] = useState("");
  const [poRef, setPoRef] = useState("");
  const [reqDate, setReqDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = (a: Exclude<A, "edit" | "pdf">, extra = {}) => start(async () => {
    setError(null); setNotice(null);
    const r = await quotationAction(id, a, extra);
    if (!r.ok) return setError(r.error);
    if (r.data?.redirect) return router.push(r.data.redirect);
    if (a === "submit") setNotice(r.data?.status === "approved" ? "Approved automatically — within your limits." : "Sent for approval.");
    setPanel(null); router.refresh();
  });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {actions.includes("pdf") && <a href={`/quotations/${id}/pdf`} className={buttonVariants({ variant: "outline" })}><Download /> PDF</a>}
        {actions.includes("edit") && <Link href={`/quotations/${id}/edit`} className={buttonVariants({ variant: "outline" })}><Pencil /> Edit</Link>}
        {actions.includes("revise") && <Button variant="outline" disabled={busy} onClick={() => confirm("Create a new revision? This one will be marked superseded.") && run("revise")}><Copy /> Revise</Button>}
        {actions.includes("reopen") && <Button variant="outline" disabled={busy} onClick={() => run("reopen")}>Back to draft</Button>}
        {actions.includes("lost") && <Button variant="outline" disabled={busy} onClick={() => setPanel(panel === "lost" ? null : "lost")}>Mark lost</Button>}
        {actions.includes("reject") && <Button variant="outline" disabled={busy} onClick={() => setPanel(panel === "reject" ? null : "reject")}><XCircle /> Reject</Button>}
        {actions.includes("approve") && <Button variant="success" disabled={busy} onClick={() => run("approve")}><CheckCircle2 /> Approve</Button>}
        {actions.includes("submit") && <Button disabled={busy} onClick={() => run("submit")}>{busy ? <Loader2 className="animate-spin" /> : <Send />} Submit</Button>}
        {actions.includes("sent") && <Button variant="outline" disabled={busy} onClick={() => run("sent")}><Send /> Mark sent</Button>}
        {actions.includes("accepted") && <Button variant="outline" disabled={busy} onClick={() => run("accepted")}><CheckCircle2 /> Customer accepted</Button>}
        {actions.includes("convert") && <Button variant="success" disabled={busy} onClick={() => setPanel(panel === "convert" ? null : "convert")}><ShoppingCart /> Convert to sales order</Button>}
      </div>
      {(panel === "reject" || panel === "lost") && (
        <div className="flex w-full max-w-lg gap-2">
          <Input autoFocus placeholder={panel === "lost" ? "Why was it lost? (price, delivery time, competitor…)" : "Reason for rejecting"} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => run(panel, { reason })}>Confirm</Button>
        </div>
      )}
      {panel === "convert" && (
        <div className="flex w-full max-w-xl flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <label className="flex-1 text-sm">Customer PO number<Input value={poRef} onChange={(e) => setPoRef(e.target.value)} className="mt-1" /></label>
          <label className="text-sm">Required by<Input type="date" value={reqDate} onChange={(e) => setReqDate(e.target.value)} className="mt-1" /></label>
          <Button variant="success" disabled={busy} onClick={() => run("convert", { poRef, requiredDate: reqDate })}>{busy && <Loader2 className="animate-spin" />} Create order</Button>
        </div>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}
      {error && <Alert tone="error" className="max-w-xl">{error}</Alert>}
    </div>
  );
}
