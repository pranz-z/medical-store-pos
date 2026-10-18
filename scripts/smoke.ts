import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import { runSchemaChecks } from "../src/db/verify";
import { newId } from "../src/lib/ids";
import { loadScriptEnv } from "./load-env";

loadScriptEnv();

/**
 * Remote smoke test: applies the migrations to a throwaway Turso database (or
 * branch) and re-runs the FK / append-only trigger / CHECK / FTS5 checks over
 * the remote connection with `src/db/verify.ts`.
 *
 * Requirements:
 *   - TURSO_DATABASE_URL points at a remote, THROWAWAY database (libsql://...).
 *     Local `file:` URLs are rejected — use the integration tests for those.
 *   - TURSO_AUTH_TOKEN is set.
 *   - Pass `--yes` to confirm the target is disposable.
 *
 * The probe intentionally leaves its `chk_*` fixtures behind (append-only
 * tables cannot be cleaned); delete/deprovision the branch afterwards.
 */
async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  const confirmed = process.argv.includes("--yes");

  if (!url || url.startsWith("file:")) {
    console.error("db:smoke needs TURSO_DATABASE_URL pointing at a remote throwaway database.");
    process.exitCode = 1;
    return;
  }
  if (!authToken) {
    console.error("db:smoke needs TURSO_AUTH_TOKEN for the remote database.");
    process.exitCode = 1;
    return;
  }
  if (!confirmed) {
    console.error(
      "db:smoke writes throwaway fixtures and will not delete them.\n" +
        "Re-run with `npm run db:smoke -- --yes` once the target is a disposable database.",
    );
    process.exitCode = 1;
    return;
  }

  const client = createClient({ url, authToken });
  const db = drizzle(client);

  try {
    console.log(`Applying migrations to ${url} ...`);
    await migrate(db, { migrationsFolder: "./drizzle" });

    console.log("Running schema checks over the remote connection ...\n");
    const results = await runSchemaChecks(client, { runId: newId() });

    let failed = 0;
    for (const result of results) {
      if (!result.ok) {
        failed += 1;
      }
      const mark = result.ok ? "PASS" : "FAIL";
      console.log(
        `${mark}  ${result.name}${result.detail && !result.ok ? ` :: ${result.detail}` : ""}`,
      );
    }

    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    if (failed > 0) {
      process.exitCode = 1;
    } else {
      console.log("Remote schema smoke test passed. Remember to remove the throwaway database.");
    }
  } finally {
    client.close();
  }
}

main().catch((error: unknown) => {
  console.error("Smoke test failed:", error);
  process.exitCode = 1;
});
