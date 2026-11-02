"use client";
import { createClient } from "@/lib/supabase/client";

export const DOC_MAX_BYTES = 25 * 1024 * 1024;
export const DOC_ACCEPT = ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const BY_EXT: Record<string, string> = {
  pdf: "application/pdf", doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
};

/** Browsers sometimes report Word files without a type; fall back to the extension. */
export function docMime(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return Object.values(BY_EXT).includes(file.type) ? file.type : BY_EXT[ext] ?? file.type;
}

/** Returns an error message, or null when the file can be attached. */
export function checkDocFile(file: File, allowImages = false): string | null {
  const mime = docMime(file);
  const ok = ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(mime)
    || (allowImages && ["image/jpeg", "image/png"].includes(mime));
  if (!ok) return `${file.name}: only PDF, DOC and DOCX files can be attached${allowImages ? " (or a JPG/PNG scan)" : ""}.`;
  if (file.size > DOC_MAX_BYTES) return `${file.name}: files must be 25 MB or smaller.`;
  if (file.size === 0) return `${file.name}: the file is empty.`;
  return null;
}

const safeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(-80);

/** Uploads to the private quotation-docs bucket; storage policies check the quotation. */
export async function uploadQuotationFile(quotationId: string, file: File) {
  const path = `quotations/${quotationId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const mime = docMime(file);
  const { error } = await createClient().storage.from("quotation-docs").upload(path, file, { contentType: mime, upsert: false });
  if (error) throw new Error(`${file.name}: ${/row-level security|Unauthorized/i.test(error.message) ? "you do not have permission to upload to this quotation." : error.message}`);
  return { storage_path: path, file_name: file.name, mime_type: mime, size_bytes: file.size };
}
