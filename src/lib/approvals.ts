import { createHash } from "node:crypto";

import { verifyPassword } from "better-auth/crypto";

import type { Client, Transaction } from "@libsql/client";

import type { Database } from "@/db/client";
import { buildAuditStatement, recordAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth/session";
import { DomainError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { can } from "@/lib/permissions";
import { PIN_RATE_LIMIT, createRateLimiter } from "@/lib/rate-limit";

/**
 * Second-user approvals (spec §FR-POS-9 style manager overrides).
 *
 * Some actions need a *different* privileged user to sign off — a threshold
 * stock adjustment, an over-limit discount, a short-shelf-life receipt. The
 * approver (owner/manager) enters their own email + PIN in the dialog; the
 * server verifies role, PIN (same `rate_limits` budget as the step-up flow)
 * and that approver ≠ requester, then issues a short-lived, single-use token
 * bound to the action class and a hash of the exact payload it approves.
 *
 * The token is consumed inside the approved mutation's own write transaction
 * via a conditional UPDATE — `used_at` can only be set once, so a token can
 * never be replayed, and the consumption commits atomically with the action.
 * Grant and use are both written to `audit_log`.
 */

export const APPROVAL_TTL_MS = 5 * 60_000;

export type ApprovalAction =
  "adjustment.threshold" | "receiving.shelf_life" | "sale.discount_over_limit";

/** Canonical JSON (sorted keys, recursively) → sha256 hex. Binds a token to one payload. */
export function hashApprovalPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export interface GrantApprovalInput {
  approverEmail: string;
  pin: string;
  requester: SessionUser;
  action: ApprovalAction;
  /** The exact domain payload the token will approve (hashed canonically). */
  payload: unknown;
  reason?: string;
}

/**
 * Verifies the approver and issues a token. Runs outside the approved
 * mutation's transaction — the token row is the audit trail of who approved.
 */
export async function grantApproval(
  handle: { client: Client; db: Database },
  input: GrantApprovalInput,
): Promise<{ token: string }> {
  const email = input.approverEmail.trim().toLowerCase();
  if (email.length === 0) throw new DomainError("BAD_INPUT", "Approver email is required.");
  if (!/^\d{4,6}$/.test(input.pin)) {
    throw new DomainError("BAD_INPUT", "PIN must be 4–6 digits.");
  }

  const users = await handle.client.execute({
    sql: "select id, name, role, pin_hash, active from users where lower(email) = ?",
    args: [email],
  });
  if (users.rows.length === 0) {
    throw new DomainError("BAD_APPROVER", "No such approver.");
  }
  const approver = users.rows[0];
  if (Number(approver.active) !== 1) {
    throw new DomainError("BAD_APPROVER", "That account is deactivated.");
  }
  if (!can(approver.role as SessionUser["role"], "approval.grant")) {
    throw new DomainError("BAD_APPROVER", "Only owners and managers can approve this.");
  }
  if (String(approver.id) === input.requester.id) {
    throw new DomainError("SELF_APPROVAL", "You cannot approve your own action.");
  }

  const approverId = String(approver.id);
  const limiter = createRateLimiter(handle.db);
  const key = `pin:${approverId}`;
  const status = await limiter.check(key, PIN_RATE_LIMIT);
  if (!status.allowed) {
    throw new DomainError(
      "RATE_LIMITED",
      `Too many incorrect PINs. Try again in ${Math.max(1, Math.ceil(status.retryAfterMs / 60_000))} minute(s).`,
    );
  }

  const hash = approver.pin_hash === null ? null : String(approver.pin_hash);
  const valid = hash !== null && (await verifyPassword({ hash, password: input.pin }));
  if (!valid) {
    const after = await limiter.registerFailure(key, PIN_RATE_LIMIT);
    if (!after.allowed) {
      throw new DomainError("RATE_LIMITED", "Too many incorrect PINs — try again later.");
    }
    throw new DomainError("BAD_PIN", "Incorrect PIN.");
  }
  await limiter.reset(key);

  const token = newId();
  const now = Date.now();
  await handle.client.execute({
    sql: `insert into approval_tokens
          (id, approver_id, requester_id, action, payload_hash, reason, expires_at, created_at)
          values (?,?,?,?,?,?,?,?)`,
    args: [
      token,
      approverId,
      input.requester.id,
      input.action,
      hashApprovalPayload(input.payload),
      input.reason?.trim() || null,
      now + APPROVAL_TTL_MS,
      now,
    ],
  });

  await recordAudit(
    {
      userId: input.requester.id,
      action: "approval.granted",
      entity: "approval_tokens",
      entityId: token,
      after: {
        approverId,
        approverName: String(approver.name),
        requesterId: input.requester.id,
        action: input.action,
        reason: input.reason?.trim() || null,
      },
    },
    handle.db,
  );

  return { token };
}

/**
 * Consumes a token inside the approved mutation's write transaction.
 * The conditional UPDATE enforces single-use atomically: expiry, binding and
 * prior use are all checked in the same statement that marks it used.
 * Returns the approver's user id for the mutation's own audit snapshot.
 */
export async function consumeApproval(
  tx: Transaction,
  params: {
    tokenId: string;
    requesterId: string;
    action: ApprovalAction;
    payload: unknown;
    requireReason?: boolean;
  },
): Promise<{ approverId: string }> {
  const now = Date.now();
  const token = await tx.execute({
    sql: "select approver_id, reason from approval_tokens where id = ?",
    args: [params.tokenId],
  });
  if (token.rows.length > 0 && params.requireReason) {
    const reason = token.rows[0].reason;
    if (reason === null || String(reason).trim() === "") {
      throw new DomainError("BAD_APPROVAL", "This action requires an approval reason.");
    }
  }
  const updated = await tx.execute({
    sql: `update approval_tokens set used_at = ?
          where id = ? and requester_id = ? and action = ? and payload_hash = ?
            and used_at is null and expires_at > ?`,
    args: [
      now,
      params.tokenId,
      params.requesterId,
      params.action,
      hashApprovalPayload(params.payload),
      now,
    ],
  });
  if (updated.rowsAffected !== 1) {
    throw new DomainError(
      "BAD_APPROVAL",
      "Approval is missing, expired, already used, or does not match this request.",
    );
  }
  return { approverId: String(token.rows[0]?.approver_id ?? "") };
}

/** Audit statement recording the consumption, for the mutation's own tx. */
export async function approvalConsumedAudit(params: {
  requesterId: string;
  approverId: string;
  action: ApprovalAction;
  entity: string;
  entityId: string;
}) {
  return buildAuditStatement({
    userId: params.requesterId,
    action: "approval.consumed",
    entity: params.entity,
    entityId: params.entityId,
    after: { approverId: params.approverId, approvedAction: params.action },
  });
}
