import { asc } from "drizzle-orm";
import type { Metadata } from "next";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db/client";
import { users } from "@/db/schema/auth";
import { hasRole, requireUser } from "@/lib/authz";
import { isRole } from "@/lib/roles";

import { UsersTable, type UserRow } from "./users-table";

export const metadata: Metadata = {
  title: "Users",
};

export default async function UsersPage() {
  const currentUser = await requireUser();

  if (!hasRole(currentUser, "owner")) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Owners only</CardTitle>
          <CardDescription>
            Your role ({currentUser.role}) cannot manage users. Ask an owner for access.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const rows = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      active: users.active,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(asc(users.createdAt));

  const userRows: UserRow[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: isRole(row.role) ? row.role : "cashier",
    active: row.active,
    createdAt: row.createdAt.toISOString().slice(0, 10),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="text-muted-foreground text-sm">
          Owner-only. Role changes and deactivations require your PIN and are written to the audit
          log.
        </p>
      </div>
      <UsersTable rows={userRows} currentUserId={currentUser.id} />
    </div>
  );
}
