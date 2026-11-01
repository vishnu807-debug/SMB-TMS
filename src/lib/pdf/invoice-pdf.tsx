import "server-only";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { CompanyBlock, GREY, date, money, qty, s, type PdfCompany } from "./common";

export type InvoicePdfData = { company: PdfCompany & { invoice_footer?: string | null }; inv: any; lines: any[]; baseCurrency: string };
const C = { no: 20, qty: 44, unit: 30, price: 58, disc: 34, vat: 34, net: 62, tax: 52 };

// UAE tax invoice / tax credit note: supplier & recipient TRN, sequential number, issue and supply dates,
// per-line VAT rate and amount, totals, and VAT in AED when invoiced in another currency.
function InvoiceDoc({ company, inv, lines, baseCurrency }: InvoicePdfData) {
  const isCN = inv.kind === "credit_note";
  const foreign = inv.currency_code !== baseCurrency;
  return (
    <Document title={`${isCN ? "Tax credit note" : "Tax invoice"} ${inv.doc_no ?? ""}`} author={company.legal_name}>
      <Page size="A4" style={s.page}>
        {inv.status === "void" && <Text style={s.watermark} fixed>VOID</Text>}
        {inv.status === "draft" && <Text style={s.watermark} fixed>DRAFT</Text>}
        <View style={s.header}>
          <CompanyBlock company={company} />
          <View>
            <Text style={s.title}>{isCN ? "TAX CREDIT NOTE" : "TAX INVOICE"}</Text>
            <Text style={{ textAlign: "right", marginTop: 4, fontWeight: 700 }}>{inv.doc_no ?? "DRAFT"}</Text>
            <Text style={[s.muted, { textAlign: "right" }]}>Date of issue: {date(inv.invoice_date)}</Text>
            <Text style={[s.muted, { textAlign: "right" }]}>Date of supply: {date(inv.supply_date ?? inv.invoice_date)}</Text>
            {!isCN && <Text style={[s.muted, { textAlign: "right" }]}>Due date: {date(inv.due_date)}</Text>}
          </View>
        </View>
        <View style={[s.row, { gap: 10 }]}>
          <View style={s.box}>
            <Text style={s.label}>Bill to</Text>
            <Text style={s.bold}>{inv.customer_name}</Text>
            {inv.billing_address && <Text>{inv.billing_address}</Text>}
            <Text style={{ marginTop: 3 }}>TRN: {inv.customer_trn ?? "Not registered"}</Text>
          </View>
          <View style={s.box}>
            <Text style={s.label}>Details</Text>
            {isCN && inv.orig && <Text>Credit against invoice {inv.orig.doc_no} dated {date(inv.orig.invoice_date)}</Text>}
            {isCN && inv.reason && <Text>Reason: {inv.reason}</Text>}
            {inv.so && <Text>Our order: {inv.so.doc_no}</Text>}
            {inv.customer_reference && !isCN && <Text>Your reference: {inv.customer_reference}</Text>}
            <Text>Currency: {inv.currency_code}{foreign ? ` (1 ${inv.currency_code} = ${Number(inv.exchange_rate)} ${baseCurrency})` : ""}</Text>
            {inv.pterm && !isCN && <Text>Payment terms: {inv.pterm.name}</Text>}
          </View>
        </View>
        <View style={{ marginTop: 12 }}>
          <View style={s.th} fixed>
            <Text style={{ width: C.no }}>#</Text><Text style={{ flex: 1 }}>Description</Text>
            <Text style={{ width: C.qty, textAlign: "right" }}>Qty</Text><Text style={{ width: C.unit, textAlign: "center" }}>Unit</Text>
            <Text style={{ width: C.price, textAlign: "right" }}>Unit price</Text><Text style={{ width: C.disc, textAlign: "right" }}>Disc.</Text>
            <Text style={{ width: C.net, textAlign: "right" }}>Taxable</Text><Text style={{ width: C.vat, textAlign: "right" }}>VAT %</Text>
            <Text style={{ width: C.tax, textAlign: "right" }}>VAT</Text>
          </View>
          {lines.map((l) => (
            <View key={l.id} style={s.tr} wrap={false}>
              <Text style={{ width: C.no, color: GREY }}>{l.line_no}</Text>
              <View style={{ flex: 1, paddingRight: 6 }}><Text>{l.description}</Text>{l.product?.sku && <Text style={[s.muted, { fontSize: 7 }]}>{l.product.sku}</Text>}</View>
              <Text style={{ width: C.qty, textAlign: "right" }}>{qty(l.qty)}</Text>
              <Text style={{ width: C.unit, textAlign: "center" }}>{l.uom_code ?? ""}</Text>
              <Text style={{ width: C.price, textAlign: "right" }}>{money(l.unit_price)}</Text>
              <Text style={{ width: C.disc, textAlign: "right" }}>{Number(l.discount_pct) ? `${Number(l.discount_pct)}%` : "—"}</Text>
              <Text style={{ width: C.net, textAlign: "right" }}>{money(l.net_amount)}</Text>
              <Text style={{ width: C.vat, textAlign: "right" }}>{l.tax_category === "SR" ? `${Number(l.tax_rate)}%` : l.tax_category}</Text>
              <Text style={{ width: C.tax, textAlign: "right" }}>{money(l.tax_amount)}</Text>
            </View>
          ))}
        </View>
        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}><Text style={s.muted}>Total excluding VAT</Text><Text>{money(inv.net_total)}</Text></View>
          <View style={s.totalRow}><Text style={s.muted}>VAT</Text><Text>{money(inv.tax_total)}</Text></View>
          <View style={s.grand}><Text>{isCN ? "Total credit" : "Total payable"} {inv.currency_code}</Text><Text>{money(inv.total)}</Text></View>
          {foreign && <View style={s.totalRow}><Text style={s.muted}>VAT in {baseCurrency}</Text><Text>{money(Number(inv.tax_total) * Number(inv.exchange_rate))}</Text></View>}
          {foreign && <View style={s.totalRow}><Text style={s.muted}>Total in {baseCurrency}</Text><Text>{money(inv.total_base)}</Text></View>}
        </View>
        {inv.notes && <View style={s.section} wrap={false}><Text style={s.h}>Notes</Text><Text>{inv.notes}</Text></View>}
        {inv.terms && !isCN && (
          <View style={s.section}><Text style={s.h}>Terms</Text>
            {String(inv.terms).split(/\r?\n/).filter((t) => t.trim()).map((t, n) => <Text key={n} style={{ marginBottom: 2 }}>{t}</Text>)}</View>
        )}
        {company.bank_details && !isCN && <View style={s.section} wrap={false}><Text style={s.h}>Bank details for payment</Text><Text>{company.bank_details}</Text></View>}
        {inv.einvoice_ref && <Text style={[s.muted, { marginTop: 10, fontSize: 7 }]}>E-invoice reference: {inv.einvoice_ref} · UUID {inv.einvoice_uuid}</Text>}
        <View style={s.footer} fixed>
          <Text>{inv.doc_no ?? "Draft"} · {company.legal_name}{company.trn ? ` · TRN ${company.trn}` : ""}{company.invoice_footer ? ` · ${company.invoice_footer}` : ""}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDoc {...data} />);
}
