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
  return db;
}

/**
 * There is no migration framework yet -- for a project this size, a
 * couple of guarded ALTER TABLEs are simpler than adding one. Each is
 * a no-op (caught and ignored) once the column already exists, so this
 * is safe to run on every boot against an older world.db.
 */
function runLightweightMigrations(db: Database.Database): void {
  const alters = ["ALTER TABLE agents ADD COLUMN skill REAL NOT NULL DEFAULT 0"];
  for (const sql of alters) {
    try {
      db.exec(sql);
    } catch (err) {
      if (!/duplicate column name/i.test(String(err))) throw err;
    }
  }
}
