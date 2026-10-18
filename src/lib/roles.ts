/**
 * User roles (spec §5.1). Kept dependency-free so both server and client code
 * (navigation filtering, guards) can import it.
 */
export const ROLES = ["owner", "manager", "pharmacist", "cashier", "auditor"] as const;

export type Role = (typeof ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set(ROLES);

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLE_SET.has(value);
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  pharmacist: "Pharmacist",
  cashier: "Cashier",
  auditor: "Auditor",
};
