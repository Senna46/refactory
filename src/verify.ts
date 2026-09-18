// Light verification for refactory working trees.
// Only runs `git diff --check` so a first trial does not pnpm-install
// every target monorepo. Conflict markers and whitespace errors fail
// the run; the caller discards the working tree.
// Limitations: Does not run lint, typecheck, tests, or package installs.

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
