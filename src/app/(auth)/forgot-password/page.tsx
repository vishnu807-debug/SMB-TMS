import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "../auth-shell";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to choose a new password.">
      <ForgotForm />
      <p className="mt-4 text-center text-sm"><Link href="/login" className="text-navy-700 hover:underline">Back to sign in</Link></p>
    </AuthShell>
  );
}
