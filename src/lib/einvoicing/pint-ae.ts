import "server-only";

/**
 * Builds a UBL 2.1 Invoice / CreditNote following the Peppol PINT AE
 * (UAE) structure from the data returned by public.einvoice_document().
 *
 * The UAE e-invoicing model is a "5-corner" Peppol model: we send the document
 * to our FTA-accredited Service Provider (ASP), which validates it, delivers it
 * to the buyer's ASP and reports the tax data to the FTA. Field-level rules
 * (code lists, mandatory UAE extensions) are validated by the ASP; anything it
 * rejects comes back as a "rejected" status with its message on the invoice.
 */
export type EInvoiceDocument = {
  invoice: Record<string, any>;
  original_invoice: { doc_no: string; invoice_date: string; einvoice_uuid: string } | null;
  seller: Record<string, any>;
  buyer: Record<string, any>;
  payment_terms: string | null;
  lines: Record<string, any>[];
};

const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const amt = (v: unknown) => Number(v ?? 0).toFixed(2);
const qty = (v: unknown) => Number(v ?? 0).toFixed(3);
// UNCL5305 tax category: S standard, Z zero-rated, E exempt, O out of scope.
const CAT: Record<string, string> = { SR: "S", ZR: "Z", EX: "E", OS: "O" };
const COUNTRY = (c?: string) => (!c || /emirates|uae/i.test(c) ? "AE" : c.length === 2 ? c.toUpperCase() : "AE");

function party(p: Record<string, any>, tag: "AccountingSupplierParty" | "AccountingCustomerParty") {
  const endpoint = p.participant_id ? `<cbc:EndpointID schemeID="${esc(String(p.participant_id).split(":")[0])}">${esc(String(p.participant_id).split(":").pop())}</cbc:EndpointID>`
    : p.trn ? `<cbc:EndpointID schemeID="0235">${esc(p.trn)}</cbc:EndpointID>` : "";
  return `<cac:${tag}><cac:Party>${endpoint}
      <cac:PostalAddress><cbc:StreetName>${esc(p.address)}</cbc:StreetName><cbc:CityName>${esc(p.city ?? "")}</cbc:CityName>
        <cac:Country><cbc:IdentificationCode>${COUNTRY(p.country)}</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
      ${p.trn ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(p.trn)}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ""}
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.legal_name ?? p.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
      ${p.email || p.phone ? `<cac:Contact>${p.phone ? `<cbc:Telephone>${esc(p.phone)}</cbc:Telephone>` : ""}${p.email ? `<cbc:ElectronicMail>${esc(p.email)}</cbc:ElectronicMail>` : ""}</cac:Contact>` : ""}
    </cac:Party></cac:${tag}>`;
}

export function buildPintAe(doc: EInvoiceDocument): string {
  const i = doc.invoice;
  const credit = i.kind === "credit_note";
  const root = credit ? "CreditNote" : "Invoice";
  const ns = credit ? "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2" : "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
  const ccy = i.currency_code;
  // VAT breakdown per category and rate.
  const groups = new Map<string, { cat: string; rate: number; net: number; tax: number }>();
  for (const l of doc.lines) {
    const k = `${l.tax_category}|${l.tax_rate}`;
    const g = groups.get(k) ?? { cat: CAT[l.tax_category] ?? "S", rate: Number(l.tax_rate), net: 0, tax: 0 };
    g.net += Number(l.net); g.tax += Number(l.tax); groups.set(k, g);
  }
  const lineTag = credit ? "CreditNoteLine" : "InvoiceLine";
  const qtyTag = credit ? "CreditedQuantity" : "InvoicedQuantity";
  const lines = doc.lines.map((l) => `
  <cac:${lineTag}>
    <cbc:ID>${l.line_no}</cbc:ID>
    <cbc:${qtyTag} unitCode="${esc(unitCode(l.uom))}">${qty(l.qty)}</cbc:${qtyTag}>
    <cbc:LineExtensionAmount currencyID="${ccy}">${amt(l.net)}</cbc:LineExtensionAmount>
    ${Number(l.discount) > 0 ? `<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount currencyID="${ccy}">${amt(l.discount)}</cbc:Amount><cbc:BaseAmount currencyID="${ccy}">${amt(l.gross)}</cbc:BaseAmount></cac:AllowanceCharge>` : ""}
    <cac:Item><cbc:Name>${esc(String(l.description).slice(0, 250))}</cbc:Name>${l.sku ? `<cac:SellersItemIdentification><cbc:ID>${esc(l.sku)}</cbc:ID></cac:SellersItemIdentification>` : ""}
      <cac:ClassifiedTaxCategory><cbc:ID>${CAT[l.tax_category] ?? "S"}</cbc:ID><cbc:Percent>${Number(l.tax_rate).toFixed(2)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="${ccy}">${Number(l.unit_price).toFixed(4)}</cbc:PriceAmount></cac:Price>
  </cac:${lineTag}>`).join("");
  const taxAed = (Number(i.tax_total) * Number(i.exchange_rate)).toFixed(2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="${ns}" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:peppol:pint:billing-1@ae-1</cbc:CustomizationID>
  <cbc:ProfileID>urn:peppol:bis:billing</cbc:ProfileID>
  <cbc:ID>${esc(i.doc_no)}</cbc:ID>
  <cbc:UUID>${esc(i.einvoice_uuid)}</cbc:UUID>
  <cbc:IssueDate>${esc(i.invoice_date)}</cbc:IssueDate>
  ${!credit && i.due_date ? `<cbc:DueDate>${esc(i.due_date)}</cbc:DueDate>` : ""}
  <cbc:${credit ? "CreditNoteTypeCode" : "InvoiceTypeCode"}>${credit ? "381" : "380"}</cbc:${credit ? "CreditNoteTypeCode" : "InvoiceTypeCode"}>
  ${i.notes || i.reason ? `<cbc:Note>${esc(i.reason ?? i.notes)}</cbc:Note>` : ""}
  ${i.supply_date ? `<cbc:TaxPointDate>${esc(i.supply_date)}</cbc:TaxPointDate>` : ""}
  <cbc:DocumentCurrencyCode>${ccy}</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>AED</cbc:TaxCurrencyCode>
  ${i.customer_reference && !credit ? `<cbc:BuyerReference>${esc(i.customer_reference)}</cbc:BuyerReference><cac:OrderReference><cbc:ID>${esc(i.customer_reference)}</cbc:ID></cac:OrderReference>` : ""}
  ${doc.original_invoice ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(doc.original_invoice.doc_no)}</cbc:ID><cbc:IssueDate>${esc(doc.original_invoice.invoice_date)}</cbc:IssueDate></cac:InvoiceDocumentReference></cac:BillingReference>` : ""}
  ${party(doc.seller, "AccountingSupplierParty")}
  ${party({ ...doc.buyer, address: doc.buyer.address }, "AccountingCustomerParty")}
  ${doc.payment_terms ? `<cac:PaymentTerms><cbc:Note>${esc(doc.payment_terms)}</cbc:Note></cac:PaymentTerms>` : ""}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${ccy}">${amt(i.tax_total)}</cbc:TaxAmount>
    ${[...groups.values()].map((g) => `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${ccy}">${amt(g.net)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${ccy}">${amt(g.tax)}</cbc:TaxAmount>
      <cac:TaxCategory><cbc:ID>${g.cat}</cbc:ID><cbc:Percent>${g.rate.toFixed(2)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`).join("")}
  </cac:TaxTotal>
  ${ccy !== "AED" ? `<cac:TaxTotal><cbc:TaxAmount currencyID="AED">${taxAed}</cbc:TaxAmount></cac:TaxTotal>` : ""}
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${ccy}">${amt(i.net_total)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${ccy}">${amt(i.net_total)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${ccy}">${amt(i.total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${ccy}">${amt(i.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lines}
</${root}>`;
}

// UN/ECE Rec 20 unit codes for the units seeded in the system.
function unitCode(u?: string) {
  const map: Record<string, string> = { PCS: "H87", EA: "EA", MTR: "MTR", M: "MTR", KG: "KGM", LTR: "LTR", L: "LTR", ROLL: "RO", BOX: "BX", SET: "SET", PKT: "PA", DRUM: "DR", HR: "HUR", DAY: "DAY", LOT: "LO" };
  return map[(u ?? "").toUpperCase()] ?? "C62";
}
