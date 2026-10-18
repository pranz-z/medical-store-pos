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
import { verifyPinAction } from "@/lib/step-up-actions";

/**
 * Shared PIN step-up dialog. Feature pages keep their pending action and call
 * `onVerified` after the PIN check succeeds so the exact same action is
 * replayed (same replay pattern as the Users page).
 */
export function StepUpDialog({
  open,
  onOpenChange,
  onVerified,
  description = "Privileged changes require your 4–6 digit PIN. The confirmation lasts 10 minutes.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onVerified: () => void | Promise<void>;
  description?: string;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close(nextOpen: boolean) {
    if (!nextOpen) {
      setPin("");
      setError(null);
    }
    onOpenChange(nextOpen);
  }

  function submit() {
    startTransition(async () => {
      const result = await verifyPinAction({ pin });
      if (result.status !== "ok") {
        setError(result.message);
        return;
      }
      setPin("");
      setError(null);
      onOpenChange(false);
      await onVerified();
    });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm with your PIN</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="step-up-pin">PIN</Label>
          <Input
            id="step-up-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || pin.length < 4}>
            {pending ? "Verifying…" : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
