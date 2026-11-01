"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Ban, CheckCircle2, Loader2, Paperclip, Pencil, Send, Wallet, XCircle } from "lucide-react";
import { runBillAction, setBillAttachment } from "@/app/(app)/payables/actions";
import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";

export function BillActions({ id, can }: { id: string; can: { edit?: boolean; submit?: boolean; approve?: boolean; void?: boolean; pay?: boolean; attach?: boolean } }) {
  const [busy, start] = useTransition();
  const [mode, setMode] = useState<"void" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const run = (a: "submit" | "void" | "approve" | "reject", comment?: string) => start(async () => {
    const r = await runBillAction(id, a, comment);
    if (!r.ok) return setMsg({ tone: "error", text: r.error });
    setMode(null); setMsg(r.data?.message ? { tone: "success", text: r.data.message } : null);
  });
  const upload = (file: File | undefined) => file && start(async () => {
    if (file.size > 10 * 1024 * 1024) return setMsg({ tone: "error", text: "The file is larger than 10 MB." });
    const path = `bills/${id}/${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
    const { error } = await createClient().storage.from("finance-docs").upload(path, file, { contentType: file.type });
    if (error) return setMsg({ tone: "error", text: `Upload failed: ${error.message}` });
    const r = await setBillAttachment(id, path);
    setMsg(r.ok ? { tone: "success", text: "Invoice scan attached." } : { tone: "error", text: r.error });
  });
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {can.attach && <label className={buttonVariants({ variant: "outline" }) + " cursor-pointer"}><Paperclip /> Attach scan
          <input type="file" className="hidden" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => upload(e.target.files?.[0])} /></label>}
        {can.edit && <Link href={`/payables/bills/${id}/edit`} className={buttonVariants({ variant: "outline" })}><Pencil /> Edit</Link>}
        {can.void && <Button variant="outline" disabled={busy} onClick={() => setMode(mode === "void" ? null : "void")}><Ban /> Void</Button>}
        {can.approve && <Button variant="outline" disabled={busy} onClick={() => setMode(mode === "reject" ? null : "reject")}><XCircle /> Return</Button>}
        {can.approve && <Button variant="success" disabled={busy} onClick={() => confirm("Approve this bill for payment?") && run("approve")}><CheckCircle2 /> Approve</Button>}
        {can.submit && <Button disabled={busy} onClick={() => run("submit")}>{busy ? <Loader2 className="animate-spin" /> : <Send />} Submit</Button>}
        {can.pay && <Link href={`/payables/payments/new?bill=${id}`} className={buttonVariants({ variant: "success" })}><Wallet /> Pay</Link>}
      </div>
      {mode && <div className="flex w-full max-w-md gap-2">
        <Input autoFocus placeholder={mode === "void" ? "Reason for voiding" : "What needs correcting"} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => run(mode, reason)}>Confirm</Button>
      </div>}
      {msg && <Alert tone={msg.tone} className="max-w-xl">{msg.text}</Alert>}
    </div>
  );
}
