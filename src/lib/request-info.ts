import "server-only";
import { headers } from "next/headers";

export async function requestInfo() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || null;
  return { ip: ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
