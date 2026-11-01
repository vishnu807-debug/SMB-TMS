"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, CheckCircle2, FileDown, FileMinus2, Loader2, RefreshCw, Trash2, Wallet } from "lucide-react";
import { createCreditNote, runInvoiceAction } from "@/app/(app)/invoices/actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { formatQty } from "@/lib/utils";

type Line = { id: string; description: string; qty: number };

export function InvoiceActions({ id, kind, perms, creditLines }: {
  id: string; kind: "invoice" | "credit_note";
  perms: { post?: boolean; delete?: boolean; void?: boolean; credit?: boolean; pay?: boolean; retry?: boolean; pdf?: boolean };
  creditLines: Line[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"void" | "credit" | null>(null);
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const label = kind === "invoice" ? "invoice" : "credit note";

  const run = (a: "post" | "delete" | "void" | "retry_einvoice") => {
    const msg = { post: `Post this ${label}? It gets its number and can no longer be edited.`, delete: "Delete this draft?", void: "", retry_einvoice: "Send this invoice to the e-invoicing provider again?" }[a];
    if (msg && !confirm(msg)) return;
    start(async () => {
      const r = await runInvoiceAction(id, a, reason);
      if (!r.ok) return setError(r.error);
      setError(null); setMode(null);
      if (a === "delete") router.push("/invoices");
    });
  };
  const credit = () => start(async () => {
    const picked = creditLines.filter((l) => Number(qty[l.id]) > 0).map((l) => ({ invoice_line_id: l.id, qty: qty[l.id] }));
    const r = await createCreditNote(id, { reason, lines: picked.length ? picked : undefined });
    if (!r.ok) return setError(r.error);
    router.push(`/invoices/${r.data!.id}`);
  });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        {perms.pdf && <a href={`/invoices/${id}/pdf`} className={buttonVariants({ variant: "outline" })}><FileDown /> PDF</a>}
        {perms.delete && <Button variant="outline" disabled={busy} onClick={() => run("delete")}><Trash2 /> Delete draft</Button>}
        {perms.void && <Button variant="outline" disabled={busy} onClick={() => setMode(mode === "void" ? null : "void")}><Ban /> Void</Button>}
        {perms.credit && <Button variant="outline" disabled={busy} onClick={() => setMode(mode === "credit" ? null : "credit")}><FileMinus2 /> Credit note</Button>}
        {perms.retry && <Button variant="outline" disabled={busy} onClick={() => run("retry_einvoice")}><RefreshCw /> Resend e-invoice</Button>}
        {perms.pay && <Link href={`/payments/new?invoice=${id}`} className={buttonVariants({ variant: "success" })}><Wallet /> Record payment</Link>}
        {perms.post && <Button disabled={busy} onClick={() => run("post")}>{busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Post {label}</Button>}
      </div>
      {mode === "void" && (
        <div className="flex w-full max-w-md gap-2">
          <Input autoFocus placeholder="Reason for voiding" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => run("void")}>Void</Button>
        </div>
      )}
      {mode === "credit" && (
        <div className="w-full max-w-xl space-y-3 rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm">
          <p className="text-sm text-slate-600">Enter quantities to credit, or leave them all empty to credit the whole invoice.</p>
          {creditLines.map((l) => (
            <div key={l.id} className="flex items-center gap-3 text-sm">
              <span className="flex-1 truncate">{l.description}</span>
              <span className="text-xs text-slate-500">of {formatQty(l.qty)}</span>
              <Input type="number" min="0" max={l.qty} step="0.001" className="w-28 text-right" value={qty[l.id] ?? ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
            </div>
          ))}
          <Input placeholder="Reason (printed on the credit note)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          <div className="flex justify-end"><Button disabled={busy || reason.trim().length < 3} onClick={credit}>Create draft credit note</Button></div>
        </div>
      )}
      {error && <Alert tone="error" className="max-w-xl">{error}</Alert>}
    </div>
  );
}
