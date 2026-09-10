import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DbOptions {
  /** Path to the sqlite file, or ":memory:" for ephemeral (tests). */
  file?: string;
}

export function openDatabase(opts: DbOptions = {}): Database.Database {
  const file = opts.file ?? path.resolve(__dirname, "../../data/world.db");
  if (file !== ":memory:") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = fs.readFileSync(path.resolve(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);
  runLightweightMigrations(db);
  backfillBirthMinutes(db);
  return db;
}

/**
 * There is no migration framework yet -- for a project this size, a
 * couple of guarded ALTER TABLEs are simpler than adding one. Each is
 * a no-op (caught and ignored) once the column already exists, so this
 * is safe to run on every boot against an older world.db.
 */
function runLightweightMigrations(db: Database.Database): void {
  const alters = [
    "ALTER TABLE agents ADD COLUMN skill REAL NOT NULL DEFAULT 0",
    "ALTER TABLE agents ADD COLUMN birth_sim_minute INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE agents ADD COLUMN lifespan_years REAL NOT NULL DEFAULT 90",
    "ALTER TABLE agents ADD COLUMN stage TEXT NOT NULL DEFAULT 'adult'",
    "ALTER TABLE agents ADD COLUMN parent_ids TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE agents ADD COLUMN spouse_id TEXT",
    "ALTER TABLE agents ADD COLUMN expecting_since_min INTEGER",
    "ALTER TABLE agents ADD COLUMN alive INTEGER NOT NULL DEFAULT 1",
  ];
  for (const sql of alters) {
    try {
      db.exec(sql);
    } catch (err) {
      if (!/duplicate column name/i.test(String(err))) throw err;
    }
  }
}

const MINUTES_PER_YEAR = 365 * 24 * 60;

/**
 * Pre-existing agents (created before birth_sim_minute existed) all default
 * to 0, which would make them compute as absurdly ancient once age is
 * derived from birth_sim_minute. Back-date their birth minute from their
 * already-stored `age` column relative to the world's current clock, once.
 */
function backfillBirthMinutes(db: Database.Database): void {
  const row = db.prepare("SELECT value FROM world_state WHERE key = 'total_minutes'").get() as
    | { value: string }
    | undefined;
  const now = row ? Number(row.value) : 0;
  db.prepare(
    `UPDATE agents SET birth_sim_minute = ? - CAST(age * ? AS INTEGER) WHERE birth_sim_minute = 0`
  ).run(now, MINUTES_PER_YEAR);
}
