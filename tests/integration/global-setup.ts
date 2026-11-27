import { execSync } from "node:child_process";

/**
 * Brings the test database schema up to date before the integration run (non-destructive).
 * Tests isolate themselves with unique emails and keys, so no reset is needed between runs.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith("_test"))
    throw new Error("TEST_DATABASE_URL must name a *_test database.");
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
  });
}
