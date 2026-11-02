"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colours must be in the form #RRGGBB");
const path = (folder: string) => z.union([z.literal(""), z.string().regex(new RegExp(`^${folder}/[A-Za-z0-9._-]+$`))]).optional();
const schema = z.object({
  product_name: z.string().trim().min(2, "Enter the product name").max(60).optional(),
  product_logo_path: path("product"),
  company_name: z.string().trim().min(2, "Enter the company name").max(80),
  company_logo_path: path("company"),
  tagline: z.string().trim().max(200), notice: z.string().trim().max(160),
  panel_color: color, panel_text_color: color, form_color: color, accent_color: color,
  panel_image_path: path("login"), form_image_path: path("login"),
});
const IMAGE_KEYS = ["product_logo_path", "company_logo_path", "panel_image_path", "form_image_path"] as const;

/** Saves the branding; files replaced or removed are deleted, and new uploads are discarded if saving fails. */
export async function saveBranding(payload: unknown, previous: Record<string, string | null>): Promise<ActionResult> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const p = parsed.data as Record<string, string | undefined>;
  const changed = IMAGE_KEYS.filter((k) => k in p && (p[k] || null) !== (previous[k] ?? null));
  const { error } = await supabase.rpc("save_login_branding", { p: parsed.data });
  const storage = supabase.storage.from("branding");
  if (error) {
    const fresh = changed.map((k) => p[k]).filter(Boolean) as string[];
    if (fresh.length) await storage.remove(fresh);
    return { ok: false, error: userMessage(error) };
  }
  const old = changed.map((k) => previous[k]).filter(Boolean) as string[];
  if (old.length) await storage.remove(old);
  revalidatePath("/", "layout");
  return { ok: true, message: "Branding saved. The login screen and menu now use it." };
}
