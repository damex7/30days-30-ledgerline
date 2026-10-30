// Applies db/migrations/NNN_name.sql in order, once each.
//
//   npm run db:migrate
//
// - Numbered files: every database applies them in the same order.
// - Each file runs in its own transaction together with the row that records
//   it in schema_migrations, so a file either fully applies and is recorded,
//   or leaves no trace.
// - Recorded files are skipped, so running this twice is safe.
// - The first failure stops the run; later files never build on a broken one.
//
// Migrations are forward-only and never edited once applied. A database
// that already ran a file won't run it again, so editing the file makes your
// laptop, a teammate's database and production silently disagree about the
// schema. To change something, add a new, higher-numbered file.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
  process.exit(1);
}

const dir = join(import.meta.dirname, "..", "db", "migrations");
// The Pool speaks Neon's WebSocket protocol: one real connection, so BEGIN
// and COMMIT can wrap a whole file (the one-shot HTTP driver can't).
const pool = new Pool({ connectionString: url });
const client = await pool.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

  const done = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
  const files = (await readdir(dir)).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();

  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(dir, file), "utf8");
    process.stdout.write(`applying ${file} ... `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log("ok");
      applied++;
    } catch (error) {
      await client.query("ROLLBACK");
      console.log("FAILED");
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
      break;
    }
  }
  if (!process.exitCode) console.log(applied ? `Applied ${applied} migration(s).` : "Database is up to date.");
} finally {
  client.release();
  await pool.end();
}
