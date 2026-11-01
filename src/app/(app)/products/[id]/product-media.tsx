"use client";
import { useRef, useState, useTransition } from "react";
import { FileText, ImagePlus, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { deleteProductAttachment, recordProductFile, removeProductImage } from "../actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { humanize } from "@/lib/utils";

const MAX = 25 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

function safeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(-80);
}

async function upload(productId: string, file: File) {
  const path = `products/${productId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const { error } = await createClient().storage.from("product-media").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message.includes("row-level security") ? "You do not have permission to upload files." : error.message);
  return path;
}

export function ProductImage({ productId, imageUrl, canEdit, name }: { productId: string; imageUrl: string | null; canEdit: boolean; name: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onFile = (file?: File) => {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return setError("Use a JPG, PNG or WebP image.");
    if (file.size > 5 * 1024 * 1024) return setError("Images must be 5 MB or smaller.");
    setError(null);
    start(async () => {
      try {
        const path = await upload(productId, file);
        const res = await recordProductFile({ productId, path, fileName: file.name, mimeType: file.type, size: file.size, kind: "image", asImage: true });
        if (!res.ok) setError(res.error);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <div>
      <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {imageUrl ? <img src={imageUrl} alt={name} className="h-full w-full object-contain" /> : <ImagePlus className="size-10 text-slate-300" />}
      </div>
      {error && <Alert tone="error" className="mt-2">{error}</Alert>}
      {canEdit && (
        <div className="mt-2 flex gap-2">
          <input ref={input} type="file" accept={IMAGE_TYPES.join(",")} hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="animate-spin" /> : <Upload />} {imageUrl ? "Replace" : "Upload image"}
          </Button>
          {imageUrl && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => start(async () => { await removeProductImage(productId); })}>
              Remove
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

type Att = { id: string; file_name: string; kind: string; size_bytes: number | null; url: string | null };

export function ProductAttachments({ productId, attachments, canEdit }: { productId: string; attachments: Att[]; canEdit: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("datasheet");
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onFile = (file?: File) => {
    if (!file) return;
    if (file.size > MAX) return setError("Files must be 25 MB or smaller.");
    setError(null);
    start(async () => {
      try {
        const path = await upload(productId, file);
        const res = await recordProductFile({ productId, path, fileName: file.name, mimeType: file.type || "application/octet-stream", size: file.size, kind, asImage: false });
        if (!res.ok) setError(res.error);
      } catch (e) {
        setError((e as Error).message);
      }
      if (input.current) input.current.value = "";
    });
  };

  return (
    <div className="space-y-3">
      {error && <Alert tone="error">{error}</Alert>}
      {attachments.length === 0 && <p className="text-sm text-slate-500">No attachments yet.</p>}
      <ul className="divide-y divide-slate-100">
        {attachments.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-2">
            <FileText className="size-4 text-slate-400" />
            <div className="min-w-0 flex-1">
              {a.url ? (
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-medium text-navy-800 hover:underline">{a.file_name}</a>
              ) : <span className="text-sm">{a.file_name}</span>}
              <p className="text-xs text-slate-500">
                {humanize(a.kind)}{a.size_bytes ? ` · ${(a.size_bytes / 1024 / 1024).toFixed(2)} MB` : ""}
              </p>
            </div>
            {canEdit && (
              <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${a.file_name}`} disabled={busy}
                onClick={() => { if (confirm(`Delete ${a.file_name}?`)) start(async () => { const r = await deleteProductAttachment(a.id); if (!r.ok) setError(r.error); }); }}>
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-40">
            {["datasheet", "certificate", "manual", "drawing", "image", "other"].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
          </Select>
          <input ref={input} type="file" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="animate-spin" /> : <Paperclip />} Attach file
          </Button>
        </div>
      )}
    </div>
  );
}
