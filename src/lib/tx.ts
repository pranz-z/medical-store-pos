import type { Client, Transaction } from "@libsql/client";

/**
 * Runs `fn` inside an interactive `"write"` transaction (spec §4.3.1):
 * commits on success, rolls back on any throw, always closes. Keep the body
 * short — SQLite has a single writer, so long transactions block everything.
 *
 * SQLITE_BUSY (contending writer) is retried a few times with a small linear
 * backoff: the transaction bodies here are pure DB work with fresh IDs, so a
 * retry is always safe and lets the loser reach its own constraint checks
 * (e.g. the conditional UPDATE that produces a clean DomainError) instead of
 * surfacing a raw lock error.
 */
export async function withWriteTx<T>(
  client: Client,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const maxAttempts = 4;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const tx = await client.transaction("write");
      try {
        const result = await fn(tx);
        await tx.commit();
        return result;
      } catch (error) {
        try {
          await tx.rollback();
        } catch {
          // Transaction may already be closed after a commit/rollback race.
        }
        throw error;
      } finally {
        tx.close();
      }
    } catch (error) {
      if (!isBusyError(error) || attempt >= maxAttempts) throw error;
      await sleep(25 * attempt);
    }
  }
}

function isBusyError(error: unknown): boolean {
  return error instanceof Error && /SQLITE_BUSY|database is locked/i.test(error.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
