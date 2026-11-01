import "server-only";

export type SubmitResult = { status: "submitted" | "accepted" | "rejected" | "failed"; reference?: string; response?: unknown; error?: string };

/** One Accredited Service Provider (ASP). Add a class per ASP if their API differs. */
export interface EInvoiceProvider {
  readonly name: string;
  submit(xml: string, meta: { invoiceNo: string; uuid: string; kind: string }): Promise<SubmitResult>;
}

/**
 * Generic HTTP connector. Most UAE ASPs accept the UBL document by HTTPS POST with an API key and reply with
 * a reference and a status. Configure with environment variables (server only):
 *   EINVOICE_ASP_URL       – the ASP's submission endpoint
 *   EINVOICE_ASP_API_KEY   – credential issued by the ASP
 *   EINVOICE_ASP_NAME      – shown in the transmission log (optional)
 * Expected reply: JSON { status?: "accepted"|"submitted"|"rejected", reference?|id?, message?|errors? }.
 * If your ASP's contract differs, adapt mapResponse() — the rest of the system is unchanged.
 */
export class HttpAspProvider implements EInvoiceProvider {
  readonly name: string;
  constructor(private url: string, private apiKey: string, name?: string) { this.name = name ?? "ASP"; }

  async submit(xml: string, meta: { invoiceNo: string; uuid: string; kind: string }): Promise<SubmitResult> {
    let res: Response;
    try {
      res = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/xml", Authorization: `Bearer ${this.apiKey}`, "X-Document-Id": meta.uuid, "X-Document-Number": meta.invoiceNo },
        body: xml,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      return { status: "failed", error: `Could not reach ${this.name}: ${(e as Error).message}` };
    }
    const text = await res.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    return this.mapResponse(res.status, body);
  }

  private mapResponse(http: number, body: any): SubmitResult {
    const ref = body?.reference ?? body?.id ?? body?.documentId;
    const message = body?.message ?? (Array.isArray(body?.errors) ? body.errors.map((e: any) => e?.message ?? String(e)).join("; ") : undefined);
    if (http === 401 || http === 403) return { status: "failed", response: body, error: `${this.name} refused the credentials (HTTP ${http}).` };
    if (http === 400 || http === 422) return { status: "rejected", reference: ref, response: body, error: message ?? `Rejected by ${this.name} (HTTP ${http}).` };
    if (http >= 500 || http === 429) return { status: "failed", response: body, error: `${this.name} unavailable (HTTP ${http}); will retry.` };
    if (http >= 200 && http < 300) {
      const s = String(body?.status ?? "submitted").toLowerCase();
      if (s.includes("reject") || s.includes("invalid")) return { status: "rejected", reference: ref, response: body, error: message ?? "Rejected" };
      return { status: s.includes("accept") || s.includes("deliver") || s.includes("success") ? "accepted" : "submitted", reference: ref, response: body };
    }
    return { status: "failed", response: body, error: `Unexpected reply from ${this.name} (HTTP ${http}).` };
  }
}

export function configuredProvider(): EInvoiceProvider | null {
  const url = process.env.EINVOICE_ASP_URL;
  const key = process.env.EINVOICE_ASP_API_KEY;
  if (!url || !key) return null;
  return new HttpAspProvider(url, key, process.env.EINVOICE_ASP_NAME);
}
