// Main entry point for the refactory job.
// Loads config, takes a process lock, runs one allowlist cycle, then
// exits. launchd starts this at Sunday 00:00; `--force` (or REFACTORY_FORCE=1)
// ignores the Sunday-cycle skip so an install-time trial can run on any day.
// Limitations: Single-threaded. Graceful stop between repositories on
//   SIGINT/SIGTERM. Does not poll in a loop.

import { execFile } from "child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { promisify } from "util";

import { loadConfig } from "./config.js";
import { CycleRunner } from "./cycleRunner.js";
import { GitHubClient } from "./githubClient.js";
import { GitOps } from "./gitOps.js";
import { logger, setLogLevel } from "./logger.js";
import { RefactorRunner } from "./refactorRunner.js";
import { isForceRun } from "./schedule.js";
import { StateStore } from "./state.js";
import type { Config } from "./types.js";

const execFileAsync = promisify(execFile);

class RefactoryJob {
  private config: Config;
  private state: StateStore;
  private force: boolean;
  private isShuttingDown = false;

  constructor(config: Config, force: boolean) {
    this.config = config;
    this.force = force;
    this.state = new StateStore(config.dbPath);
  }

  async initialize(): Promise<void> {
    logger.info("Initializing refactory...");
    logger.info("Configuration loaded.", {
      appId: this.config.appId,
      authorLogin: this.config.authorLogin,
      repoCount: this.config.repos.length,
      repos: this.config.repos.map((repo) => `${repo.owner}/${repo.name}`),
      claudeModel: this.config.claudeModel ?? "(default)",
      claudeTimeoutMs: this.config.claudeTimeoutMs,
      force: this.force,
    });

    await this.verifyPrerequisites();

    const github = await GitHubClient.create(
      this.config.appId,
      this.config.privateKey,
      this.config.githubToken
    );
    github.assertReposAreInstalled(this.config.repos);

    const gitOps = new GitOps(this.config.workDir);
    const refactorRunner = new RefactorRunner(this.config);
    const cycle = new CycleRunner({
      config: this.config,
      github,
      state: this.state,
      gitOps,
      refactorRunner,
      force: this.force,
      isShuttingDown: () => this.isShuttingDown,
    });

    this.registerShutdownHandlers();
    await cycle.runAll();
    this.shutdown();
  }

  private async verifyPrerequisites(): Promise<void> {
    if (!this.config.appId || !this.config.privateKey) {
      throw new Error(
        "GitHub App credentials are missing. Set REFACTORY_APP_ID and " +
          "REFACTORY_PRIVATE_KEY_PATH (or REFACTORY_PRIVATE_KEY)."
      );
    }
    if (!this.config.githubToken) {
      throw new Error(
        "REFACTORY_GITHUB_TOKEN is missing. A Senna46 classic PAT is required so PRs are user-authored."
      );
    }

    try {
      const { stdout } = await execFileAsync("claude", ["--version"]);
      logger.debug("claude CLI version.", { version: stdout.trim() });
    } catch {
      throw new Error(
        "claude CLI is not available. Install Claude Code first: https://docs.anthropic.com/en/docs/claude-code"
      );
    }

    if (
      !process.env.CLAUDE_CODE_OAUTH_TOKEN &&
      !process.env.ANTHROPIC_API_KEY
    ) {
      const homeDir = process.env.HOME ?? "/root";
      const credFile = `${homeDir}/.claude/.credentials.json`;
      if (!existsSync(credFile)) {
        logger.warn(
          "No Claude authentication detected. " +
            "Set CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY, " +
            "or ensure ~/.claude/.credentials.json exists."
        );
      }
    }

    try {
      await execFileAsync("git", ["--version"]);
    } catch {
      throw new Error("git is not available. Install git first.");
    }
  }

  private registerShutdownHandlers(): void {
    const handleShutdown = (signal: string) => {
      logger.info(`Received ${signal}. Will stop after the current repository.`);
      this.isShuttingDown = true;
    };

    process.on("SIGINT", () => handleShutdown("SIGINT"));
    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  }

  private shutdown(): void {
    this.state.close();
    logger.info("refactory stopped.");
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(dbPath: string): string {
  const lockPath = join(dirname(dbPath), "job.lock");
  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return lockPath;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const existingPid = readFileSync(lockPath, "utf-8").trim();
      const pid = parseInt(existingPid, 10);

      if (!isNaN(pid) && pid !== process.pid && isProcessRunning(pid)) {
        throw new Error(
          `Another refactory instance is already running (PID ${existingPid}, lock: ${lockPath}). ` +
            "Stop the existing instance first."
        );
      }

      try {
        unlinkSync(lockPath);
        const fd = openSync(lockPath, "wx");
        writeFileSync(fd, String(process.pid));
        closeSync(fd);
      } catch {
        throw new Error(
          `Another refactory instance is already running (lock: ${lockPath}). ` +
            "Stop the existing instance first."
        );
      }
      return lockPath;
    }
    throw error;
  }
}

function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    // Best-effort cleanup
  }
}

async function main(): Promise<void> {
  let lockPath: string | null = null;
  try {
    const config = loadConfig();
    setLogLevel(config.logLevel);

    mkdirSync(dirname(config.dbPath), { recursive: true });
    lockPath = acquireLock(config.dbPath);

    const job = new RefactoryJob(config, isForceRun());
    await job.initialize();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[FATAL] ${message}`);
    if (lockPath) releaseLock(lockPath);
    process.exit(1);
  } finally {
    if (lockPath) releaseLock(lockPath);
  }
}

main();
