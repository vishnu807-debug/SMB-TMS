import "server-only";
import { Document, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { CompanyBlock, GREY, date, qty, s, type PdfCompany } from "./common";

export type DeliveryNotePdfData = { company: PdfCompany; dn: any; lines: any[] };

function DeliveryNoteDoc({ company, dn, lines }: DeliveryNotePdfData) {
  return (
    <Document title={`Delivery note ${dn.doc_no}`} author={company.legal_name}>
      <Page size="A4" style={s.page}>
        {dn.status === "cancelled" && <Text style={s.watermark} fixed>CANCELLED</Text>}
        <View style={s.header}>
          <CompanyBlock company={company} />
          <View>
            <Text style={s.title}>DELIVERY NOTE</Text>
            <Text style={{ textAlign: "right", marginTop: 4, fontWeight: 700 }}>{dn.doc_no}</Text>
            <Text style={[s.muted, { textAlign: "right" }]}>Date: {date(dn.delivery_date)}</Text>
            <Text style={[s.muted, { textAlign: "right" }]}>Our order: {dn.so?.doc_no}</Text>
            {dn.so?.customer_po_ref && <Text style={[s.muted, { textAlign: "right" }]}>Your PO: {dn.so.customer_po_ref}</Text>}
          </View>
        </View>
        <View style={[s.row, { gap: 10 }]}>
          <View style={s.box}>
            <Text style={s.label}>Customer</Text>
            <Text style={s.bold}>{dn.customer?.name}</Text>
            {dn.customer?.trn && <Text>TRN: {dn.customer.trn}</Text>}
          </View>
          <View style={s.box}>
            <Text style={s.label}>Deliver to</Text>
            <Text>{dn.delivery_address ?? "—"}</Text>
            {(dn.contact_name || dn.contact_phone) && <Text style={{ marginTop: 3 }}>Contact: {[dn.contact_name, dn.contact_phone].filter(Boolean).join(" · ")}</Text>}
            {dn.shipment && <Text style={{ marginTop: 3 }}>Vehicle: {[dn.shipment.vehicle_no, dn.shipment.driver_name, dn.shipment.carrier_name, dn.shipment.tracking_no].filter(Boolean).join(" · ") || dn.shipment.doc_no}</Text>}
          </View>
        </View>
        <View style={{ marginTop: 12 }}>
          <View style={s.th} fixed>
            <Text style={{ width: 22 }}>#</Text><Text style={{ width: 90 }}>Item code</Text><Text style={{ flex: 1 }}>Description</Text>
            <Text style={{ width: 60, textAlign: "right" }}>Quantity</Text><Text style={{ width: 40, textAlign: "center" }}>Unit</Text>
          </View>
          {lines.map((l) => (
            <View key={l.id} style={s.tr} wrap={false}>
              <Text style={{ width: 22, color: GREY }}>{l.line_no}</Text>
              <Text style={{ width: 90 }}>{l.product?.sku}</Text>
              <Text style={{ flex: 1, paddingRight: 6 }}>{l.description}</Text>
              <Text style={{ width: 60, textAlign: "right", fontWeight: 700 }}>{qty(l.qty)}</Text>
              <Text style={{ width: 40, textAlign: "center" }}>{l.product?.uom?.code}</Text>
            </View>
          ))}
        </View>
        {dn.notes && <View style={s.section} wrap={false}><Text style={s.h}>Notes</Text><Text>{dn.notes}</Text></View>}
        <Text style={[s.muted, { marginTop: 16 }]}>Goods received in good order and condition. Please check quantities on receipt; shortages or damage must be noted on this delivery note.</Text>
        <View style={[s.row, { marginTop: 30, justifyContent: "space-between" }]} wrap={false}>
          <View style={{ width: 160 }}><Text style={s.muted}>Issued by (warehouse)</Text><Text style={{ marginTop: 28, borderTopWidth: 0.5, borderTopColor: GREY, paddingTop: 3 }}> </Text></View>
          <View style={{ width: 160 }}><Text style={s.muted}>Driver</Text><Text style={{ marginTop: 28, borderTopWidth: 0.5, borderTopColor: GREY, paddingTop: 3 }}>{dn.shipment?.driver_name ?? " "}</Text></View>
          <View style={{ width: 160 }}><Text style={s.muted}>Received by (name, signature, stamp, date)</Text><Text style={{ marginTop: 28, borderTopWidth: 0.5, borderTopColor: GREY, paddingTop: 3 }}>{dn.received_by_name ?? " "}</Text></View>
        </View>
        <View style={s.footer} fixed>
          <Text>{dn.doc_no} · {company.legal_name}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderDeliveryNotePdf(data: DeliveryNotePdfData): Promise<Buffer> {
  return renderToBuffer(<DeliveryNoteDoc {...data} />);
}
