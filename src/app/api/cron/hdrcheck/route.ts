import { headers } from "next/headers";
export const dynamic = "force-dynamic";
export async function GET() { return new Response((await headers()).get("x-pathname") ?? "MISSING"); }
