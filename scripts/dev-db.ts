/**
 * Local development PostgreSQL 16 without Docker.
 * Runs a real PostgreSQL server from npm binaries, storing data in ./.data/pg.
 * Production and Docker use the official postgres:16 image instead (docker-compose.yml).
 *
 *   npm run db:start     # keep this running in its own terminal
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "");
if (!url.hostname || !["localhost", "127.0.0.1"].includes(url.hostname)) {
  console.error("DATABASE_URL must point at localhost for the embedded dev database. Check your .env file.");
  process.exit(1);
}

const port = Number(url.port || 5433);
const user = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const database = url.pathname.replace(/^\//, "");
const databaseDir = path.resolve(".data/pg");

const server = new EmbeddedPostgres({
  databaseDir,
  port,
  user,
  password,
  authMethod: "scram-sha-256",
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
  onError: (e) => console.error("[postgres]", e),
});

async function main() {
  if (!existsSync(path.join(databaseDir, "PG_VERSION"))) {
    console.log("Initialising new PostgreSQL cluster in .data/pg …");
    await server.initialise();
  }
  await server.start();

  const client = new pg.Client({ host: "localhost", port, user, password, database: "postgres" });
  await client.connect();
  // Main dev database plus a separate one for integration tests (npm run test:integration).
  for (const name of [database, `${database}_test`]) {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) {
      await server.createDatabase(name);
      console.log(`Created database "${name}".`);
    }
  }
  const { rows } = await client.query("SHOW server_version");
  await client.end();

  console.log(
    `PostgreSQL ${rows[0].server_version} running on localhost:${port} (database "${database}"). Ctrl+C to stop.`,
  );
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping PostgreSQL …");
  await server.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch(async (err) => {
  console.error(err);
  await server.stop().catch(() => {});
  process.exit(1);
});
