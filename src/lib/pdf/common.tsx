import "server-only";
import path from "node:path";
import { Font, Image, StyleSheet, Text, View } from "@react-pdf/renderer";

// Embedded font: full Latin coverage (², €, accented names) and matches the app.
const FONT_DIR = path.join(process.cwd(), "node_modules", "@fontsource", "inter", "files");
Font.register({
  family: "Inter",
  fonts: [
    { src: path.join(FONT_DIR, "inter-latin-400-normal.woff"), fontWeight: 400 },
    { src: path.join(FONT_DIR, "inter-latin-700-normal.woff"), fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

export const NAVY = "#0f244b";
export const GREY = "#64748b";
export const s = StyleSheet.create({
  page: { padding: 36, paddingBottom: 56, fontSize: 9, fontFamily: "Inter", color: "#0f172a" },
  header: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: NAVY, paddingBottom: 12, marginBottom: 14 },
  company: { fontSize: 14, fontWeight: 700, color: NAVY },
  muted: { color: GREY },
  title: { fontSize: 18, fontWeight: 700, color: NAVY, textAlign: "right" },
  row: { flexDirection: "row" },
  box: { flex: 1, borderWidth: 1, borderColor: "#e2e8f0", padding: 8, borderRadius: 3 },
  label: { fontSize: 7, color: GREY, textTransform: "uppercase", marginBottom: 2, letterSpacing: 0.5 },
  bold: { fontWeight: 700 },
  th: { flexDirection: "row", backgroundColor: NAVY, color: "#fff", fontWeight: 700, paddingVertical: 5, paddingHorizontal: 4, fontSize: 8 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e2e8f0", paddingVertical: 5, paddingHorizontal: 4 },
  totals: { marginTop: 8, marginLeft: "auto", width: 220 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: NAVY, marginTop: 3, paddingTop: 4, fontSize: 11, fontWeight: 700, color: NAVY },
  section: { marginTop: 14 },
  h: { fontSize: 9, fontWeight: 700, color: NAVY, marginBottom: 4 },
  footer: { position: "absolute", bottom: 22, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: GREY, borderTopWidth: 0.5, borderTopColor: "#cbd5e1", paddingTop: 5 },
  watermark: { position: "absolute", top: 330, left: 90, fontSize: 90, color: "#e2e8f0", transform: "rotate(-30deg)", fontWeight: 700 },
});
export const COLS = { no: 22, desc: 0, qty: 46, unit: 34, price: 64, disc: 36, vat: 34, amt: 74 };

export const money = (v: number | string | null | undefined) =>
  new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0));
export const qty = (v: number | string) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 3 }).format(Number(v));
export const date = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export type PdfCompany = { legal_name: string; trade_name?: string | null; trn?: string | null; address?: string | null; city?: string | null; country?: string | null;
  phone?: string | null; email?: string | null; website?: string | null; bank_details?: string | null; logoUrl?: string | null };

export function CompanyBlock({ company }: { company: PdfCompany }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, maxWidth: 300 }}>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      {company.logoUrl && <Image src={company.logoUrl} style={{ width: 54, height: 54, objectFit: "contain" }} />}
      <View>
        <Text style={s.company}>{company.trade_name || company.legal_name}</Text>
        {company.trade_name && <Text style={s.muted}>{company.legal_name}</Text>}
        <Text style={s.muted}>{[company.address, company.city, company.country].filter(Boolean).join(", ")}</Text>
        <Text style={s.muted}>{[company.phone, company.email, company.website].filter(Boolean).join("  ·  ")}</Text>
        {company.trn && <Text style={s.muted}>TRN: {company.trn}</Text>}
      </View>
    </View>
  );
}
