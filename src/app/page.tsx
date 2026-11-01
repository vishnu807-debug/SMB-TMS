import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { visibleNavigation } from "@/lib/navigation";

/** Start page: the first menu entry this user can open in the enabled modules. */
export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const first = visibleNavigation(user.permissions, user.modules)[0]?.items[0]?.href;
  redirect(first ?? "/profile");
}
