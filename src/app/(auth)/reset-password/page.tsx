import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "../auth-shell";
import { ResetForm } from "./reset-form";
import { PASSWORD_HINT } from "@/lib/validation/password";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ first?: string }> }) {
  const { first } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?error=link");
  return (
    <AuthShell title={first ? "Welcome — choose your password" : "Choose a new password"}
      subtitle={first ? `You signed in with a temporary password. Choose your own to continue. ${PASSWORD_HINT}` : PASSWORD_HINT}>
      <ResetForm email={user.email ?? ""} />
    </AuthShell>
  );
}
