// Local git operations for refactory.
// Clones allowlisted repositories with a GitHub App installation token,
// checks out a dated branch from the default branch, commits Claude's
// edits, and pushes with a user PAT so Bugbot webhooks fire.
// Limitations: Requires git CLI. Single-threaded use per repo directory.
//   Does not force-push; a colliding remote branch is renamed with HHMM.

import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

import { logger } from "./logger.js";
import { formatJstHourMinute } from "./schedule.js";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 2 * 60 * 1000;
const GIT_USER_NAME = "Senna46";
const GIT_USER_EMAIL = "Senna46@users.noreply.github.com";

export class GitOps {
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  repoDir(owner: string, repo: string): string {
    return join(this.workDir, owner, repo);
  }

  async ensureRepoClone(
    owner: string,
    repo: string,
    cloneToken: string
  ): Promise<string> {
    await mkdir(this.workDir, { recursive: true });
    const repoDir = this.repoDir(owner, repo);

    if (existsSync(join(repoDir, ".git"))) {
      logger.debug("Fetching latest for existing clone.", { repoDir });
      await this.execGit(repoDir, ["fetch", "--all", "--prune"], cloneToken);
    } else {
      logger.info("Cloning repository.", { owner, repo, repoDir });
      await mkdir(join(this.workDir, owner), { recursive: true });
      const cloneUrl = `https://github.com/${owner}/${repo}.git`;
      await this.execGit(
        this.workDir,
        ["clone", cloneUrl, join(owner, repo)],
        cloneToken
      );
    }

    return repoDir;
  }

  async checkoutFreshBranch(
    repoDir: string,
    defaultBranch: string,
    branchName: string,
    cloneToken: string
  ): Promise<string> {
    await this.discardLocalChanges(repoDir);
    await this.execGit(repoDir, ["fetch", "origin", defaultBranch], cloneToken);
    await this.execGit(repoDir, [
      "checkout",
      "-B",
      defaultBranch,
      `origin/${defaultBranch}`,
    ]);
    await this.execGit(repoDir, ["reset", "--hard", `origin/${defaultBranch}`]);
    await this.execGit(repoDir, ["clean", "-fd"]);
    await this.execGit(repoDir, ["checkout", "-B", branchName]);
    logger.info("Checked out fresh refactor branch.", {
      repoDir,
      defaultBranch,
      branchName,
    });
    return branchName;
  }

  async hasUncommittedChanges(repoDir: string): Promise<boolean> {
    const output = await this.execGit(repoDir, ["status", "--porcelain"]);
    return output.trim().length > 0;
  }

  async changedFiles(repoDir: string): Promise<string[]> {
    const statuses = await this.changedFileStatuses(repoDir);
    return statuses.map((status) => status.path);
  }

  async untrackedFiles(repoDir: string): Promise<Set<string>> {
    const statuses = await this.changedFileStatuses(repoDir);
    return new Set(
      statuses
        .filter((status) => status.code.includes("?"))
        .map((status) => status.path)
    );
  }

  private async changedFileStatuses(
    repoDir: string
  ): Promise<{ code: string; path: string }[]> {
    const output = await this.execGit(repoDir, ["status", "--porcelain"]);
    return output
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => ({
        code: line.substring(0, 2),
        path: line.substring(3).replace(/^.* -> /, ""),
      }));
  }

  async diffCheck(repoDir: string): Promise<{ ok: boolean; output: string }> {
    try {
      await this.execGit(repoDir, ["add", "-A"]);
      const output = await this.execGit(repoDir, ["diff", "--check", "HEAD"]);
      return { ok: true, output: output.trim() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, output: sanitizeGitError(message) };
    }
  }

  async commitAll(repoDir: string, message: string): Promise<string> {
    await this.execGit(repoDir, ["add", "-A"]);
    await this.execGit(repoDir, [
      "-c",
      `user.name=${GIT_USER_NAME}`,
      "-c",
      `user.email=${GIT_USER_EMAIL}`,
      "commit",
      "-m",
      message,
    ]);
    const sha = (await this.execGit(repoDir, ["rev-parse", "HEAD"])).trim();
    logger.info("Created refactor commit.", {
      repoDir,
      sha: sha.substring(0, 10),
    });
    return sha;
  }

  async pushBranch(
    repoDir: string,
    branchName: string,
    pushToken: string
  ): Promise<string> {
    try {
      await this.execGit(
        repoDir,
        ["push", "-u", "origin", branchName],
        pushToken
      );
      return branchName;
    } catch (error) {
      const renamed = `${branchName}-${formatJstHourMinute()}`;
      logger.warn("Push of dated branch failed; retrying with a time suffix.", {
        repoDir,
        branchName,
        renamed,
        error: sanitizeGitError(
          error instanceof Error ? error.message : String(error)
        ),
      });
      await this.execGit(repoDir, ["checkout", "-B", renamed]);
      await this.execGit(
        repoDir,
        ["push", "-u", "origin", renamed],
        pushToken
      );
      return renamed;
    }
  }

  async discardLocalChanges(repoDir: string): Promise<void> {
    await this.execGit(repoDir, ["merge", "--abort"], undefined, {
      allowFailure: true,
    });
    await this.execGit(repoDir, ["cherry-pick", "--abort"], undefined, {
      allowFailure: true,
    });
    await this.execGit(repoDir, ["reset", "--hard", "HEAD"], undefined, {
      allowFailure: true,
    });
    await this.execGit(repoDir, ["clean", "-fd"]);
  }

  async removePaths(repoDir: string, relativePaths: string[]): Promise<void> {
    for (const relativePath of relativePaths) {
      const absPath = join(repoDir, relativePath);
      try {
        await rm(absPath, { recursive: true, force: true });
        logger.info("Removed leftover artifact file.", {
          repoDir,
          path: relativePath,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `removePaths failed (repoDir=${repoDir}, path=${relativePath}): ${message}`
        );
      }
    }
  }

  private buildGitAuthArgs(token: string): string[] {
    const encoded = Buffer.from(`x-access-token:${token}`).toString("base64");
    return [
      "-c",
      `http.https://github.com/.extraheader=Authorization: basic ${encoded}`,
    ];
  }

  private async execGit(
    cwd: string,
    args: string[],
    token?: string,
    options?: { allowFailure?: boolean }
  ): Promise<string> {
    logger.debug(`git ${args.join(" ")}`, { cwd });
    const fullArgs = token
      ? [...this.buildGitAuthArgs(token), ...args]
      : args;
    try {
      const { stdout } = await execFileAsync("git", fullArgs, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        timeout: GIT_TIMEOUT_MS,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
        },
      });
      return stdout;
    } catch (error) {
      if (options?.allowFailure) {
        return "";
      }
      const execError = error as {
        message?: string;
        stderr?: string;
        stdout?: string;
        code?: number | string;
      };
      logger.error(`git ${args.join(" ")} failed.`, {
        cwd,
        exitCode: execError.code,
        stderr: sanitizeGitError(execError.stderr?.trim() || "(empty)"),
        stdout: sanitizeGitError(execError.stdout?.trim() || "(empty)"),
      });
      if (execError.stderr) {
        execError.stderr = sanitizeGitError(execError.stderr);
      }
      if (execError.stdout) {
        execError.stdout = sanitizeGitError(execError.stdout);
      }
      if (execError.message) {
        execError.message = sanitizeGitError(execError.message);
      }
      throw error;
    }
  }
}

export function sanitizeGitError(message: string): string {
  return message
    .replace(/x-access-token:[^\s@]+/g, "x-access-token:[REDACTED]")
    .replace(
      /http\.[^\s]*\.extraheader=Authorization: basic [A-Za-z0-9+/=]+/g,
      "http.extraheader=[REDACTED]"
    )
    .replace(
      /Authorization: basic [A-Za-z0-9+/=]+/g,
      "Authorization: basic [REDACTED]"
    );
}
