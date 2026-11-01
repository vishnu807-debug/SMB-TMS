/** Sidebar structure. `permission`: any one of these grants the menu item. `ready: false` = later phase. */
export type NavItem = { label: string; href: string; icon: string; permission: string[]; ready: boolean };
export type NavGroup = { label: string; items: NavItem[] };

export const NAVIGATION: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard", permission: ["dashboard.sales", "dashboard.management"], ready: true }],
  },
  {
    label: "Sales",
    items: [
      { label: "Customers", href: "/customers", icon: "Building2", permission: ["customer.view"], ready: true },
      { label: "Leads & Enquiries", href: "/leads", icon: "Target", permission: ["lead.view"], ready: true },
      { label: "Follow-ups", href: "/follow-ups", icon: "CalendarClock", permission: ["activity.manage", "activity.view_all"], ready: true },
      { label: "Quotations", href: "/quotations", icon: "FileText", permission: ["quotation.view"], ready: true },
      { label: "Sales Orders", href: "/sales-orders", icon: "ShoppingCart", permission: ["sales_order.view"], ready: true },
    ],
  },
  {
    label: "Products & Stock",
    items: [
      { label: "Products", href: "/products", icon: "Package", permission: ["product.view"], ready: true },
      { label: "Categories", href: "/products/categories", icon: "FolderTree", permission: ["product.view"], ready: true },
      { label: "Stock Overview", href: "/inventory", icon: "Warehouse", permission: ["inventory.view", "product.view"], ready: true },
      { label: "Goods Received", href: "/inventory/receipts", icon: "PackagePlus", permission: ["inventory.view"], ready: true },
      { label: "Goods Issued", href: "/inventory/issues", icon: "PackageMinus", permission: ["inventory.view"], ready: true },
      { label: "Transfers", href: "/inventory/transfers", icon: "ArrowLeftRight", permission: ["inventory.view"], ready: true },
      { label: "Adjustments", href: "/inventory/adjustments", icon: "ClipboardCheck", permission: ["inventory.view"], ready: true },
      { label: "Reservations", href: "/inventory/reservations", icon: "Lock", permission: ["inventory.view"], ready: true },
      { label: "Movement History", href: "/inventory/movements", icon: "History", permission: ["inventory.view"], ready: true },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Procurement", href: "/procurement", icon: "ClipboardList", permission: ["purchase_requisition.manage"], ready: false },
      { label: "Purchase Orders", href: "/purchase-orders", icon: "Truck", permission: ["purchase_order.view"], ready: false },
      { label: "Logistics", href: "/logistics", icon: "Route", permission: ["delivery.view"], ready: false },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Invoices", href: "/invoices", icon: "Receipt", permission: ["invoice.view"], ready: false },
      { label: "Payments", href: "/payments", icon: "Wallet", permission: ["payment.view"], ready: false },
      { label: "Expenses", href: "/expenses", icon: "CreditCard", permission: ["expense.submit"], ready: false },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Approvals", href: "/approvals", icon: "BadgeCheck", permission: ["approval.view", "quotation.approve", "sales_order.approve", "inventory.approve_adjustment"], ready: true },
      { label: "Reports", href: "/reports", icon: "BarChart3", permission: ["report.sales", "report.inventory"], ready: false },
      { label: "Warehouses", href: "/settings/warehouses", icon: "MapPin", permission: ["warehouse.manage", "inventory.view"], ready: true },
      { label: "User Management", href: "/users", icon: "Users", permission: ["user.view"], ready: false },
      { label: "System Settings", href: "/settings", icon: "Settings", permission: ["settings.manage"], ready: false },
    ],
  },
];
