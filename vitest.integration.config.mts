import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

/** Integration tests against a separate PostgreSQL test database (TEST_DATABASE_URL). */
export default defineConfig(() => {
  const env = loadEnv("test", process.cwd(), "");
  const testUrl = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error("Set TEST_DATABASE_URL (see .env.example).");
  if (!/_test(\?|$)/.test(new URL(testUrl).pathname + "")) {
    throw new Error("TEST_DATABASE_URL must point at a database whose name ends in _test; it is only for test data.");
  }

  // Global setup runs in the main process, so expose the URL there too.
  process.env.TEST_DATABASE_URL = testUrl;

  return {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
      },
    },
    test: {
      environment: "node",
      include: ["src/**/*.int.test.ts"],
      globalSetup: ["./tests/integration/global-setup.ts"],
      setupFiles: ["./tests/integration/setup.ts"],
      env: { DATABASE_URL: testUrl, TEST_DATABASE_URL: testUrl, MAIL_TRANSPORT: "outbox" },
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  };
});
