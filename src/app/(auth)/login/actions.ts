"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requestInfo } from "@/lib/request-info";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

export type LoginState = { error?: string } | undefined;

export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, password } = parsed.data;
  const info = await requestInfo();
  const admin = createAdminClient();

  // Lock-out after repeated failures (in addition to Supabase Auth's own rate limits).
  if (admin) {
    const { data: failures } = await admin.rpc("recent_failed_sign_ins", { p_email: email, p_minutes: LOCK_MINUTES });
    if ((failures ?? 0) >= MAX_FAILED) {
      await admin.rpc("log_auth_event", { p_user: null, p_email: email, p_type: "account_locked", p_ip: info.ip, p_user_agent: info.userAgent });
      return { error: `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes or reset your password.` };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (admin) await admin.rpc("log_auth_event", { p_user: null, p_email: email, p_type: "sign_in_failed", p_ip: info.ip, p_user_agent: info.userAgent, p_details: { reason: error.code ?? "invalid" } });
    // Same message for unknown email and wrong password, so accounts can't be probed.
    return { error: "Incorrect email or password." };
  }

  const { data: profile } = await supabase.from("profiles").select("is_active").single();
  if (!profile?.is_active) {
    await supabase.auth.signOut();
    return { error: "Your account is inactive. Please contact the administrator." };
  }
  await supabase.rpc("record_sign_in", { p_ip: info.ip, p_user_agent: info.userAgent });
  const next = parsed.data.next && parsed.data.next.startsWith("/") && !parsed.data.next.startsWith("//") ? parsed.data.next : "/";
  redirect(next);
}
