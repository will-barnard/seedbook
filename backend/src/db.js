// Postgres connection pool + numbered migrations.
//
// Migrations are the .sql files in ./migrations, applied in filename order on
// boot, each in its own transaction, and recorded in schema_migrations. 001 is
// the original inline schema and is written with IF NOT EXISTS, so databases
// that predate this runner adopt it without changes.
import fs from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://seedbook:seedbook@postgres:5432/seedbook",
  max: 10,
});

const MIGRATIONS_DIR = new URL("./migrations/", import.meta.url);

// Arbitrary constant. Blue/green deploys briefly run two backends; the
// advisory lock stops both from applying the same migration at once.
const MIGRATION_LOCK_KEY = 4_270_313;

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query("SELECT name FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.name));

    const files = (await fs.readdir(MIGRATIONS_DIR))
      .filter((f) => /^\d+_.+\.sql$/.test(f))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(new URL(file, MIGRATIONS_DIR), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`[seedbook] applied migration ${file}`);
      } catch (e) {
        await client.query("ROLLBACK");
        e.message = `migration ${file} failed: ${e.message}`;
        throw e;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

export async function usersExist() {
  const { rows } = await pool.query("SELECT 1 FROM users LIMIT 1");
  return rows.length > 0;
}
