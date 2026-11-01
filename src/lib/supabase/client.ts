"use client";
import { createBrowserClient } from "@supabase/ssr";

/** Browser client — anon key only; all access is governed by RLS. Used for file uploads. */
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
