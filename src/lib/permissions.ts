import { ForbiddenError } from "@/lib/authz";
import type { SessionUser } from "@/lib/auth/session";
import type { Role } from "@/lib/roles";

/**
 * Capability map for M1 (spec §2 role table, M1 permission brief).
 *
 * Pages use `can()` to hide controls; every mutation calls
 * `requireCapability()` server-side — nav/UI hiding is convenience only.
 *
 * | Capability            | owner | manager | pharmacist | cashier | auditor |
 * | --------------------- | ----- | ------- | ---------- | ------- | ------- |
 * | catalog.view          |  x    |    x    |     x      |   x     |    x    |
 * | catalog.manage        |  x    |    x    |            |         |         |
 * | price.manage          |  x    |    x    |            |         |         |
 * | inventory.view        |  x    |    x    |     x      |         |    x    |
 * | inventory.receive     |  x    |    x    |     x      |         |         |
 * | inventory.adjust      |  x    |    x    |     x      |         |         |
 * | catalog.import        |  x    |    x    |            |         |         |
 * | audit.view            |  x    |         |            |         |    x    |
 */
export const CAPABILITIES = {
  "catalog.view": ["owner", "manager", "pharmacist", "cashier", "auditor"],
  "catalog.manage": ["owner", "manager"],
  "price.manage": ["owner", "manager"],
  "inventory.view": ["owner", "manager", "pharmacist", "auditor"],
  "inventory.receive": ["owner", "manager", "pharmacist"],
  "inventory.adjust": ["owner", "manager", "pharmacist"],
  "catalog.import": ["owner", "manager"],
  "audit.view": ["owner", "auditor"],
} as const satisfies Record<string, readonly Role[]>;

export type Capability = keyof typeof CAPABILITIES;

export function can(role: Role, capability: Capability): boolean {
  return (CAPABILITIES[capability] as readonly Role[]).includes(role);
}

/** Throws ForbiddenError unless the actor holds the capability. For mutations/tests. */
export function requireCapability(actor: SessionUser, capability: Capability): void {
  if (!can(actor.role, capability)) throw new ForbiddenError();
}
