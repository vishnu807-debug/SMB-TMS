import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const qtyFmt = new Intl.NumberFormat("en-AE", { maximumFractionDigits: 3 });
const moneyFmt = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatQty(v: number | string | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  return qtyFmt.format(Number(v));
}

export function formatMoney(v: number | string | null | undefined, currency?: string) {
  if (v === null || v === undefined || v === "") return "—";
  const s = moneyFmt.format(Number(v));
  return currency ? `${currency} ${s}` : s;
}

export function formatDate(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Dubai" });
}

export function formatDateTime(v: string | null | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai",
  });
}

export function humanize(v: string | null | undefined) {
  if (!v) return "";
  return v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function str(v: FormDataEntryValue | null): string {
  return typeof v === "string" ? v.trim() : "";
}
