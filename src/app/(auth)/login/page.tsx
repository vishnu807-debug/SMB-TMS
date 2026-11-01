import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { AuthShell } from "../auth-shell";

export const metadata: Metadata = { title: "Sign in" };

const MESSAGES: Record<string, string> = {
  inactive: "Your account is inactive. Please contact the administrator.",
  session: "You have been signed out. Please sign in again.",
  link: "That link is invalid or has expired. Request a new one.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; reset?: string }> }) {
  const { next, error, reset } = await searchParams;
  return (
    <AuthShell title="Sign in" subtitle="Use your SMP work email.">
      {reset === "done" && <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Your password has been changed. Sign in with the new password.</p>}
      <LoginForm next={next} initialError={error ? MESSAGES[error] : undefined} />
      <p className="mt-4 text-center text-sm"><Link href="/forgot-password" className="text-navy-700 hover:underline">Forgot your password?</Link></p>
    </AuthShell>
  );
}
