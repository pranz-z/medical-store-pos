"use client";

import { useState, useTransition } from "react";

import { StepUpDialog } from "@/components/step-up-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ROLE_LABELS, ROLES, type Role } from "@/lib/roles";

import { setUserActiveAction, updateUserRoleAction, type UserActionResult } from "./actions";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
}

/**
 * Owner-only user table.
 *
 * Privileged actions return `step-up-required` when the PIN window has
 * expired; the pending action is kept and replayed verbatim after the PIN
 * dialog verifies.
 */
export function UsersTable({ rows, currentUserId }: { rows: UserRow[]; currentUserId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [draftRoles, setDraftRoles] = useState<Record<string, Role>>({});
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [retryAction, setRetryAction] = useState<(() => Promise<UserActionResult>) | null>(null);

  function handleResult(result: UserActionResult, action: () => Promise<UserActionResult>) {
    if (result.status === "step-up-required") {
      setRetryAction(() => action);
      setStepUpOpen(true);
    } else if (result.status === "error") {
      setError(result.message);
    }
  }

  function run(action: () => Promise<UserActionResult>) {
    setError(null);
    startTransition(async () => {
      handleResult(await action(), action);
    });
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const isSelf = row.id === currentUserId;
              const draftRole = draftRoles[row.id] ?? row.role;
              return (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.name}
                    {isSelf ? (
                      <Badge variant="secondary" className="ml-2">
                        you
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.email}</TableCell>
                  <TableCell>
                    <select
                      aria-label={`Role for ${row.name}`}
                      className="border-input bg-background h-8 rounded-md border px-2 text-sm"
                      value={draftRole}
                      disabled={isSelf || pending}
                      onChange={(event) =>
                        setDraftRoles((previous) => ({
                          ...previous,
                          [row.id]: event.target.value as Role,
                        }))
                      }
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    {row.active ? (
                      <Badge>Active</Badge>
                    ) : (
                      <Badge variant="destructive">Deactivated</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isSelf || pending || draftRole === row.role}
                        onClick={() =>
                          run(() => updateUserRoleAction({ userId: row.id, role: draftRole }))
                        }
                      >
                        Save role
                      </Button>
                      <Button
                        size="sm"
                        variant={row.active ? "destructive" : "default"}
                        disabled={isSelf || pending}
                        onClick={() =>
                          run(() => setUserActiveAction({ userId: row.id, active: !row.active }))
                        }
                      >
                        {row.active ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      <StepUpDialog
        open={stepUpOpen}
        onOpenChange={(open) => {
          if (!open) setRetryAction(null);
          setStepUpOpen(open);
        }}
        onVerified={async () => {
          const action = retryAction;
          setRetryAction(null);
          if (action) {
            handleResult(await action(), action);
          }
        }}
      />
    </Card>
  );
}
