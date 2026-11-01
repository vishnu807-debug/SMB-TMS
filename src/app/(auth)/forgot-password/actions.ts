"use server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestInfo, siteUrl } from "@/lib/request-info";

export async function requestReset(_prev: { done?: boolean; error?: string } | undefined, formData: FormData) {
  const parsed = z.string().trim().toLowerCase().email().safeParse(formData.get("email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${siteUrl()}/auth/confirm?next=/reset-password` });
  const admin = createAdminClient();
  const info = await requestInfo();
  if (admin) await admin.rpc("log_auth_event", { p_user: null, p_email: parsed.data, p_type: "password_reset_requested", p_ip: info.ip, p_user_agent: info.userAgent });
  // Always the same answer, so the form can't be used to discover accounts.
  return { done: true };
}
