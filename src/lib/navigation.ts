/**
 * Sidebar structure. `permission`: any one of these grants the menu item.
 * `modules`: the item only appears when one of these modules is switched on (none = core).
 */
export type NavItem = { label: string; href: string; icon: string; permission: string[]; ready: boolean; modules?: string[] };
export type NavGroup = { label: string; items: NavItem[] };

export const NAVIGATION: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard", permission: ["dashboard.sales", "dashboard.management"], ready: true, modules: ["sales"] }],
  },
  {
    label: "Sales",
    items: [
      { label: "Customers", href: "/customers", icon: "Building2", permission: ["customer.view"], ready: true, modules: ["sales", "finance"] },
      { label: "Leads & Enquiries", href: "/leads", icon: "Target", permission: ["lead.view"], ready: true, modules: ["sales"] },
      { label: "Follow-ups", href: "/follow-ups", icon: "CalendarClock", permission: ["activity.manage", "activity.view_all"], ready: true, modules: ["sales"] },
      { label: "Quotations", href: "/quotations", icon: "FileText", permission: ["quotation.view"], ready: true, modules: ["sales"] },
      { label: "Sales Orders", href: "/sales-orders", icon: "ShoppingCart", permission: ["sales_order.view"], ready: true, modules: ["sales"] },
    ],
  },
  {
    label: "Products & Stock",
    items: [
      { label: "Products", href: "/products", icon: "Package", permission: ["product.view"], ready: true },
      { label: "Categories", href: "/products/categories", icon: "FolderTree", permission: ["product.view"], ready: true },
      { label: "Stock Overview", href: "/inventory", icon: "Warehouse", permission: ["inventory.view", "product.view"], ready: true, modules: ["inventory"] },
      { label: "Goods Received", href: "/inventory/receipts", icon: "PackagePlus", permission: ["inventory.view"], ready: true, modules: ["inventory", "procurement"] },
      { label: "Goods Issued", href: "/inventory/issues", icon: "PackageMinus", permission: ["inventory.view"], ready: true, modules: ["inventory"] },
      { label: "Transfers", href: "/inventory/transfers", icon: "ArrowLeftRight", permission: ["inventory.view"], ready: true, modules: ["inventory"] },
      { label: "Adjustments", href: "/inventory/adjustments", icon: "ClipboardCheck", permission: ["inventory.view"], ready: true, modules: ["inventory"] },
      { label: "Reservations", href: "/inventory/reservations", icon: "Lock", permission: ["inventory.view"], ready: true, modules: ["inventory"] },
      { label: "Movement History", href: "/inventory/movements", icon: "History", permission: ["inventory.view"], ready: true, modules: ["inventory"] },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Procurement", href: "/procurement", icon: "ClipboardList", permission: ["purchase_requisition.manage"], ready: true, modules: ["procurement"] },
      { label: "Purchase Orders", href: "/purchase-orders", icon: "Truck", permission: ["purchase_order.view"], ready: true, modules: ["procurement"] },
      { label: "Suppliers", href: "/suppliers", icon: "Factory", permission: ["supplier.view"], ready: true, modules: ["procurement", "finance"] },
      { label: "Logistics", href: "/logistics", icon: "Route", permission: ["delivery.view"], ready: true, modules: ["logistics"] },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Invoices", href: "/invoices", icon: "Receipt", permission: ["invoice.view"], ready: true, modules: ["finance"] },
      { label: "Customer Receipts", href: "/payments", icon: "Wallet", permission: ["payment.view"], ready: true, modules: ["finance"] },
      { label: "Payables", href: "/payables", icon: "Landmark", permission: ["payable.view"], ready: true, modules: ["finance"] },
      { label: "Expenses", href: "/expenses", icon: "CreditCard", permission: ["expense.submit", "expense.view_all", "expense.approve"], ready: true, modules: ["finance"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Approvals", href: "/approvals", icon: "BadgeCheck", permission: ["approval.view", "quotation.approve", "sales_order.approve", "inventory.approve_adjustment", "purchase_order.approve", "payable.approve", "expense.approve"], ready: true },
      { label: "Reports", href: "/reports", icon: "BarChart3", permission: ["report.sales", "report.inventory"], ready: false },
      { label: "Warehouses", href: "/settings/warehouses", icon: "MapPin", permission: ["warehouse.manage", "inventory.view"], ready: true, modules: ["inventory", "procurement", "logistics"] },
      { label: "User Management", href: "/users", icon: "Users", permission: ["user.view"], ready: true },
      { label: "Roles & Permissions", href: "/users/roles", icon: "ShieldCheck", permission: ["role.manage"], ready: true },
      { label: "Audit Log", href: "/audit", icon: "ScrollText", permission: ["audit.view"], ready: true },
      { label: "System Settings", href: "/settings", icon: "Settings", permission: ["settings.manage", "payable.approve"], ready: true },
    ],
  },
];

/** URL prefixes that belong to a module (longest prefix wins). Pages not listed are core. */
export const ROUTE_MODULES: [string, string[]][] = [
  ["/dashboard", ["sales"]],
  ["/customers", ["sales", "finance"]], ["/leads", ["sales"]], ["/follow-ups", ["sales"]], ["/quotations", ["sales"]], ["/sales-orders", ["sales"]],
  ["/inventory/receipts", ["inventory", "procurement"]], ["/inventory", ["inventory"]],
  ["/settings/warehouses", ["inventory", "procurement", "logistics"]],
  ["/procurement", ["procurement"]], ["/purchase-orders", ["procurement"]], ["/suppliers", ["procurement", "finance"]],
  ["/logistics", ["logistics"]],
  ["/invoices", ["finance"]], ["/payments", ["finance"]], ["/payables", ["finance"]], ["/expenses", ["finance"]],
];

export function modulesForPath(path: string): string[] | null {
  const hit = ROUTE_MODULES.filter(([p]) => path === p || path.startsWith(p + "/")).sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : null;
}

/** Menu entries the user may see: permitted and in a switched-on module. */
export function visibleNavigation(permissions: Set<string>, modules: Set<string>): NavGroup[] {
  return NAVIGATION.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.permission.some((p) => permissions.has(p)) && (!i.modules || i.modules.some((m) => modules.has(m)))),
  })).filter((g) => g.items.length > 0);
}

/** Extra menu for the software vendor's support account. */
export const VENDOR_NAVIGATION: NavGroup = {
  label: "System provider",
  items: [{ label: "Vendor console", href: "/vendor", icon: "KeyRound", permission: [], ready: true }],
};

/** The full menu for a user, including the vendor console when it applies. */
export function navigationFor(user: { permissions: Set<string>; modules: Set<string>; isPlatformAdmin: boolean }): NavGroup[] {
  const groups = visibleNavigation(user.permissions, user.modules);
  return user.isPlatformAdmin ? [VENDOR_NAVIGATION, ...groups] : groups;
}
