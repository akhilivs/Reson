import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from './migrations.js';

/**
 * Opens (or creates) the Reson library database and applies pending migrations.
 * Uses Node's built-in SQLite (bundled with Electron), so no native module rebuilds are needed.
 */
export function openDatabase(filePath) {
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON');
  if (filePath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
  }
  db.exec('PRAGMA busy_timeout = 3000');
  runMigrations(db);
  return db;
}

let savepointCounter = 0;

/** Runs fn inside a transaction (or a savepoint when already inside one). */
export function transaction(db, fn) {
  if (db.isTransaction) {
    const name = `sp_${++savepointCounter}`;
    db.exec(`SAVEPOINT ${name}`);
    try {
      const result = fn();
      db.exec(`RELEASE ${name}`);
      return result;
    } catch (err) {
      db.exec(`ROLLBACK TO ${name}`);
      db.exec(`RELEASE ${name}`);
      throw err;
    }
  }
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
