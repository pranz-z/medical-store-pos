"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestApprovalAction } from "@/lib/approval-actions";
import type { ApprovalAction } from "@/lib/approvals";

/**
 * Second-user approval dialog: a manager/owner signs off a specific action
 * with their email + PIN. The issued token is bound to `action` + `payload`
 * and consumed (single-use) by the replayed mutation.
 */
export function ApprovalDialog({
  open,
  onOpenChange,
  action,
  payload,
  reasonRequired = false,
  description,
  onApproved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: ApprovalAction;
  /** The exact payload the replayed mutation will submit (hashed server-side). */
  payload: unknown;
  reasonRequired?: boolean;
  description?: string;
  onApproved: (token: string) => void | Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close(nextOpen: boolean) {
    if (!nextOpen) {
      setEmail("");
      setPin("");
      setReason("");
      setError(null);
    }
    onOpenChange(nextOpen);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await requestApprovalAction({
        approverEmail: email,
        pin,
        action,
        payload,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (result.status !== "ok") {
        setError(result.message);
        return;
      }
      close(false);
      await onApproved(result.token);
    });
  }

  const ready =
    email.includes("@") && /^\d{4,6}$/.test(pin) && (!reasonRequired || reason.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manager approval required</DialogTitle>
          <DialogDescription>
            {description ??
              "An owner or manager must approve this action with their account email and PIN."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="approval-email">Approver email</Label>
            <Input
              id="approval-email"
              type="email"
              autoComplete="off"
              placeholder="manager@store.test"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="approval-pin">Approver PIN</Label>
            <Input
              id="approval-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && ready) submit();
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="approval-reason">Reason{reasonRequired ? "" : " (optional)"}</Label>
            <Input
              id="approval-reason"
              placeholder={reasonRequired ? "Required for this override" : "Why is this needed?"}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !ready}>
            {pending ? "Verifying…" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
