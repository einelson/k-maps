/**
 * A real in-memory SQLite database (Node's built-in `node:sqlite`) behind the slice of expo-sqlite's async API
 * the repositories use, with the app's actual schema. Lets repository tests run their SQL for real instead of
 * pattern-matching it. Test-only — never imported by app code.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { CREATE_SCHEMA_SQL } from '../data/schema';

type Param = string | number | null;

export function createTestDb(): SQLiteDatabase {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite');
  const raw = new DatabaseSync(':memory:');
  raw.exec(CREATE_SCHEMA_SQL);

  const db = {
    async runAsync(sql: string, ...params: Param[]) {
      const result = raw.prepare(sql).run(...params);
      return { lastInsertRowId: Number(result.lastInsertRowid), changes: Number(result.changes) };
    },
    async getAllAsync(sql: string, ...params: Param[]) {
      return raw.prepare(sql).all(...params).map((row: object) => ({ ...row }));
    },
    async getFirstAsync(sql: string, ...params: Param[]) {
      const row = raw.prepare(sql).get(...params);
      return row ? { ...row } : null;
    },
    async execAsync(sql: string) {
      raw.exec(sql);
    },
    async withTransactionAsync(task: () => Promise<void>) {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
  };
  return db as unknown as SQLiteDatabase;
}
