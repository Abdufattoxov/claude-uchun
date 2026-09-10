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
  return db;
}
