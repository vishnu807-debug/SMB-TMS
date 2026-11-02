/** Shared (server + browser) helpers for quotation editor lines. */
export type NewProduct = { id?: string; name: string; brand: string; model_no: string; description: string; specs: string; uom_id: string };

export const blankNewProduct = (uomId = ""): NewProduct => ({ name: "", brand: "", model_no: "", description: "", specs: "", uom_id: uomId });

/** [{name, value}] → "Name: value" per line (the editor's text form). */
export const specsToText = (specs: { name: string; value: string }[] | null | undefined) =>
  (specs ?? []).map((x) => (x.value ? `${x.name}: ${x.value}` : x.name)).join("\n");

export const textToSpecs = (t: string) => t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).map((x) => {
  const i = x.indexOf(":");
  return i > 0 ? { name: x.slice(0, i).trim(), value: x.slice(i + 1).trim() } : { name: x, value: "" };
});
