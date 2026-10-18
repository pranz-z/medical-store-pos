import { describe, expect, it } from "vitest";

import { ROLES, ROLE_LABELS, isRole } from "@/lib/roles";

describe("roles", () => {
  it("accepts exactly the five spec roles", () => {
    expect(ROLES).toEqual(["owner", "manager", "pharmacist", "cashier", "auditor"]);
    for (const role of ROLES) {
      expect(isRole(role)).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const value of ["admin", "OWNER", "", " Owner", null, undefined, 3, {}, ["owner"]]) {
      expect(isRole(value)).toBe(false);
    }
  });

  it("labels every role", () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });
});
