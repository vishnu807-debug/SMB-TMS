import "server-only";
import path from "node:path";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

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

const NAVY = "#0f244b";
const GREY = "#64748b";
const s = StyleSheet.create({
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
const COLS = { no: 22, desc: 0, qty: 46, unit: 34, price: 64, disc: 36, vat: 34, amt: 74 };

const money = (v: number | string | null | undefined) =>
  new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0));
const qty = (v: number | string) => new Intl.NumberFormat("en-AE", { maximumFractionDigits: 3 }).format(Number(v));
const date = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

export type QuotationPdfData = {
  company: { legal_name: string; trade_name?: string | null; trn?: string | null; address?: string | null; city?: string | null; country?: string | null;
    phone?: string | null; email?: string | null; website?: string | null; bank_details?: string | null; logoUrl?: string | null };
  quotation: any;
  lines: any[];
};

function QuotationDoc({ company, quotation: q, lines }: QuotationPdfData) {
  const addr = (a: any) => (a ? [a.line1, a.line2, a.city, a.emirate, a.po_box && `P.O. Box ${a.po_box}`, a.country].filter(Boolean).join(", ") : null);
  const draft = ["draft", "pending_approval", "rejected"].includes(q.status);
  return (
    <Document title={`Quotation ${q.doc_no}`} author={company.legal_name} subject={q.subject ?? undefined}>
      <Page size="A4" style={s.page}>
        {draft && <Text style={s.watermark} fixed>DRAFT</Text>}
        <View style={s.header}>
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
          <View>
            <Text style={s.title}>QUOTATION</Text>
            <Text style={{ textAlign: "right", marginTop: 4, fontWeight: 700 }}>{q.doc_no}</Text>
            <Text style={[s.muted, { textAlign: "right" }]}>Date: {date(q.quotation_date)}</Text>
            <Text style={[s.muted, { textAlign: "right" }]}>Valid until: {date(q.valid_until)}</Text>
          </View>
        </View>

        <View style={[s.row, { gap: 10 }]}>
          <View style={s.box}>
            <Text style={s.label}>Quotation to</Text>
            <Text style={s.bold}>{q.customer?.name}</Text>
            {addr(q.bill) && <Text>{addr(q.bill)}</Text>}
            {q.customer?.trn && <Text>TRN: {q.customer.trn}</Text>}
            {q.contact && <Text style={{ marginTop: 3 }}>Attn: {q.contact.name}{q.contact.email ? ` · ${q.contact.email}` : ""}{q.contact.mobile ? ` · ${q.contact.mobile}` : ""}</Text>}
          </View>
          <View style={s.box}>
            <Text style={s.label}>Details</Text>
            {q.customer_reference && <Text>Your reference: {q.customer_reference}</Text>}
            <Text>Currency: {q.currency_code}</Text>
            <Text>Payment terms: {q.pterm?.name ?? "—"}</Text>
            <Text>Delivery terms: {q.dterm ? `${q.dterm.code} — ${q.dterm.name}` : "—"}</Text>
            {q.delivery_time && <Text>Delivery time: {q.delivery_time}</Text>}
            {(addr(q.ship) || q.delivery_location) && <Text>Deliver to: {addr(q.ship) ?? q.delivery_location}</Text>}
            <Text>Sales contact: {q.rep?.full_name}</Text>
          </View>
        </View>

        {q.subject && <Text style={[s.bold, { marginTop: 12, fontSize: 10 }]}>Subject: {q.subject}</Text>}

        <View style={{ marginTop: 10 }}>
          <View style={s.th} fixed>
            <Text style={{ width: COLS.no }}>#</Text>
            <Text style={{ flex: 1 }}>Description</Text>
            <Text style={{ width: COLS.qty, textAlign: "right" }}>Qty</Text>
            <Text style={{ width: COLS.unit, textAlign: "center" }}>Unit</Text>
            <Text style={{ width: COLS.price, textAlign: "right" }}>Unit price</Text>
            <Text style={{ width: COLS.disc, textAlign: "right" }}>Disc.</Text>
            <Text style={{ width: COLS.vat, textAlign: "right" }}>VAT</Text>
            <Text style={{ width: COLS.amt, textAlign: "right" }}>Amount</Text>
          </View>
          {lines.map((l) => (
            <View key={l.id} style={s.tr} wrap={false}>
              <Text style={{ width: COLS.no, color: GREY }}>{l.line_no}</Text>
              <View style={{ flex: 1, paddingRight: 6 }}>
                <Text>{l.description}</Text>
                <Text style={[s.muted, { fontSize: 7 }]}>{l.product?.sku}{l.lead_time_text ? `  ·  Lead time: ${l.lead_time_text}` : ""}</Text>
              </View>
              <Text style={{ width: COLS.qty, textAlign: "right" }}>{qty(l.qty)}</Text>
              <Text style={{ width: COLS.unit, textAlign: "center" }}>{l.product?.uom?.code}</Text>
              <Text style={{ width: COLS.price, textAlign: "right" }}>{money(l.unit_price)}</Text>
              <Text style={{ width: COLS.disc, textAlign: "right" }}>{Number(l.discount_pct) ? `${Number(l.discount_pct)}%` : "—"}</Text>
              <Text style={{ width: COLS.vat, textAlign: "right" }}>{Number(l.tax_rate)}%</Text>
              <Text style={{ width: COLS.amt, textAlign: "right" }}>{money(l.net_amount)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}><Text style={s.muted}>Subtotal</Text><Text>{money(q.gross_amount)}</Text></View>
          {Number(q.discount_total) > 0 && <View style={s.totalRow}><Text style={s.muted}>Discount</Text><Text>-{money(q.discount_total)}</Text></View>}
          <View style={s.totalRow}><Text style={s.muted}>Net amount</Text><Text>{money(q.net_total)}</Text></View>
          <View style={s.totalRow}><Text style={s.muted}>VAT</Text><Text>{money(q.tax_total)}</Text></View>
          <View style={s.grand}><Text>Total {q.currency_code}</Text><Text>{money(q.total)}</Text></View>
        </View>

        {q.notes && <View style={s.section} wrap={false}><Text style={s.h}>Notes</Text><Text>{q.notes}</Text></View>}
        {q.terms_conditions && (
          <View style={s.section}>
            <Text style={s.h}>Terms and conditions</Text>
            {String(q.terms_conditions).split(/\r?\n/).filter((t) => t.trim()).map((t, i) => <Text key={i} style={{ marginBottom: 2 }}>{t}</Text>)}
          </View>
        )}
        {company.bank_details && <View style={s.section} wrap={false}><Text style={s.h}>Bank details</Text><Text>{company.bank_details}</Text></View>}

        <View style={[s.row, { marginTop: 30, justifyContent: "space-between" }]} wrap={false}>
          <View style={{ width: 230 }}>
            <Text style={s.muted}>For {company.legal_name}</Text>
            <Text style={{ marginTop: 28, borderTopWidth: 0.5, borderTopColor: GREY, paddingTop: 3 }}>{q.rep?.full_name}</Text>
          </View>
          <View style={{ width: 230 }}>
            <Text style={s.muted}>Accepted by customer (name, signature, stamp)</Text>
            <Text style={{ marginTop: 28, borderTopWidth: 0.5, borderTopColor: GREY, paddingTop: 3 }}> </Text>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>{q.doc_no} · {company.legal_name}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderQuotationPdf(data: QuotationPdfData): Promise<Buffer> {
  return renderToBuffer(<QuotationDoc {...data} />);
}
