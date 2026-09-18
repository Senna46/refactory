// Data models and type definitions for refactory.
// Defines configuration, GitHub repository/PR metadata, and SQLite
// refactor-run records.
// Limitations: RefactorStatus values are stored in SQLite as strings
//   and must stay in sync with StateStore writes.

export interface Config {
  appId: number;
  privateKey: string;
  githubToken: string;
  authorLogin: string;
  repos: RepoRef[];
  workDir: string;
  dbPath: string;
  claudeModel: string | null;
  claudeTimeoutMs: number;
  logLevel: LogLevel;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface RepoRef {
  owner: string;
  name: string;
}

export interface TrackedPullRequest {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  authorLogin: string;
  state: "open" | "closed";
  baseRef: string;
  headRef: string;
  headSha: string;
}

export type RefactorStatus =
  | "success"
  | "no_changes"
  | "skipped_open_pr"
  | "skipped_this_cycle"
  | "verify_failed"
  | "unsafe_diff"
  | "claude_failed"
  | "error";

export interface RefactorRunRecord {
  repo: string;
  lastRunAt: string;
  lastStatus: RefactorStatus;
  lastPr: number | null;
  lastBranch: string | null;
  lastTheme: string | null;
  lastError: string | null;
}

export interface ClaudeRefactorResult {
  theme: string;
  notes: string;
  stdoutTail: string;
}
