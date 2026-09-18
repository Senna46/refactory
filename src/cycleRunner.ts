// One repository cycle for refactory.
// Skips repos that already ran after last Sunday 00:00 JST (unless
// --force), skips when an open managed PR exists, otherwise clones,
// runs Claude, light-verifies, commits, pushes, and opens a PR.
// Limitations: Sequential. A Claude or verify failure is recorded and
//   the next allowlisted repo still runs.

import { GitHubClient, MANAGED_MARKER } from "./githubClient.js";
import { GitOps } from "./gitOps.js";
import { logger } from "./logger.js";
import { RefactorRunner } from "./refactorRunner.js";
import {
  formatJstDate,
  hasCompletedThisSundayCycle,
  lastSundayMidnightJst,
} from "./schedule.js";
import { StateStore } from "./state.js";
import type {
  Config,
  RefactorStatus,
  RepoRef,
  TrackedPullRequest,
} from "./types.js";
import { findUnsafeChangedFiles, verifyWorkingTree } from "./verify.js";

export class CycleRunner {
  private config: Config;
  private github: GitHubClient;
  private state: StateStore;
  private gitOps: GitOps;
  private refactorRunner: RefactorRunner;
  private force: boolean;
  private isShuttingDown: () => boolean;

  constructor(params: {
    config: Config;
    github: GitHubClient;
    state: StateStore;
    gitOps: GitOps;
    refactorRunner: RefactorRunner;
    force: boolean;
    isShuttingDown: () => boolean;
  }) {
    this.config = params.config;
    this.github = params.github;
    this.state = params.state;
    this.gitOps = params.gitOps;
    this.refactorRunner = params.refactorRunner;
    this.force = params.force;
    this.isShuttingDown = params.isShuttingDown;
  }

  async runAll(): Promise<void> {
    logger.info("Starting refactory cycle.", {
      repoCount: this.config.repos.length,
      force: this.force,
      lastSundayMidnightJst: lastSundayMidnightJst().toISOString(),
    });

    for (const repo of this.config.repos) {
      if (this.isShuttingDown()) {
        logger.info("Shutdown requested; stopping before remaining repos.");
        break;
      }
      try {
        await this.processRepo(repo);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Unhandled error while processing repository.", {
          owner: repo.owner,
          repo: repo.name,
          error: message,
        });
        this.record(repo, {
          status: "error",
          error: message,
        });
      }
    }
  }

  private async processRepo(repo: RepoRef): Promise<void> {
    const repoName = `${repo.owner}/${repo.name}`;
    const previous = this.state.get(repoName);

    if (
      !this.force &&
      hasCompletedThisSundayCycle(previous?.lastRunAt ?? null)
    ) {
      logger.info("Skipping repository; already ran this Sunday cycle.", {
        repo: repoName,
        lastRunAt: previous?.lastRunAt,
      });
      return;
    }

    const openManaged = await this.github.findOpenManagedPullRequest(
      repo.owner,
      repo.name
    );
    if (openManaged) {
      logger.info("Skipping repository; an open refactory PR already exists.", {
        repo: repoName,
        pr: openManaged.number,
        htmlUrl: openManaged.htmlUrl,
      });
      this.record(repo, {
        status: "skipped_open_pr",
        prNumber: openManaged.number,
        branch: openManaged.headRef,
      });
      return;
    }

    const cloneToken = await this.github.getInstallationToken(repo.owner);
    const repoDir = await this.gitOps.ensureRepoClone(
      repo.owner,
      repo.name,
      cloneToken
    );
    const defaultBranch = await this.github.getDefaultBranch(
      repo.owner,
      repo.name
    );
    const branchName = `refactory/${formatJstDate()}`;
    await this.gitOps.checkoutFreshBranch(
      repoDir,
      defaultBranch,
      branchName,
      cloneToken
    );

    let claudeTheme = "Weekly cleanup";
    let claudeNotes = "";
    try {
      const claude = await this.refactorRunner.run(
        repoDir,
        repo.owner,
        repo.name
      );
      claudeTheme = claude.theme;
      claudeNotes = claude.notes;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.gitOps.discardLocalChanges(repoDir);
      this.record(repo, {
        status: "claude_failed",
        theme: claudeTheme,
        error: message,
        branch: branchName,
      });
      return;
    }

    const hasChanges = await this.gitOps.hasUncommittedChanges(repoDir);
    if (!hasChanges) {
      logger.info("Claude made no file changes; not opening a PR.", {
        repo: repoName,
        theme: claudeTheme,
      });
      this.record(repo, {
        status: "no_changes",
        theme: claudeTheme,
        branch: branchName,
      });
      return;
    }

    const changedFiles = await this.gitOps.changedFiles(repoDir);
    const unsafe = findUnsafeChangedFiles(changedFiles);
    if (unsafe.length > 0) {
      logger.error("Refusing to commit unsafe paths.", {
        repo: repoName,
        unsafe,
      });
      await this.gitOps.discardLocalChanges(repoDir);
      this.record(repo, {
        status: "unsafe_diff",
        theme: claudeTheme,
        error: `Unsafe paths in diff: ${unsafe.join(", ")}`,
        branch: branchName,
      });
      return;
    }

    const verified = await verifyWorkingTree(this.gitOps, repoDir);
    if (!verified.ok) {
      await this.gitOps.discardLocalChanges(repoDir);
      this.record(repo, {
        status: "verify_failed",
        theme: claudeTheme,
        error: verified.output.substring(0, 1500),
        branch: branchName,
      });
      return;
    }

    const commitMessage = [
      `refactor: ${truncate(claudeTheme, 60)}`,
      "",
      "Generated by refactory. Behavior should be unchanged.",
    ].join("\n");

    await this.gitOps.commitAll(repoDir, commitMessage);
    const pushedBranch = await this.gitOps.pushBranch(
      repoDir,
      branchName,
      this.config.githubToken
    );

    const pr = await this.openOrReusePullRequest({
      repo,
      defaultBranch,
      branch: pushedBranch,
      theme: claudeTheme,
      notes: claudeNotes,
      changedFiles,
    });

    logger.info("Opened refactory pull request.", {
      repo: repoName,
      pr: pr.number,
      htmlUrl: pr.htmlUrl,
      theme: claudeTheme,
    });

    this.record(repo, {
      status: "success",
      theme: claudeTheme,
      prNumber: pr.number,
      branch: pushedBranch,
    });
  }

  private async openOrReusePullRequest(params: {
    repo: RepoRef;
    defaultBranch: string;
    branch: string;
    theme: string;
    notes: string;
    changedFiles: string[];
  }): Promise<TrackedPullRequest> {
    const existing = await this.github.findPullRequestByHead(
      params.repo.owner,
      params.repo.name,
      params.branch,
      "open"
    );
    if (existing) {
      logger.info("Reusing existing pull request for branch.", {
        owner: params.repo.owner,
        repo: params.repo.name,
        branch: params.branch,
        pr: existing.number,
      });
      return existing;
    }

    const title = `refactory: ${truncate(params.theme, 70)}`;
    const body = buildPullRequestBody(
      params.theme,
      params.notes,
      params.changedFiles
    );

    return this.github.createPullRequest({
      owner: params.repo.owner,
      repo: params.repo.name,
      title,
      head: params.branch,
      base: params.defaultBranch,
      body,
    });
  }

  private record(
    repo: RepoRef,
    fields: {
      status: RefactorStatus;
      theme?: string;
      error?: string;
      prNumber?: number;
      branch?: string;
    }
  ): void {
    this.state.upsert({
      repo: `${repo.owner}/${repo.name}`,
      lastRunAt: new Date().toISOString(),
      lastStatus: fields.status,
      lastPr: fields.prNumber ?? null,
      lastBranch: fields.branch ?? null,
      lastTheme: fields.theme ?? null,
      lastError: fields.error ?? null,
    });
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function buildPullRequestBody(
  theme: string,
  notes: string,
  changedFiles: string[]
): string {
  const fileList =
    changedFiles.length > 0
      ? changedFiles.map((file) => `- \`${file}\``).join("\n")
      : "- (see git diff)";

  const notesBlock = notes.trim()
    ? ["", "Claude notes:", "", "```", notes.trim().slice(0, 4000), "```"].join(
        "\n"
      )
    : "";

  return [
    MANAGED_MARKER,
    "",
    "Weekly behavior-preserving cleanup generated by [refactory](https://github.com/Senna46/refactory).",
    "",
    `**Theme:** ${theme}`,
    "",
    "**Changed files:**",
    fileList,
    notesBlock,
    "",
    "Please review for accidental behavior changes. This PR is not auto-merged.",
  ].join("\n");
}
