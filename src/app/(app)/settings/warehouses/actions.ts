"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userMessage, type ActionResult } from "@/lib/errors";
import { str } from "@/lib/utils";

const schema = z.object({
  id: z.union([z.literal(""), z.string().uuid()]),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, "Code: up to 20 letters, numbers, - or _"),
  name: z.string().trim().min(2, "Enter a name").max(100),
  address: z.string().trim().max(500),
  phone: z.string().trim().max(40),
  is_active: z.boolean(),
});

export async function saveWarehouse(_prev: ActionResult | undefined, formData: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse({
    id: str(formData.get("id")), code: str(formData.get("code")), name: str(formData.get("name")),
    address: str(formData.get("address")), phone: str(formData.get("phone")), is_active: formData.get("is_active") === "on",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { id, ...row } = parsed.data;
  const payload = { ...row, address: row.address || null, phone: row.phone || null };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("warehouses").update(payload).eq("id", id)
    : await supabase.from("warehouses").insert(payload);
  if (error) return { ok: false, error: error.code === "23505" ? "A warehouse with this code already exists." : userMessage(error) };
  revalidatePath("/settings/warehouses");
  return { ok: true, message: "Warehouse saved." };
}
