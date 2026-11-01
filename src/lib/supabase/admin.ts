import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. SERVER ONLY — bypasses Row Level Security.
 * Used for exactly three things: inviting users (Auth Admin API), recording
 * failed sign-ins before a session exists, and the sign-in lock-out check.
 * Never import this from a client component; the "server-only" import makes
 * the build fail if anyone tries.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
