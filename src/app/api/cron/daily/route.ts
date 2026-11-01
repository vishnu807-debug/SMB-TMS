import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorisedCron } from "@/lib/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daily housekeeping: low-stock alerts and expiring quotations (if pg_cron is not used). */
export async function GET(req: NextRequest) {
  if (!isAuthorisedCron(req.headers.get("authorization"))) return new NextResponse("Unauthorised", { status: 401 });
  const db = createAdminClient();
  if (!db) return NextResponse.json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set." }, { status: 500 });
  const [stock, quotes] = await Promise.all([db.rpc("notify_low_stock"), db.rpc("expire_quotations")]);
  return NextResponse.json({ ok: !stock.error && !quotes.error, low_stock: stock.error?.message ?? stock.data, expired_quotes: quotes.error?.message ?? quotes.data });
}
