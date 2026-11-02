import Link from "next/link";
import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PendingProductReview, type PendingItem } from "./review";

export const metadata: Metadata = { title: "New products from quotations" };

export default async function PendingProductsPage() {
  const user = await requirePermission("product.edit");
  const supabase = await createClient();
  const [{ data: items }, { data: categories }] = await Promise.all([
    supabase.from("v_pending_quote_products").select("*").order("confirmation_date", { ascending: true }).limit(50),
    supabase.from("v_product_categories").select("id, full_path, is_active").order("sort_path"),
  ]);
  const ids = (items ?? []).map((i) => i.id);
  const [{ data: docs }, matches] = await Promise.all([
    ids.length ? supabase.from("quotation_documents").select("id, quote_product_id, file_name, kind").in("quote_product_id", ids).not("storage_path", "is", null)
      : Promise.resolve({ data: [] as { id: string; quote_product_id: string; file_name: string; kind: string }[] }),
    Promise.all(ids.map((id) => supabase.rpc("find_product_matches", { p_quote_product_id: id }).then((r) => [id, r.data ?? []] as const))),
  ]);
  const byId = new Map(matches);
  const list: PendingItem[] = (items ?? []).map((i) => ({
    ...i,
    docs: (docs ?? []).filter((d) => d.quote_product_id === i.id).map((d) => ({ id: d.id, file_name: d.file_name })),
    matches: (byId.get(i.id) ?? []) as PendingItem["matches"],
  }));

  return (
    <>
      <PageHeader title="New products from quotations" back={{ href: "/products", label: "Products" }}
        description="Products quoted to customers that are not in the catalogue yet. Only items on quotations the customer has confirmed appear here. Add each one to the catalogue, or link it to a product you already have." />
      {list.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-slate-500">Nothing to review. New products appear here once the customer confirms the quotation. <Link href="/products" className="text-navy-700 hover:underline">Back to products</Link></CardContent></Card>
      ) : (
        <div className="space-y-6">
          {list.map((i) => <PendingProductReview key={i.id} item={i} canOpenQuotation={user.permissions.has("quotation.view")} categories={(categories ?? []).filter((c) => c.is_active)} />)}
        </div>
      )}
    </>
  );
}
