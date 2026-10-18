/**
 * Expected business-rule failures (validation passed but the operation is
 * rejected: insufficient stock, duplicate SKU, expired batch, ...).
 *
 * Server actions catch `DomainError` and surface `message` to the user;
 * anything else is a real bug and propagates to the error boundary.
 */
export class DomainError extends Error {
  constructor(
    /** Stable machine code, e.g. `INSUFFICIENT_STOCK`. */
    readonly code: string,
    message: string,
    /** Optional structured payload (e.g. fresh availability on STOCK_CHANGED). */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
