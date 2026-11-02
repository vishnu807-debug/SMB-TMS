"use server";
import { revalidatePath } from "next/cache";
import { runImport } from "@/lib/import/server";

export async function previewCustomerImport(rows: unknown) {
  return runImport("import_customers", rows, false);
}

export async function commitCustomerImport(rows: unknown, fileName: string, token: string) {
  const res = await runImport("import_customers", rows, { fileName, token });
  revalidatePath("/customers");
  return res;
}
