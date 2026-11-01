import { NextResponse, type NextRequest } from "next/server";
import { isAuthorisedCron } from "@/lib/cron";
import { dispatchEinvoices } from "@/lib/einvoicing/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Retries queued / failed e-invoices. Scheduled in vercel.json. */
export async function GET(req: NextRequest) {
  if (!isAuthorisedCron(req.headers.get("authorization"))) return new NextResponse("Unauthorised", { status: 401 });
  const r = await dispatchEinvoices(50);
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
