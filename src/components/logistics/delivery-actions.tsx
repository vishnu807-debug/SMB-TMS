"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Ban, CheckCircle2, FileDown, Loader2, Pencil, Truck, Upload } from "lucide-react";
import { confirmDelivery, runDeliveryAction } from "@/app/(app)/logistics/actions";
import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Textarea } from "@/components/ui/input";

export function DeliveryActions({ id, canEdit, canDispatch, canConfirm }: { id: string; canEdit: boolean; canDispatch: boolean; canConfirm: boolean }) {
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"cancel" | "pod" | null>(null);
  const [reason, setReason] = useState("");
  const [pod, setPod] = useState({ received_by_name: "", delivered_at: "", pod_notes: "" });
  const [file, setFile] = useState<File | null>(null);

  const dispatch = () => {
    if (!confirm("Dispatch this delivery? Stock is issued from the warehouse now and the note can no longer be changed.")) return;
    start(async () => { const r = await runDeliveryAction(id, "dispatch"); setError(r.ok ? null : r.error); });
  };
  const cancel = () => start(async () => { const r = await runDeliveryAction(id, "cancel", reason); if (r.ok) setMode(null); setError(r.ok ? null : r.error); });
  const savePod = () => start(async () => {
    setError(null);
    let pod_path: string | undefined;
    if (file) {
      if (file.size > 10 * 1024 * 1024) return setError("The file is larger than 10 MB.");
      const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      pod_path = `delivery-notes/${id}/pod-${Date.now()}.${ext}`;
      const { error: upErr } = await createClient().storage.from("delivery-pod").upload(pod_path, file, { contentType: file.type, upsert: false });
      if (upErr) return setError(`Upload failed: ${upErr.message}`);
    }
    const r = await confirmDelivery(id, { ...pod, pod_path });
    if (!r.ok) return setError(r.error);
    setMode(null);
  });

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <a href={`/logistics/deliveries/${id}/pdf`} className={buttonVariants({ variant: "outline" })}><FileDown /> Delivery note PDF</a>
        {canEdit && <Link href={`/logistics/deliveries/${id}/edit`} className={buttonVariants({ variant: "outline" })}><Pencil /> Edit</Link>}
        {canEdit && <Button variant="outline" disabled={busy} onClick={() => setMode(mode === "cancel" ? null : "cancel")}><Ban /> Cancel</Button>}
        {canDispatch && <Button variant="success" disabled={busy} onClick={dispatch}>{busy ? <Loader2 className="animate-spin" /> : <Truck />} Dispatch</Button>}
        {canConfirm && <Button disabled={busy} onClick={() => setMode(mode === "pod" ? null : "pod")}><CheckCircle2 /> Confirm delivery</Button>}
      </div>
      {mode === "cancel" && (
        <div className="flex w-full max-w-md gap-2">
          <Input autoFocus placeholder="Reason for cancelling" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={cancel}>Confirm</Button>
        </div>
      )}
      {mode === "pod" && (
        <div className="grid w-full max-w-xl gap-3 rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm sm:grid-cols-2">
          <Field label="Received by" required><Input autoFocus value={pod.received_by_name} onChange={(e) => setPod({ ...pod, received_by_name: e.target.value })} maxLength={120} placeholder="Name and role" /></Field>
          <Field label="Delivered at" hint="Blank = now"><Input type="datetime-local" value={pod.delivered_at} onChange={(e) => setPod({ ...pod, delivered_at: e.target.value })} /></Field>
          <Field label="Signed note / photo" className="sm:col-span-2" hint="JPG, PNG or PDF up to 10 MB">
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 text-sm text-slate-600 hover:bg-slate-50">
              <Upload className="size-4" /> {file ? file.name : "Choose file…"}
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          </Field>
          <Field label="Remarks" className="sm:col-span-2"><Textarea rows={2} value={pod.pod_notes} onChange={(e) => setPod({ ...pod, pod_notes: e.target.value })} maxLength={1000} placeholder="Short delivery, damage, site stamp…" /></Field>
          <div className="flex justify-end sm:col-span-2"><Button onClick={savePod} disabled={busy || !pod.received_by_name.trim()}>{busy && <Loader2 className="animate-spin" />} Save proof of delivery</Button></div>
        </div>
      )}
      {error && <Alert tone="error" className="max-w-xl">{error}</Alert>}
    </div>
  );
}
