import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Temp-database helpers for integration tests.
 *
 * `cleanupTempDirectory` is best-effort: on Windows the libSQL file can stay
 * mapped for a moment after `client.close()`, and a failed cleanup must never
 * fail an otherwise passing test run.
 */
export function createTempDatabasePath(prefix: string): { directory: string; url: string } {
  const directory = mkdtempSync(join(tmpdir(), `${prefix}-`));
  return { directory, url: `file:${join(directory, "test.db")}` };
}

export function cleanupTempDirectory(directory: string): void {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Leftover files under the OS temp directory are harmless.
  }
}
