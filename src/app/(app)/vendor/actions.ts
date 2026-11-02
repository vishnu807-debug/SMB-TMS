"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformAdmin } from "@/lib/auth/session";
import { userMessage, type ActionResult } from "@/lib/errors";
import { str } from "@/lib/utils";

const schema = z.object({
  modules: z.array(z.string().regex(/^[a-z_]{2,30}$/)).max(30),
  reference: z.string().trim().min(3, "Enter the licence or order reference for this change.").max(120),
});

/** Saves the full set of modules the client has licensed (the database checks vendor access and dependencies). */
export async function saveLicensedModules(_p: ActionResult | undefined, fd: FormData): Promise<ActionResult> {
  await requirePlatformAdmin();
  const parsed = schema.safeParse({ modules: fd.getAll("modules").map((v) => String(v)), reference: str(fd.get("reference")) });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vendor_set_modules", { p_codes: parsed.data.modules, p_reference: parsed.data.reference });
  if (error) return { ok: false, error: userMessage(error) };
  // Menus of every page depend on the module set.
  revalidatePath("/", "layout");
  const n = Number(data ?? 0);
  return { ok: true, message: n === 0 ? "No changes — the modules were already set this way." : `${n} module${n === 1 ? "" : "s"} updated. Users see the change on their next page load.` };
}
