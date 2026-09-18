// SQLite-based state management for refactory.
// Tracks the last weekly run per allowlisted repository so Sunday
// launchd and a later restart do not double-process the same cycle.
// Limitations: Single-process only; no concurrent access support.

import { mkdirSync } from "fs";
import { dirname } from "path";

import Database from "better-sqlite3";

import { logger } from "./logger.js";
import type { RefactorRunRecord, RefactorStatus } from "./types.js";

export class StateStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.initializeSchema();

    logger.debug("State store initialized.", { dbPath });
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS refactor_runs (
        repo TEXT PRIMARY KEY,
        last_run_at TEXT NOT NULL,
        last_status TEXT NOT NULL,
        last_pr INTEGER,
        last_branch TEXT,
        last_theme TEXT,
        last_error TEXT
      );
    `);
  }

  get(repo: string): RefactorRunRecord | null {
    const row = this.db
      .prepare(
        `SELECT repo, last_run_at, last_status, last_pr, last_branch,
                last_theme, last_error
         FROM refactor_runs
         WHERE repo = ?`
      )
      .get(repo) as RefactorRunRow | undefined;

    return row ? rowToRecord(row) : null;
  }

  upsert(record: RefactorRunRecord): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO refactor_runs (
           repo, last_run_at, last_status, last_pr, last_branch,
           last_theme, last_error
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.repo,
        record.lastRunAt,
        record.lastStatus,
        record.lastPr,
        record.lastBranch,
        record.lastTheme,
        record.lastError
      );

    logger.debug("Upserted refactor run record.", {
      repo: record.repo,
      lastStatus: record.lastStatus,
      lastPr: record.lastPr,
    });
  }

  close(): void {
    this.db.close();
    logger.debug("State store closed.");
  }
}

interface RefactorRunRow {
  repo: string;
  last_run_at: string;
  last_status: string;
  last_pr: number | null;
  last_branch: string | null;
  last_theme: string | null;
  last_error: string | null;
}

function rowToRecord(row: RefactorRunRow): RefactorRunRecord {
  return {
    repo: row.repo,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status as RefactorStatus,
    lastPr: row.last_pr,
    lastBranch: row.last_branch,
    lastTheme: row.last_theme,
    lastError: row.last_error,
  };
}
