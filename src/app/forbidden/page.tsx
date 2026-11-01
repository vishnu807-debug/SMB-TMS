import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function Forbidden() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <ShieldAlert className="mx-auto size-10 text-navy-700" />
        <h1 className="mt-4 text-xl font-semibold">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-sm text-slate-500">Your role does not include this permission. Ask your manager or the administrator if you need it.</p>
        <Link href="/" className="mt-6 inline-block text-sm font-medium text-navy-700 hover:underline">Back to the dashboard</Link>
      </div>
    </main>
  );
}
