import Link from "next/link";

import { AppNav, type NavItem } from "@/components/app-shell/app-nav";
import { UserMenu } from "@/components/app-shell/user-menu";
import { QueryProvider } from "@/components/query-provider";
import { requireUser } from "@/lib/authz";
import { can, type Capability } from "@/lib/permissions";
import { ROLE_LABELS, type Role } from "@/lib/roles";

/**
 * Application shell for every signed-in page (spec §6 IA).
 *
 * Auth gating lives here (server-side `requireUser`), not in the proxy: pages
 * inside `(app)` can assume a session exists. Role-restricted entries are
 * filtered out of the nav — the pages themselves still re-check, since nav
 * visibility is presentation, not access control.
 */
const NAV_ITEMS: (NavItem & { roles?: Role[]; capability?: Capability })[] = [
  { href: "/", label: "Dashboard" },
  { href: "/pos", label: "POS", capability: "pos.sell" },
  { href: "/sales", label: "Sales", capability: "sales.view" },
  { href: "/shifts", label: "Shifts", capability: "pos.sell" },
  { href: "/products", label: "Products", capability: "catalog.view" },
  { href: "/inventory", label: "Inventory", capability: "inventory.view" },
  { href: "/receiving", label: "Receiving", capability: "inventory.receive" },
  { href: "/adjustments", label: "Adjustments", capability: "inventory.adjust" },
  { href: "/audit", label: "Audit", capability: "audit.view" },
  { href: "/users", label: "Users", roles: ["owner"] },
];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const items = NAV_ITEMS.filter(
    (item) =>
      (item.roles === undefined || item.roles.includes(user.role)) &&
      (item.capability === undefined || can(user.role, item.capability)),
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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <QueryProvider>{children}</QueryProvider>
      </main>
    </div>
  );
}
