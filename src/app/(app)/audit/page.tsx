import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDatabase } from "@/db/client";
import { requireUser } from "@/lib/authz";
import { can } from "@/lib/permissions";

export const metadata: Metadata = {
  title: "Audit log",
};

interface AuditRow {
  id: string;
  at: number;
  userName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: string | null;
  after: string | null;
  requestId: string | null;
}

/** Append-only audit trail, restricted to owner + auditor (spec §9). */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  const user = await requireUser();

  if (!can(user.role, "audit.view")) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Restricted</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          The audit log is only visible to owners and auditors.
        </CardContent>
      </Card>
    );
  }

  const { entity } = await searchParams;
  const conditions: string[] = [];
  const args: string[] = [];
  if (entity && /^[a-z_]{1,40}$/.test(entity)) {
    conditions.push("a.entity = ?");
    args.push(entity);
  }

  const response = await getDatabase().client.execute({
    sql: `select a.id, a.at, u.name as user_name, a.action, a.entity, a.entity_id,
                 a.before, a.after, a.request_id
          from audit_log a left join users u on u.id = a.user_id
          ${conditions.length > 0 ? `where ${conditions.join(" and ")}` : ""}
          order by a.at desc limit 300`,
    args,
  });

  const rows: AuditRow[] = response.rows.map((row) => ({
    id: String(row.id),
    at: Number(row.at),
    userName: row.user_name === null ? null : String(row.user_name),
    action: String(row.action),
    entity: String(row.entity),
    entityId: row.entity_id === null ? null : String(row.entity_id),
    before: row.before === null ? null : String(row.before),
    after: row.after === null ? null : String(row.after),
    requestId: row.request_id === null ? null : String(row.request_id),
  }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="text-muted-foreground text-sm">
          Append-only record of privileged actions with before/after snapshots.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">User</th>
                  <th className="py-2 pr-3 font-medium">Action</th>
                  <th className="py-2 pr-3 font-medium">Entity</th>
                  <th className="py-2 font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      {new Date(row.at).toLocaleString("en-PH", {
                        timeZone: "Asia/Manila",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="py-2 pr-3 text-xs">{row.userName ?? "system"}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline">{row.action}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {row.entity}
                      {row.entityId ? (
                        <div className="text-muted-foreground font-mono">
                          {row.entityId.slice(0, 8)}…
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-col gap-1 text-xs">
                        {row.before ? (
                          <code className="text-muted-foreground block max-w-md truncate">
                            − {row.before}
                          </code>
                        ) : null}
                        {row.after ? (
                          <code className="block max-w-md truncate">+ {row.after}</code>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-muted-foreground py-8 text-center">
                      No audit entries yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
