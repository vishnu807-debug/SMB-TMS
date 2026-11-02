import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { navigationFor } from "@/lib/navigation";

/** Start page: the first menu entry this user can open in the enabled modules. */
export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // The vendor console comes first in the vendor's menu; only start there when nothing else is available.
  const own = navigationFor({ ...user, isPlatformAdmin: false })[0]?.items[0]?.href;
  const first = own ?? (user.isPlatformAdmin ? "/vendor" : undefined);
  redirect(first ?? "/profile");
}
