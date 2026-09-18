// Claude-driven multi-theme refactor for refactory.
// Spawns `claude -p` in the cloned repository, lets it explore the tree
// and apply every high-value behavior-preserving cleanup that fits in
// the timeout, then returns a summary for the pull request body.
// Does not run git add/commit/push.
// Limitations: 45-minute default timeout. Claude may still make no
//   edits, or may leave remaining clusters for a later week.

import { spawn } from "child_process";

import { logger } from "./logger.js";
import type { ClaudeRefactorResult, Config } from "./types.js";

const ALLOWED_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Bash(git diff *)",
  "Bash(git status *)",
  "Bash(git log *)",
  "Bash(ls *)",
  "Bash(find *)",
  "Bash(rg *)",
  "Bash(grep *)",
  "Bash(cat *)",
  "Bash(head *)",
  "Bash(tail *)",
  "Bash(wc *)",
  "Bash(tree *)",
].join(",");

const SIGKILL_GRACE_MS = 5_000;
const MAX_STDOUT_SIZE = 100_000;

export class RefactorRunner {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async run(
    repoDir: string,
    owner: string,
    repo: string
  ): Promise<ClaudeRefactorResult> {
    logger.info("Running claude -p for a one-theme refactor.", {
      repoDir,
      owner,
      repo,
      timeoutMs: this.config.claudeTimeoutMs,
    });

    const stdout = await this.runClaude(
      repoDir,
      this.buildPrompt(owner, repo)
    );
    const parsed = parseClaudeSummary(stdout);

    logger.info("claude -p finished.", {
      owner,
      repo,
      theme: parsed.theme,
    });

    return {
      theme: parsed.theme,
      notes: parsed.notes,
      stdoutTail: stdout.substring(Math.max(0, stdout.length - 4000)),
    };
  }

  private buildPrompt(owner: string, repo: string): string {
    return [
      "You are cleaning up this repository after Cursor / Codex feature work.",
      "",
      `Repository: ${owner}/${repo}`,
      "",
      "Read AGENTS.md, CLAUDE.md, and README.md first when they exist.",
      "Explore the tree thoroughly: duplicated UI, duplicated helpers, dead exports,",
      "and files that drifted out of the existing layout. Do not stop at the first match.",
      "",
      "Then apply every high-value behavior-preserving cleanup that you can finish safely",
      "in this session. Multiple independent themes in one pass are expected and preferred",
      "over a single tiny extract. Keep going until remaining work is low-value or unsafe,",
      "or until you are out of time.",
      "",
      "Rules:",
      "- Do not change user-visible behavior, routes, public APIs, DB schema, or env meaning.",
      "- Do not run a formatter-only pass and call that a cleanup.",
      "- Do not rewrite a whole monorepo or redesign the architecture in one session.",
      "- Each theme must be a real cluster (extract, dead-code removal, or layout cleanup), not a drive-by style nit.",
      "- New files are allowed only to extract a duplicated piece into one shared place.",
      "- In Svelte files, never put comments before the <script tag; they render on the page.",
      "- Do not run git add, git commit, git push, git checkout, or git merge.",
      "- Do not install packages or run the full test suite.",
      "- Do not create scratch files, notes, TODOs-as-files, or placeholders that say to delete them later.",
      "- Do not create a file whose only purpose is to explain that another edit failed.",
      "- If a delete or move cannot be completed, leave the tree unchanged for that part. Never substitute a comment-only or 'safe to delete' file.",
      "",
      "If there is nothing safe and useful to clean, make no edits.",
      "",
      "When finished, print exactly:",
      "SUMMARY: <semicolon-separated themes, or none>",
      "CHANGED_FILES:",
      "- path/relative/to/repo",
      "(Use a single dash line `- (none)` when you made no edits.)",
    ].join("\n");
  }

  private async runClaude(repoDir: string, prompt: string): Promise<string> {
    const args = ["-p", "--allowedTools", ALLOWED_TOOLS];
    if (this.config.claudeModel) {
      args.push("--model", this.config.claudeModel);
    }

    const timeoutMs = this.config.claudeTimeoutMs;

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let timedOut = false;

      const child = spawn("claude", args, {
        cwd: repoDir,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      const killTimer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        logger.warn("claude -p timed out, sending SIGTERM.", {
          timeoutMs,
          repoDir,
        });
        child.kill("SIGTERM");
        setTimeout(() => {
          if (settled) return;
          logger.warn("claude -p did not exit after SIGTERM, sending SIGKILL.", {
            repoDir,
          });
          child.kill("SIGKILL");
        }, SIGKILL_GRACE_MS);
      }, timeoutMs);

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
        if (stdout.length > MAX_STDOUT_SIZE) {
          stdout = stdout.substring(stdout.length - MAX_STDOUT_SIZE);
        }
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("close", (code, signal) => {
        clearTimeout(killTimer);
        if (settled) return;
        settled = true;

        if (timedOut) {
          logger.warn(
            "claude -p timed out; keeping any cleanups already written to disk.",
            { timeoutMs, repoDir, signal }
          );
          resolve(stdout);
          return;
        }
        if (code !== 0) {
          logger.error("claude -p exited with non-zero code.", {
            exitCode: code,
            repoDir,
            stderr: stderr.substring(0, 1000) || "(empty)",
            stdoutTail:
              stdout.substring(Math.max(0, stdout.length - 2000)) || "(empty)",
          });
          reject(
            new Error(
              `claude -p refactor exited with code ${code} (repoDir=${repoDir}).`
            )
          );
          return;
        }
        resolve(stdout);
      });

      child.on("error", (error) => {
        clearTimeout(killTimer);
        if (settled) return;
        settled = true;
        reject(
          new Error(
            `claude -p refactor failed to start (repoDir=${repoDir}): ${error.message}`
          )
        );
      });

      child.stdin.write(prompt);
      child.stdin.end();
    });
  }
}

export function parseClaudeSummary(stdout: string): {
  theme: string;
  notes: string;
} {
  const summaryMatch = stdout.match(/^SUMMARY:\s*(.+)$/m);
  const theme = summaryMatch?.[1]?.trim() || "Weekly cleanup";

  const filesIndex = stdout.search(/^CHANGED_FILES:\s*$/m);
  let notes = "";
  if (filesIndex >= 0) {
    notes = stdout.substring(filesIndex).trim();
  } else if (summaryMatch) {
    notes = summaryMatch[0];
  }

  return { theme, notes };
}
