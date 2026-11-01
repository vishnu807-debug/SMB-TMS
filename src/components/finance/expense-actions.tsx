"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Ban, CheckCircle2, Loader2, Pencil, Send, Wallet, XCircle } from "lucide-react";
import { runExpenseAction } from "@/app/(app)/expenses/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input, Select } from "@/components/ui/input";

export function ExpenseActions({ id, can, banks }: { id: string; can: { edit?: boolean; submit?: boolean; cancel?: boolean; approve?: boolean; pay?: boolean }; banks: { id: string; name: string }[] }) {
  const [busy, start] = useTransition();
  const [mode, setMode] = useState<"reject" | "pay" | null>(null);
  const [comment, setComment] = useState("");
  const [pay, setPay] = useState({ bank_account_id: banks[0]?.id ?? "", reference: "", paid_at: "" });
  const [error, setError] = useState<string | null>(null);
  const run = (a: "submit" | "cancel" | "approve" | "reject" | "pay", extra?: any) => start(async () => {
    const r = await runExpenseAction(id, a, extra);
    setError(r.ok ? null : r.error); if (r.ok) setMode(null);
  });
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {can.edit && <Link href={`/expenses/${id}/edit`} className={buttonVariants({ variant: "outline" })}><Pencil /> Edit</Link>}
        {can.cancel && <Button variant="outline" disabled={busy} onClick={() => confirm("Cancel this claim?") && run("cancel")}><Ban /> Cancel claim</Button>}
        {can.submit && <Button disabled={busy} onClick={() => run("submit")}>{busy ? <Loader2 className="animate-spin" /> : <Send />} Submit</Button>}
        {can.approve && <Button variant="outline" disabled={busy} onClick={() => setMode(mode === "reject" ? null : "reject")}><XCircle /> Reject</Button>}
        {can.approve && <Button variant="success" disabled={busy} onClick={() => run("approve")}><CheckCircle2 /> Approve</Button>}
        {can.pay && <Button variant="success" disabled={busy} onClick={() => setMode(mode === "pay" ? null : "pay")}><Wallet /> Mark paid</Button>}
      </div>
      {mode === "reject" && <div className="flex w-full max-w-md gap-2">
        <Input autoFocus placeholder="Reason for rejecting" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />
        <Button variant="destructive" disabled={busy || !comment.trim()} onClick={() => run("reject", { comment })}>Reject</Button></div>}
      {mode === "pay" && <div className="flex w-full max-w-xl flex-wrap gap-2">
        <Select value={pay.bank_account_id} onChange={(e) => setPay({ ...pay, bank_account_id: e.target.value })} className="w-52">{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
        <Input type="date" className="w-40" value={pay.paid_at} onChange={(e) => setPay({ ...pay, paid_at: e.target.value })} />
        <Input placeholder="Reference" className="w-40" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
        <Button disabled={busy || !pay.bank_account_id} onClick={() => run("pay", pay)}>Confirm</Button></div>}
      {error && <Alert tone="error" className="max-w-xl">{error}</Alert>}
    </div>
  );
}
