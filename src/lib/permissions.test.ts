import { describe, expect, it } from "vitest";

import { CAPABILITIES, can, requireCapability, type Capability } from "@/lib/permissions";
import type { SessionUser } from "@/lib/auth/session";
import type { Role } from "@/lib/roles";

const user = (role: Role): SessionUser => ({
  id: `u-${role}`,
  name: role,
  email: `${role}@store.test`,
  role,
  branchId: "br-1",
});

const ROLES: Role[] = ["owner", "manager", "pharmacist", "cashier", "auditor"];

/**
 * The M1 permission matrix from the brief — the table in `CAPABILITIES` and
 * this expectation must never drift apart.
 */
const EXPECTED: Record<Capability, Role[]> = {
  "catalog.view": ["owner", "manager", "pharmacist", "cashier", "auditor"],
  "catalog.manage": ["owner", "manager"],
  "price.manage": ["owner", "manager"],
  "inventory.view": ["owner", "manager", "pharmacist", "auditor"],
  "inventory.receive": ["owner", "manager", "pharmacist"],
  "inventory.adjust": ["owner", "manager", "pharmacist"],
  "catalog.import": ["owner", "manager"],
  "audit.view": ["owner", "auditor"],
};

describe("capability matrix", () => {
  it("matches the brief exactly", () => {
    for (const capability of Object.keys(EXPECTED) as Capability[]) {
      expect([...CAPABILITIES[capability]].sort()).toEqual([...EXPECTED[capability]].sort());
    }
  });

  it.each(Object.entries(EXPECTED) as [Capability, Role[]][])(
    "%s is held by exactly the listed roles",
    (capability, allowed) => {
      for (const role of ROLES) {
        expect(can(role, capability), `${role} ${capability}`).toBe(allowed.includes(role));
      }
    },
  );
});

describe("requireCapability", () => {
  it("passes for allowed roles and throws for the rest", () => {
    expect(() => requireCapability(user("pharmacist"), "inventory.adjust")).not.toThrow();
    expect(() => requireCapability(user("cashier"), "inventory.adjust")).toThrow(/permission/i);
    expect(() => requireCapability(user("auditor"), "catalog.import")).toThrow(/permission/i);
    expect(() => requireCapability(user("manager"), "price.manage")).not.toThrow();
  });
});
