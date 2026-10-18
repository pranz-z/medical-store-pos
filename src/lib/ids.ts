import { monotonicFactory } from "ulid";

const ulid = monotonicFactory();

/**
 * Generates a monotonic ULID, used for every primary key (spec §5 conventions).
 * Monotonic means IDs created in the same millisecond still sort in creation order.
 */
export function newId(): string {
  return ulid();
}
