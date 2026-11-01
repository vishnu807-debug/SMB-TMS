import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="flex min-h-screen">
      <div className="hidden w-[44%] flex-col justify-between bg-navy-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-white text-lg font-bold text-navy-900">S</div>
          <span className="text-lg font-semibold tracking-wide">SMP Trading</span>
        </div>
        <div>
          <h1 className="text-3xl font-semibold leading-tight">Trading Management System</h1>
          <p className="mt-3 max-w-sm text-navy-200">Sales, procurement, inventory, logistics and finance in one connected system.</p>
        </div>
        <p className="text-xs text-navy-300">Authorised users only. Activity is logged.</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-white p-6">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold text-slate-900">Sign in</h2>
          <p className="mb-6 mt-1 text-sm text-slate-500">Use your SMP work email.</p>
          <LoginForm next={next} initialError={error === "inactive" ? "Your account is inactive. Please contact the administrator." : undefined} />
        </div>
      </div>
    </main>
  );
}
