import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const MIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT;');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  for (const f of readdirSync(MIG_DIR).filter(n => n.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    tx(db, () => {
      db.exec(readFileSync(join(MIG_DIR, f), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, Date.now());
    });
  }
  return db;
}
