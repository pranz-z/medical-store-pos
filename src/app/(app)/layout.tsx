import Link from "next/link";

import { AppNav, type NavItem } from "@/components/app-shell/app-nav";
import { UserMenu } from "@/components/app-shell/user-menu";
import { requireUser } from "@/lib/authz";
import { ROLE_LABELS, type Role } from "@/lib/roles";

/**
 * Application shell for every signed-in page (spec §6 IA).
 *
 * Auth gating lives here (server-side `requireUser`), not in the proxy: pages
 * inside `(app)` can assume a session exists. Role-restricted entries are
 * filtered out of the nav — the pages themselves still re-check, since nav
 * visibility is presentation, not access control.
 */
const NAV_ITEMS: (NavItem & { roles?: Role[] })[] = [
  { href: "/", label: "Dashboard" },
  { href: "/users", label: "Users", roles: ["owner"] },
];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const items = NAV_ITEMS.filter(
    (item) => item.roles === undefined || item.roles.includes(user.role),
  );

  return (
    <div className="bg-muted/30 flex min-h-screen flex-col">
      <header className="bg-background sticky top-0 z-10 border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
          <Link href="/" className="font-semibold tracking-tight">
            Medical Store POS
          </Link>
          <AppNav items={items} />
          <div className="ml-auto">
            <UserMenu name={user.name} email={user.email} roleLabel={ROLE_LABELS[user.role]} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
