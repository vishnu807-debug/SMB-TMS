import "server-only";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { COLS, CompanyBlock, GREY, date, money, qty, s, type PdfCompany } from "./common";

export type QuotationPdfData = {
  company: PdfCompany;
  quotation: any;
  lines: any[];
  /** Names of the documents sent with the quotation. */
  enclosures?: string[];
};

function QuotationDoc({ company, quotation: q, lines, enclosures = [] }: QuotationPdfData) {
  const addr = (a: any) => (a ? [a.line1, a.line2, a.city, a.emirate, a.po_box && `P.O. Box ${a.po_box}`, a.country].filter(Boolean).join(", ") : null);
  const draft = ["draft", "pending_approval", "rejected"].includes(q.status);
  return (
    <Document title={`Quotation ${q.doc_no}`} author={company.legal_name} subject={q.subject ?? undefined}>
      <Page size="A4" style={s.page}>
        {draft && <Text style={s.watermark} fixed>DRAFT</Text>}
        <View style={s.header}>
          <CompanyBlock company={company} />
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
                <Text style={[s.muted, { fontSize: 7 }]}>{[l.product?.sku, l.qp?.brand, l.qp?.model_no && `Model ${l.qp.model_no}`].filter(Boolean).join("  ·  ")}{l.lead_time_text ? `  ·  Lead time: ${l.lead_time_text}` : ""}</Text>
                {(l.qp?.technical_specs ?? []).length > 0 && (
                  <Text style={[s.muted, { fontSize: 7 }]}>{l.qp.technical_specs.map((x: any) => (x.value ? `${x.name}: ${x.value}` : x.name)).join("  ·  ")}</Text>
                )}
              </View>
              <Text style={{ width: COLS.qty, textAlign: "right" }}>{qty(l.qty)}</Text>
              <Text style={{ width: COLS.unit, textAlign: "center" }}>{l.uom?.code ?? l.product?.uom?.code}</Text>
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
        {enclosures.length > 0 && (
          <View style={s.section} wrap={false}>
            <Text style={s.h}>Enclosures</Text>
            {enclosures.map((e, i) => <Text key={i}>{i + 1}. {e}</Text>)}
          </View>
        )}
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
