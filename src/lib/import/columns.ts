/** Column definitions shared by the import screens, templates and error reports. */
export type ImportColumn = { key: string; header: string; required?: boolean; help: string; example: string; aliases?: string[] };
export type ImportEntity = "customers" | "leads";

export const CUSTOMER_COLUMNS: ImportColumn[] = [
  { key: "name", header: "Company name", required: true, help: "Legal or trading name. Must not already exist.", example: "Example Trading LLC", aliases: ["customer name", "customer", "name", "company"] },
  { key: "customer_type", header: "Customer type", help: "Company, Government or Individual (default Company).", example: "Company", aliases: ["type"] },
  { key: "trn", header: "TRN", help: "15-digit tax registration number. Format the column as Text in Excel.", example: "100123456700003", aliases: ["tax registration number", "vat number", "trn no"] },
  { key: "vat_registered", header: "VAT registered", help: "Yes or No. Defaults to Yes when a TRN is given.", example: "Yes", aliases: ["vat"] },
  { key: "trade_license_no", header: "Trade licence no.", help: "Optional.", example: "DED-123456", aliases: ["trade license no", "trade licence", "trade license", "license no", "licence no"] },
  { key: "industry", header: "Industry", help: "Optional.", example: "Construction" },
  { key: "email", header: "Email", help: "Company email. Used to detect duplicates.", example: "info@example.ae", aliases: ["company email", "email address"] },
  { key: "phone", header: "Phone", help: "Company phone. Used to detect duplicates. Format the column as Text.", example: "+971 4 123 4567", aliases: ["telephone", "tel", "phone number"] },
  { key: "website", header: "Website", help: "Optional.", example: "www.example.ae" },
  { key: "currency_code", header: "Currency", help: "3-letter code set up in the system (default AED).", example: "AED", aliases: ["currency code"] },
  { key: "payment_terms", header: "Payment terms", help: "Name as set up in the system (e.g. Net 30) or number of days.", example: "Net 30" },
  { key: "credit_limit", header: "Credit limit", help: "Only users allowed to set credit limits may fill this.", example: "" },
  { key: "account_manager_email", header: "Account manager email", help: "Sign-in email of the sales representative (default: you).", example: "", aliases: ["account manager", "sales rep email", "sales representative"] },
  { key: "source", header: "Source", help: "Where the customer came from (optional).", example: "Exhibition" },
  { key: "notes", header: "Notes", help: "Optional.", example: "" },
  { key: "contact_name", header: "Contact name", help: "Main contact person (optional).", example: "Ahmed Ali", aliases: ["contact", "contact person"] },
  { key: "contact_designation", header: "Contact designation", help: "Optional.", example: "Purchase Manager", aliases: ["designation", "contact title"] },
  { key: "contact_email", header: "Contact email", help: "Optional.", example: "ahmed@example.ae" },
  { key: "contact_phone", header: "Contact phone", help: "Optional.", example: "" },
  { key: "contact_mobile", header: "Contact mobile", help: "Optional.", example: "+971 50 123 4567", aliases: ["mobile"] },
  { key: "address_line1", header: "Address line 1", help: "Billing address. Needed with City if any address field is filled.", example: "Office 101, Example Tower", aliases: ["address", "address 1", "billing address"] },
  { key: "address_line2", header: "Address line 2", help: "Optional.", example: "", aliases: ["address 2"] },
  { key: "city", header: "City", help: "Needed with Address line 1.", example: "Dubai" },
  { key: "emirate", header: "Emirate", help: "Optional.", example: "Dubai", aliases: ["state", "region"] },
  { key: "country", header: "Country", help: "Default United Arab Emirates.", example: "United Arab Emirates" },
  { key: "po_box", header: "P.O. Box", help: "Optional.", example: "12345", aliases: ["po box", "pobox"] },
];

export const LEAD_COLUMNS: ImportColumn[] = [
  { key: "title", header: "Enquiry title", required: true, help: "What the customer is asking for (at least 3 characters).", example: "Supply of LED fittings for warehouse", aliases: ["title", "subject", "enquiry"] },
  { key: "customer_code", header: "Customer code", help: "Code of an existing customer (e.g. CUS-00012). Matched first.", example: "", aliases: ["customer id", "code"] },
  { key: "company_name", header: "Company name", help: "Matched to existing customers by name if no code is given; otherwise you choose what to do.", example: "Example Trading LLC", aliases: ["customer", "customer name", "company"] },
  { key: "contact_name", header: "Contact name", help: "Optional.", example: "Ahmed Ali", aliases: ["contact", "contact person"] },
  { key: "contact_email", header: "Contact email", help: "Optional. Also used to find the customer.", example: "ahmed@example.ae", aliases: ["email"] },
  { key: "contact_phone", header: "Contact phone", help: "Optional.", example: "+971 50 123 4567", aliases: ["phone", "mobile"] },
  { key: "source", header: "Source", help: "Phone, Email, Walk in, Website, Referral, Exhibition, Existing customer, Tender or Other.", example: "Email" },
  { key: "requirement", header: "Requirement", help: "Details of the enquiry (optional).", example: "200 x 40W LED high bay, IP65", aliases: ["details", "description"] },
  { key: "estimated_value", header: "Estimated value", help: "Number, optional.", example: "25000", aliases: ["value", "amount"] },
  { key: "currency_code", header: "Currency", help: "3-letter code (default AED).", example: "AED" },
  { key: "probability", header: "Probability %", help: "0 to 100 (default 20).", example: "40", aliases: ["probability"] },
  { key: "expected_close_date", header: "Expected close date", help: "A date, e.g. 2026-12-31 or 31/12/2026.", example: "2026-12-31", aliases: ["close date", "expected close"] },
  { key: "priority", header: "Priority", help: "Low, Medium or High (default Medium).", example: "Medium" },
  { key: "owner_email", header: "Owner email", help: "Sign-in email of the person responsible (default: you).", example: "", aliases: ["owner", "assigned to"] },
];

export const columnsFor = (entity: ImportEntity) => (entity === "customers" ? CUSTOMER_COLUMNS : LEAD_COLUMNS);
export const MAX_IMPORT_ROWS = 2000;
