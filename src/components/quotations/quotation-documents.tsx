"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Library, Loader2, Paperclip, Trash2 } from "lucide-react";
import { addQuotationDocument, quotationDocumentUrl, removeQuotationDocument, setQuotationDocumentShared } from "@/app/(app)/quotations/actions";
import { checkDocFile, DOC_ACCEPT, uploadQuotationFile } from "@/lib/quotation-files";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/utils";

export type QDoc = {
  id: string; kind: string; file_name: string; size_bytes: number | null; include_in_share: boolean;
  product_id: string | null; quote_product_id: string | null; product_attachment_id: string | null; creator: string | null;
};
type Item = { line_no: number; label: string; product_id: string | null; quote_product_id: string | null };

const KINDS = ["supporting", "datasheet", "drawing", "certificate", "other"];

export function QuotationDocuments({ quotationId, docs, items, catalogueDocs, editable }: {
  quotationId: string; docs: QDoc[]; items: Item[]; editable: boolean;
  catalogueDocs: { id: string; product_id: string; file_name: string; kind: string }[];
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState("supporting");
  const [item, setItem] = useState("");
  // Ticks change immediately; they are put back if the server refuses.
  const [shared, setShared] = useState<Record<string, boolean>>({});
  const isShared = (d: QDoc) => shared[d.id] ?? d.include_in_share;
  const toggleShare = (d: QDoc, on: boolean) => {
    setShared((x) => ({ ...x, [d.id]: on }));
    start(async () => {
      setError(null);
      const r = await setQuotationDocumentShared(d.id, on);
      if (!r.ok) { setShared((x) => ({ ...x, [d.id]: !on })); setError(r.error ?? "Could not update."); }
      else router.refresh();
    });
  };

  const itemLabel = (d: QDoc) => {
    const it = items.find((i) => (d.quote_product_id && i.quote_product_id === d.quote_product_id) || (!d.quote_product_id && d.product_id && i.product_id === d.product_id));
    return it ? `Line ${it.line_no}: ${it.label}` : null;
  };
  const unused = catalogueDocs.filter((c) => !docs.some((d) => d.product_attachment_id === c.id));

  const upload = (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    const bad = list.map((f) => checkDocFile(f)).filter(Boolean) as string[];
    if (bad.length) return setError(bad.join(" "));
    const it = items.find((i) => String(i.line_no) === item);
    const link = it ? (it.quote_product_id ? { quote_product_id: it.quote_product_id } : { product_id: it.product_id }) : {};
    setError(null);
    start(async () => {
      const problems: string[] = [];
      for (const [n, f] of list.entries()) {
        setStatus(`Uploading ${f.name} (${n + 1} of ${list.length})…`);
        try {
          const up = await uploadQuotationFile(quotationId, f);
          const r = await addQuotationDocument({ quotation_id: quotationId, kind, ...link, ...up });
          if (!r.ok) problems.push(`${f.name}: ${r.error}`);
        } catch (e) { problems.push((e as Error).message); }
      }
      setStatus(null);
      if (problems.length) setError(problems.join(" ")); else setStatus(`${list.length} document${list.length > 1 ? "s" : ""} attached.`);
      router.refresh();
    });
  };

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => start(async () => {
    setError(null); setStatus(null);
    const r = await fn();
    if (!r.ok) return setError(r.error ?? "Something went wrong.");
    if (done) setStatus(done);
    router.refresh();
  });

  const open = (id: string) => start(async () => {
    const r = await quotationDocumentUrl(id);
    if (!r.ok) return setError(r.error);
    window.location.href = r.data!.url;
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        <span className="text-xs text-slate-500">Ticked documents go to the customer with “Download for customer”</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Alert tone="error">{error}</Alert>}
        {status && <Alert tone={busy ? "info" : "success"}>{busy && <Loader2 className="mr-1 inline size-3.5 animate-spin" />}{status}</Alert>}
        {docs.length === 0 && <p className="text-sm text-slate-500">No documents attached.</p>}
        <ul className="divide-y divide-slate-100">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
              <FileText className="size-4 shrink-0 text-slate-400" />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => open(d.id)} className="truncate text-left text-sm font-medium text-navy-800 hover:underline">{d.file_name}</button>
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                  <Badge tone={d.kind === "customer_confirmation" ? "green" : "slate"}>{humanize(d.kind)}</Badge>
                  {d.product_attachment_id && <Badge tone="blue">From catalogue</Badge>}
                  {itemLabel(d) ?? "Whole quotation"}
                  {d.size_bytes ? ` · ${d.size_bytes >= 1048576 ? `${(d.size_bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(d.size_bytes / 1024))} KB`}` : ""}
                  {d.creator && ` · ${d.creator}`}
                </p>
              </div>
              {d.kind !== "customer_confirmation" && (
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  <input type="checkbox" className="size-4" checked={isShared(d)} disabled={!editable}
                    onChange={(e) => toggleShare(d, e.target.checked)} />
                  For customer
                </label>
              )}
              <Button type="button" variant="ghost" size="icon" aria-label={`Download ${d.file_name}`} disabled={busy} onClick={() => open(d.id)}><Download /></Button>
              {editable && (
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${d.file_name}`} disabled={busy}
                  onClick={() => confirm(`Remove ${d.file_name} from this quotation?`) && run(() => removeQuotationDocument(d.id), "Document removed.")}><Trash2 /></Button>
              )}
            </li>
          ))}
        </ul>

        {editable && unused.length > 0 && (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Library className="size-3.5" /> Catalogue documents for products on this quotation</p>
            <ul className="space-y-1">
              {unused.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{c.file_name} <span className="text-xs text-slate-400">({humanize(c.kind)})</span></span>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => addQuotationDocument({ quotation_id: quotationId, product_attachment_id: c.id }), "Catalogue document attached.")}>Attach</Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {editable && (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
            <label className="text-xs text-slate-600">Type
              <Select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-1 h-8 w-44 text-xs">{KINDS.map((k) => <option key={k} value={k}>{humanize(k)}</option>)}</Select>
            </label>
            <label className="text-xs text-slate-600">For
              <Select value={item} onChange={(e) => setItem(e.target.value)} className="mt-1 h-8 w-64 text-xs">
                <option value="">The whole quotation</option>
                {items.filter((i) => i.product_id || i.quote_product_id).map((i) => <option key={i.line_no} value={i.line_no}>Line {i.line_no}: {i.label}</option>)}
              </Select>
            </label>
            <label className={`inline-flex h-8 cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium hover:bg-slate-50 ${busy ? "pointer-events-none opacity-50" : ""}`}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Paperclip className="size-4" />} Upload PDF / Word
              <input type="file" multiple accept={DOC_ACCEPT} hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
