import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPintAe, type EInvoiceDocument } from "./pint-ae";
import { configuredProvider } from "./provider";

/**
 * Sends queued e-invoices to the ASP. Called right after an invoice is posted
 * (so it goes out immediately) and by the scheduled job (retries with back-off).
 * Safe to run concurrently: rows are claimed with SKIP LOCKED in the database.
 */
export async function dispatchEinvoices(limit = 20) {
  const provider = configuredProvider();
  if (!provider) return { ok: true, skipped: "EINVOICE_ASP_URL / EINVOICE_ASP_API_KEY not set — invoices stay queued." };
  const db = createAdminClient();
  if (!db) return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set." };
  const { data: batch, error } = await db.rpc("einvoice_claim_batch", { p_limit: limit });
  if (error) return { ok: false, error: error.message };
  const results: { invoice: string; status: string }[] = [];
  for (const t of (batch ?? []) as { transmission_id: string; document: EInvoiceDocument }[]) {
    let xml = "";
    let outcome;
    try {
      xml = buildPintAe(t.document);
      outcome = await provider.submit(xml, { invoiceNo: t.document.invoice.doc_no, uuid: t.document.invoice.einvoice_uuid, kind: t.document.invoice.kind });
    } catch (e) {
      outcome = { status: "failed" as const, error: (e as Error).message, reference: undefined, response: undefined };
    }
    await db.rpc("einvoice_record_result", {
      p_transmission_id: t.transmission_id, p_status: outcome.status, p_provider_ref: outcome.reference ?? null,
      p_request: { provider: provider.name, bytes: xml.length }, p_response: (outcome.response ?? null) as any, p_error: outcome.error ?? null,
    });
    results.push({ invoice: t.document.invoice.doc_no, status: outcome.status });
  }
  return { ok: true, processed: results.length, results };
}
