import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user?.permissions.has("dashboard.sales") ? "/dashboard" : "/inventory");
}
