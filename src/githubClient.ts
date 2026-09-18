// GitHub API client for refactory.
// Uses a GitHub App to mint installation tokens for git clone/fetch,
// and a user PAT for pull request create/list so PRs are authored by
// Senna46 (required for Cursor Bugbot Individual).
// Limitations: Rate limiting is handled by Octokit built-in throttling.
//   Installation map is loaded at startup; restart to pick up new orgs.

import { App, Octokit } from "octokit";

import { logger } from "./logger.js";
import type { RepoRef, TrackedPullRequest } from "./types.js";

export const MANAGED_MARKER = "<!-- REFACTORY_MANAGED -->";

export class GitHubClient {
  private app: App;
  private userOctokit: Octokit;
  private installationMap: Map<string, number>;

  private constructor(app: App, userOctokit: Octokit) {
    this.app = app;
    this.userOctokit = userOctokit;
    this.installationMap = new Map();
  }

  static async create(
    appId: number,
    privateKey: string,
    githubToken: string
  ): Promise<GitHubClient> {
    const app = new App({ appId, privateKey });
    const userOctokit = new Octokit({ auth: githubToken });
    const client = new GitHubClient(app, userOctokit);
    await client.loadInstallations();
    return client;
  }

  private async loadInstallations(): Promise<void> {
    this.installationMap.clear();

    for await (const { installation } of this.app.eachInstallation.iterator()) {
      const login = installation.account?.login;
      if (login) {
        this.installationMap.set(login.toLowerCase(), installation.id);
        logger.info(
          `Found GitHub App installation for "${login}" (ID: ${installation.id}).`
        );
      }
    }

    if (this.installationMap.size === 0) {
      throw new Error(
        "No GitHub App installations found. Ensure the App is installed on at least one organization or user account."
      );
    }

    logger.info(
      `Loaded ${this.installationMap.size} GitHub App installation(s).`
    );
  }

  async getInstallationToken(owner: string): Promise<string> {
    const installationId = this.getInstallationId(owner);
    const { data } =
      await this.app.octokit.rest.apps.createInstallationAccessToken({
        installation_id: installationId,
      });
    return data.token;
  }

  private getInstallationId(owner: string): number {
    const id = this.installationMap.get(owner.toLowerCase());
    if (id === undefined) {
      throw new Error(
        `getInstallationId failed: no GitHub App installation found for owner="${owner}". ` +
          "Ensure the GitHub App is installed on this account."
      );
    }
    return id;
  }

  assertReposAreInstalled(repos: RepoRef[]): void {
    const missing: string[] = [];
    for (const repo of repos) {
      if (!this.installationMap.has(repo.owner.toLowerCase())) {
        missing.push(`${repo.owner}/${repo.name}`);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `assertReposAreInstalled failed: GitHub App is not installed on: ${missing.join(", ")}`
      );
    }
  }

  async getDefaultBranch(owner: string, repo: string): Promise<string> {
    logger.debug("Fetching default branch.", { owner, repo });

    try {
      const { data } = await this.userOctokit.rest.repos.get({ owner, repo });
      return data.default_branch;
    } catch (error) {
      throw wrapGithubError("getDefaultBranch", { owner, repo }, error);
    }
  }

  async findOpenManagedPullRequest(
    owner: string,
    repo: string
  ): Promise<TrackedPullRequest | null> {
    logger.debug("Looking for an open managed refactory pull request.", {
      owner,
      repo,
    });

    try {
      for await (const response of this.userOctokit.paginate.iterator(
        this.userOctokit.rest.pulls.list,
        {
          owner,
          repo,
          state: "open",
          per_page: 100,
        }
      )) {
        for (const pr of response.data) {
          const body = pr.body ?? "";
          if (body.includes(MANAGED_MARKER)) {
            return mapPullRequest(owner, repo, pr);
          }
        }
      }
      return null;
    } catch (error) {
      throw wrapGithubError(
        "findOpenManagedPullRequest",
        { owner, repo },
        error
      );
    }
  }

  async findPullRequestByHead(
    owner: string,
    repo: string,
    headBranch: string,
    state: "open" | "closed" | "all" = "open"
  ): Promise<TrackedPullRequest | null> {
    const head = `${owner}:${headBranch}`;
    logger.debug("Looking up PR by head branch.", {
      owner,
      repo,
      head,
      state,
    });

    try {
      const { data } = await this.userOctokit.rest.pulls.list({
        owner,
        repo,
        head,
        state,
        per_page: 10,
      });
      if (data.length === 0) {
        return null;
      }
      return mapPullRequest(owner, repo, data[0]);
    } catch (error) {
      throw wrapGithubError(
        "findPullRequestByHead",
        { owner, repo, headBranch, state },
        error
      );
    }
  }

  async createPullRequest(params: {
    owner: string;
    repo: string;
    title: string;
    head: string;
    base: string;
    body: string;
  }): Promise<TrackedPullRequest> {
    logger.info("Creating pull request.", {
      owner: params.owner,
      repo: params.repo,
      head: params.head,
      base: params.base,
      title: params.title,
    });

    try {
      const { data: pr } = await this.userOctokit.rest.pulls.create({
        owner: params.owner,
        repo: params.repo,
        title: params.title,
        head: params.head,
        base: params.base,
        body: params.body,
      });
      return mapPullRequest(params.owner, params.repo, pr);
    } catch (error) {
      throw wrapGithubError("createPullRequest", params, error);
    }
  }
}

type GithubPull = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  user: { login: string } | null;
  state: string;
  base: { ref: string };
  head: { ref: string; sha: string };
};

function mapPullRequest(
  owner: string,
  repo: string,
  pr: GithubPull
): TrackedPullRequest {
  return {
    owner,
    repo,
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    htmlUrl: pr.html_url,
    authorLogin: pr.user?.login ?? "unknown",
    state: pr.state === "closed" ? "closed" : "open",
    baseRef: pr.base.ref,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
  };
}

function wrapGithubError(
  functionName: string,
  params: Record<string, unknown>,
  error: unknown
): Error {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? String((error as { status: unknown }).status)
      : "unknown";
  return new Error(
    `${functionName} failed (status=${status}, params=${JSON.stringify(params)}): ${message}`
  );
}
