import "server-only";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { CompanyBlock, GREY, date, money, qty, s, type PdfCompany } from "./common";

export type PurchaseOrderPdfData = { company: PdfCompany & { purchase_order_terms?: string | null }; po: any; lines: any[] };
const C = { no: 22, qty: 50, unit: 36, price: 70, vat: 36, amt: 80 };

function PurchaseOrderDoc({ company, po, lines }: PurchaseOrderPdfData) {
  const draft = ["draft", "pending_approval"].includes(po.status);
  const cancelled = po.status === "cancelled";
  return (
    <Document title={`Purchase order ${po.doc_no}`} author={company.legal_name}>
      <Page size="A4" style={s.page}>
        {(draft || cancelled) && <Text style={s.watermark} fixed>{cancelled ? "CANCELLED" : "DRAFT"}</Text>}
        <View style={s.header}>
          <CompanyBlock company={company} />
          <View>
            <Text style={s.title}>PURCHASE ORDER</Text>
            <Text style={{ textAlign: "right", marginTop: 4, fontWeight: 700 }}>{po.doc_no}</Text>
            <Text style={[s.muted, { textAlign: "right" }]}>Date: {date(po.order_date)}</Text>
            {po.expected_date && <Text style={[s.muted, { textAlign: "right" }]}>Required by: {date(po.expected_date)}</Text>}
          </View>
        </View>

        <View style={[s.row, { gap: 10 }]}>
          <View style={s.box}>
            <Text style={s.label}>Supplier</Text>
            <Text style={s.bold}>{po.supplier?.name}</Text>
            {po.supplier?.address && <Text>{[po.supplier.address, po.supplier.city, po.supplier.country].filter(Boolean).join(", ")}</Text>}
            {po.supplier?.trn && <Text>TRN: {po.supplier.trn}</Text>}
            {po.contact && <Text style={{ marginTop: 3 }}>Attn: {po.contact.name}{po.contact.email ? ` · ${po.contact.email}` : ""}{po.contact.phone ? ` · ${po.contact.phone}` : ""}</Text>}
          </View>
          <View style={s.box}>
            <Text style={s.label}>Deliver to</Text>
            <Text style={s.bold}>{po.warehouse?.name}</Text>
            {po.warehouse?.address && <Text>{po.warehouse.address}</Text>}
            <Text style={{ marginTop: 3 }}>Currency: {po.currency_code}</Text>
            <Text>Payment terms: {po.pterm?.name ?? "—"}</Text>
            <Text>Delivery terms: {po.dterm ? `${po.dterm.code} — ${po.dterm.name}` : "—"}</Text>
            {po.supplier_reference && <Text>Your quotation: {po.supplier_reference}</Text>}
          </View>
        </View>

        <View style={{ marginTop: 12 }}>
          <View style={s.th} fixed>
            <Text style={{ width: C.no }}>#</Text>
            <Text style={{ flex: 1 }}>Description</Text>
            <Text style={{ width: C.qty, textAlign: "right" }}>Qty</Text>
            <Text style={{ width: C.unit, textAlign: "center" }}>Unit</Text>
            <Text style={{ width: C.price, textAlign: "right" }}>Unit price</Text>
            <Text style={{ width: C.vat, textAlign: "right" }}>VAT</Text>
            <Text style={{ width: C.amt, textAlign: "right" }}>Amount</Text>
          </View>
          {lines.map((l) => (
            <View key={l.id} style={s.tr} wrap={false}>
              <Text style={{ width: C.no, color: GREY }}>{l.line_no}</Text>
              <View style={{ flex: 1, paddingRight: 6 }}>
                <Text>{l.description}</Text>
                <Text style={[s.muted, { fontSize: 7 }]}>{l.product?.sku}{l.product?.model_no ? `  ·  Model ${l.product.model_no}` : ""}</Text>
              </View>
              <Text style={{ width: C.qty, textAlign: "right" }}>{qty(l.qty)}</Text>
              <Text style={{ width: C.unit, textAlign: "center" }}>{l.product?.uom?.code}</Text>
              <Text style={{ width: C.price, textAlign: "right" }}>{money(l.unit_cost)}</Text>
              <Text style={{ width: C.vat, textAlign: "right" }}>{Number(l.tax_rate)}%</Text>
              <Text style={{ width: C.amt, textAlign: "right" }}>{money(l.net_amount)}</Text>
            </View>
          ))}
        </View>

        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}><Text style={s.muted}>Net amount</Text><Text>{money(po.net_total)}</Text></View>
          <View style={s.totalRow}><Text style={s.muted}>VAT</Text><Text>{money(po.tax_total)}</Text></View>
          <View style={s.grand}><Text>Total {po.currency_code}</Text><Text>{money(po.total)}</Text></View>
        </View>

        {po.terms_conditions && (
          <View style={s.section}>
            <Text style={s.h}>Terms and conditions</Text>
            {String(po.terms_conditions).split(/\r?\n/).filter((t) => t.trim()).map((t, i) => <Text key={i} style={{ marginBottom: 2 }}>{t}</Text>)}
          </View>
        )}

        <View style={[s.row, { marginTop: 30, justifyContent: "space-between" }]} wrap={false}>
          <View style={{ width: 230 }}>
            <Text style={s.muted}>Authorised for {company.legal_name}</Text>
            <Text style={{ marginTop: 28, borderTopWidth: 0.5, borderTopColor: GREY, paddingTop: 3 }}>{po.approver?.full_name ?? po.creator?.full_name ?? " "}</Text>
          </View>
          <View style={{ width: 230 }}>
            <Text style={s.muted}>Accepted by supplier (name, signature, stamp)</Text>
            <Text style={{ marginTop: 28, borderTopWidth: 0.5, borderTopColor: GREY, paddingTop: 3 }}> </Text>
          </View>
        </View>

        <View style={s.footer} fixed>
          <Text>{po.doc_no} · {company.legal_name}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderPurchaseOrderPdf(data: PurchaseOrderPdfData): Promise<Buffer> {
  return renderToBuffer(<PurchaseOrderDoc {...data} />);
}
