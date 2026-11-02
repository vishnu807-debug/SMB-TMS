import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";
import { MAX_IMPORT_ROWS } from "./columns";
import type { ImportResult } from "./types";

const rowsSchema = z.array(z.record(z.string().max(60), z.string().max(4000))).min(1, "The file has no data rows.")
  .max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} rows at a time.`);
const commitSchema = z.object({ fileName: z.string().trim().min(1).max(255), token: z.string().uuid() });

/** Validates (commit = false) or imports (commit = true) rows through the database function. */
export async function runImport(fn: "import_customers" | "import_leads", rows: unknown, commit: false | { fileName: string; token: string }): Promise<ActionResult<ImportResult>> {
  const parsed = rowsSchema.safeParse(rows);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  let extra = {};
  if (commit) {
    const c = commitSchema.safeParse(commit);
    if (!c.success) return { ok: false, error: "Missing import reference. Upload the file again." };
    extra = { p_file_name: c.data.fileName, p_token: c.data.token };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, { p_rows: parsed.data, p_commit: !!commit, ...extra });
  if (error) return { ok: false, error: userMessage(error) };
  return { ok: true, data: data as ImportResult };
}
