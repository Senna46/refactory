// Configuration loader for refactory.
// Reads REFACTORY_* environment variables (with dotenv support) and
// validates required settings. Uses a GitHub App for clone tokens and
// a user PAT so opened PRs are authored by REFACTORY_AUTHOR_LOGIN.
// Limitations: Only supports environment variable configuration,
//   no config file support.

import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import { config as dotenvConfig } from "dotenv";

import type { Config, LogLevel, RepoRef } from "./types.js";

const VALID_LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

const DEFAULT_REPOS =
  "d6e-ai/d6e,d6e-ai/d6e-auth,d6e-ai/ai-gateway,d6e-products/d6e-valuation,d6e-ai/ai-keiri";

const DEFAULT_CLAUDE_TIMEOUT_SECONDS = 2700;

export function loadConfig(): Config {
  dotenvConfig();

  const appIdStr = process.env.REFACTORY_APP_ID?.trim();
  if (!appIdStr) {
    throw new Error("Configuration error: REFACTORY_APP_ID is required.");
  }
  const appId = parseInt(appIdStr, 10);
  if (isNaN(appId) || appId <= 0) {
    throw new Error(
      `Configuration error: REFACTORY_APP_ID must be a positive integer, got "${appIdStr}".`
    );
  }

  const privateKey = loadPrivateKey();

  const githubToken = process.env.REFACTORY_GITHUB_TOKEN?.trim();
  if (!githubToken) {
    throw new Error(
      "Configuration error: REFACTORY_GITHUB_TOKEN is required. " +
        "Use a classic PAT for Senna46 so PRs are authored by that user " +
        "and git push triggers Bugbot webhooks."
    );
  }

  const authorLogin = process.env.REFACTORY_AUTHOR_LOGIN?.trim() || "Senna46";

  const repos = parseRepoList(
    process.env.REFACTORY_REPOS?.trim() || DEFAULT_REPOS
  );

  const defaultWorkDir = join(homedir(), ".refactory", "repos");
  const workDir = process.env.REFACTORY_WORK_DIR?.trim() || defaultWorkDir;

  const defaultDbPath = join(homedir(), ".refactory", "state.db");
  const dbPath = process.env.REFACTORY_DB_PATH?.trim() || defaultDbPath;

  const claudeModel = process.env.REFACTORY_CLAUDE_MODEL?.trim() || null;
  const claudeTimeoutMs =
    parsePositiveInt(
      process.env.REFACTORY_CLAUDE_TIMEOUT,
      DEFAULT_CLAUDE_TIMEOUT_SECONDS
    ) * 1000;
  const logLevel = parseLogLevel(process.env.REFACTORY_LOG_LEVEL);

  return {
    appId,
    privateKey,
    githubToken,
    authorLogin,
    repos,
    workDir,
    dbPath,
    claudeModel,
    claudeTimeoutMs,
    logLevel,
  };
}

function loadPrivateKey(): string {
  const privateKeyPath = process.env.REFACTORY_PRIVATE_KEY_PATH?.trim();
  const privateKeyEnv = process.env.REFACTORY_PRIVATE_KEY?.trim();

  if (privateKeyPath) {
    try {
      return readFileSync(privateKeyPath, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Configuration error: Failed to read private key from REFACTORY_PRIVATE_KEY_PATH="${privateKeyPath}": ${message}`
      );
    }
  }

  if (privateKeyEnv) {
    return privateKeyEnv;
  }

  throw new Error(
    "Configuration error: Either REFACTORY_PRIVATE_KEY_PATH or REFACTORY_PRIVATE_KEY must be set."
  );
}

function parseRepoList(value: string): RepoRef[] {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (items.length === 0) {
    throw new Error(
      "Configuration error: REFACTORY_REPOS must list at least one owner/name repository."
    );
  }

  const repos: RepoRef[] = [];
  for (const item of items) {
    const parts = item.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(
        `Configuration error: REFACTORY_REPOS entry "${item}" must be in owner/name form.`
      );
    }
    repos.push({ owner: parts[0], name: parts[1] });
  }
  return repos;
}

function parsePositiveInt(
  value: string | undefined,
  defaultValue: number
): number {
  if (!value || value.trim() === "") {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new Error(
      `Configuration error: Expected a positive integer but got "${value}".`
    );
  }
  return parsed;
}

function parseLogLevel(value: string | undefined): LogLevel {
  const level = (value?.trim().toLowerCase() || "info") as LogLevel;
  if (!VALID_LOG_LEVELS.includes(level)) {
    throw new Error(
      `Configuration error: Invalid log level "${value}". Valid levels: ${VALID_LOG_LEVELS.join(", ")}`
    );
  }
  return level;
}
