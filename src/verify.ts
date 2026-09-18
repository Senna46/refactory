// Light verification for refactory working trees.
// Runs `git diff --check` and also drops leftover scratch / comment-only
// "please delete me" files that Claude sometimes writes when a delete fails.
// Limitations: Does not run lint, typecheck, tests, or package installs.

import { readFile } from "fs/promises";
import { basename, join } from "path";

import { logger } from "./logger.js";
import type { GitOps } from "./gitOps.js";

export async function verifyWorkingTree(
  gitOps: GitOps,
  repoDir: string
): Promise<{ ok: boolean; output: string }> {
  const result = await gitOps.diffCheck(repoDir);
  if (!result.ok) {
    logger.error("git diff --check failed.", {
      repoDir,
      output: result.output.substring(0, 2000),
    });
    return result;
  }
  logger.info("Light verification passed (git diff --check).", { repoDir });
  return result;
}

const UNSAFE_PATH_PATTERNS: RegExp[] = [
  /(^|\/)\.env$/i,
  /(^|\/)\.env\.[^/]+$/i,
  /\.pem$/i,
  /(^|\/)credentials\.json$/i,
  /(^|\/)id_rsa$/i,
  /(^|\/)id_ed25519$/i,
];

export function findUnsafeChangedFiles(files: string[]): string[] {
  return files.filter((file) =>
    UNSAFE_PATH_PATTERNS.some((pattern) => pattern.test(file))
  );
}

const LEFTOVER_PATH_PATTERNS: RegExp[] = [
  /(^|\/)scratch[-_.]/i,
  /delete-test/i,
];

const LEFTOVER_CONTENT_MARKERS = [
  "accidental artifact",
  "safe to delete",
  "sandbox could not delete",
];

export async function findLeftoverArtifactFiles(
  repoDir: string,
  files: string[],
  untrackedFiles: Set<string>
): Promise<string[]> {
  const leftovers: string[] = [];

  for (const file of files) {
    if (!untrackedFiles.has(file)) {
      continue;
    }

    if (isLeftoverPath(file)) {
      leftovers.push(file);
      continue;
    }

    let content: string;
    try {
      content = await readFile(join(repoDir, file), "utf-8");
    } catch {
      continue;
    }

    if (isLeftoverContent(content)) {
      leftovers.push(file);
    }
  }

  return leftovers;
}

function isLeftoverPath(file: string): boolean {
  const name = basename(file);
  return LEFTOVER_PATH_PATTERNS.some(
    (pattern) => pattern.test(file) || pattern.test(name)
  );
}

function isLeftoverContent(content: string): boolean {
  const withoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*#.*$/gm, "")
    .trim();
  if (withoutComments.length > 0) {
    return false;
  }

  const lower = content.toLowerCase();
  return LEFTOVER_CONTENT_MARKERS.some((marker) => lower.includes(marker));
}
