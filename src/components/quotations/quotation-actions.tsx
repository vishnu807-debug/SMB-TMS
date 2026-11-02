"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Copy, Download, FolderArchive, Loader2, Paperclip, Pencil, Send, ShoppingCart, XCircle } from "lucide-react";
import { addQuotationDocument, quotationAction, recordCustomerConfirmation } from "@/app/(app)/quotations/actions";
import { checkDocFile, uploadQuotationFile } from "@/lib/quotation-files";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

type A = "edit" | "submit" | "approve" | "reject" | "sent" | "accepted" | "lost" | "reopen" | "revise" | "convert" | "pdf" | "package";

export function QuotationActions({ id, actions, quotationDate, hasNewProducts }: { id: string; actions: A[]; quotationDate?: string; hasNewProducts?: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [panel, setPanel] = useState<null | "reject" | "lost" | "convert" | "confirm">(null);
  const today = new Date().toISOString().slice(0, 10);
  const [conf, setConf] = useState({ date: today, method: "", reference: "", note: "" });
  const [confFile, setConfFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [poRef, setPoRef] = useState("");
  const [reqDate, setReqDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = (a: Exclude<A, "edit" | "pdf" | "package">, extra = {}) => start(async () => {
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
        {actions.includes("package") && <a href={`/quotations/${id}/package`} className={buttonVariants({ variant: "outline" })} title="ZIP with the quotation PDF and every document ticked for the customer"><FolderArchive /> Download for customer</a>}
        {actions.includes("edit") && <Link href={`/quotations/${id}/edit`} className={buttonVariants({ variant: "outline" })}><Pencil /> Edit</Link>}
        {actions.includes("revise") && <Button variant="outline" disabled={busy} onClick={() => confirm("Create a new revision? This one will be marked superseded.") && run("revise")}><Copy /> Revise</Button>}
        {actions.includes("reopen") && <Button variant="outline" disabled={busy} onClick={() => run("reopen")}>Back to draft</Button>}
        {actions.includes("lost") && <Button variant="outline" disabled={busy} onClick={() => setPanel(panel === "lost" ? null : "lost")}>Mark lost</Button>}
        {actions.includes("reject") && <Button variant="outline" disabled={busy} onClick={() => setPanel(panel === "reject" ? null : "reject")}><XCircle /> Reject</Button>}
        {actions.includes("approve") && <Button variant="success" disabled={busy} onClick={() => run("approve")}><CheckCircle2 /> Approve</Button>}
        {actions.includes("submit") && <Button disabled={busy} onClick={() => run("submit")}>{busy ? <Loader2 className="animate-spin" /> : <Send />} Submit</Button>}
        {actions.includes("sent") && <Button variant="outline" disabled={busy} onClick={() => run("sent")}><Send /> Mark sent</Button>}
        {actions.includes("accepted") && <Button variant="outline" disabled={busy} onClick={() => setPanel(panel === "confirm" ? null : "confirm")}><CheckCircle2 /> Customer confirmed</Button>}
        {actions.includes("convert") && <Button variant="success" disabled={busy} onClick={() => setPanel(panel === "convert" ? null : "convert")}><ShoppingCart /> Convert to sales order</Button>}
      </div>
      {(panel === "reject" || panel === "lost") && (
        <div className="flex w-full max-w-lg gap-2">
          <Input autoFocus placeholder={panel === "lost" ? "Why was it lost? (price, delivery time, competitor…)" : "Reason for rejecting"} value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={() => run(panel, { reason })}>Confirm</Button>
        </div>
      )}
      {panel === "confirm" && (
        <div className="grid w-full max-w-xl gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-2">
          <p className="sm:col-span-2 font-medium text-slate-900">Record the customer&apos;s confirmation</p>
          <label>Confirmed on<Input type="date" min={quotationDate} max={today} value={conf.date} onChange={(e) => setConf({ ...conf, date: e.target.value })} className="mt-1" /></label>
          <label>How
            <Select value={conf.method} onChange={(e) => setConf({ ...conf, method: e.target.value })} className="mt-1">
              <option value="">Select…</option><option value="purchase_order">Purchase order</option><option value="signed_quotation">Signed quotation</option>
              <option value="email">Email</option><option value="phone">Phone</option><option value="other">Other</option>
            </Select>
          </label>
          <label className="sm:col-span-2">{conf.method === "purchase_order" ? "Customer PO number *" : "Reference (optional)"}<Input value={conf.reference} maxLength={120} onChange={(e) => setConf({ ...conf, reference: e.target.value })} className="mt-1" /></label>
          <label className="sm:col-span-2">Note (optional)<Textarea rows={2} maxLength={2000} value={conf.note} onChange={(e) => setConf({ ...conf, note: e.target.value })} className="mt-1" /></label>
          <label className="sm:col-span-2 inline-flex cursor-pointer items-center gap-2 text-navy-700">
            <Paperclip className="size-4" /> {confFile ? confFile.name : "Attach the PO / signed copy (optional, PDF, Word, JPG or PNG)"}
            <input type="file" hidden accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => {
              const f = e.target.files?.[0] ?? null; const bad = f && checkDocFile(f, true);
              if (bad) { setError(bad); setConfFile(null); } else { setError(null); setConfFile(f); }
            }} />
          </label>
          {hasNewProducts && <p className="sm:col-span-2 text-xs text-amber-800">After confirmation, the new products on this quotation are sent for approval into the product catalogue.</p>}
          <div className="sm:col-span-2 flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setPanel(null)}>Cancel</Button>
            <Button variant="success" disabled={busy || !conf.method || (conf.method === "purchase_order" && !conf.reference.trim())} onClick={() => start(async () => {
              setError(null); setNotice(null);
              const r = await recordCustomerConfirmation(id, conf);
              if (!r.ok) return setError(r.error);
              if (confFile) {
                try {
                  const up = await uploadQuotationFile(id, confFile);
                  const d = await addQuotationDocument({ quotation_id: id, kind: "customer_confirmation", ...up });
                  if (!d.ok) setError(`Confirmation recorded, but the file was not attached: ${d.error}`);
                } catch (e) { setError(`Confirmation recorded, but the file was not attached: ${(e as Error).message}`); }
              }
              setNotice("Customer confirmation recorded."); setPanel(null); router.refresh();
            })}>{busy && <Loader2 className="animate-spin" />} Record confirmation</Button>
          </div>
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
