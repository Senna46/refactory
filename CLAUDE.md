# CLAUDE.md

Instructions for Claude Code when working on this codebase.

## Project Overview

refactory is a TypeScript job that, once a week, explores allowlisted
GitHub repositories, applies one behavior-preserving cleanup theme with
`claude -p`, and opens a Senna46-authored pull request against the
default branch.

It does not detect product bugs. Fixooly still fixes Cursor Bugbot
findings. bugbot-host still mirrors other people's PRs.

## Tech Stack

- Language: TypeScript (ES2022, Node16 modules)
- Runtime: Node.js >= 18
- Package Manager: npm
- GitHub API: Octokit (GitHub App for clone tokens, user PAT for PRs)
- State: SQLite (via better-sqlite3)
- Config: dotenv
- Cleanup engine: claude -p CLI with Read, Write, Edit, Glob, Grep, and limited Bash

## Project Structure

 src/
 main.ts            Entry point, lock, one cycle then exit
 config.ts          REFACTORY_* environment variable loader
 types.ts           Shared interfaces
 logger.ts          Structured logger with level support
 githubClient.ts    App + PAT Octokit wrapper
 gitOps.ts          Clone, dated branch, commit, push
 refactorRunner.ts  claude -p one-theme cleanup
 verify.ts          git diff --check and unsafe-path guard
 cycleRunner.ts     Per-repo skip / run / record
 schedule.ts        Last Sunday 00:00 JST helpers
 state.ts           SQLite refactor_runs table

## Build and Run Commands

 npm install
 npm run build
 npm start
 npm start -- --force
 npm run dev
 npm run typecheck

## Coding Conventions

- ESM modules: all imports use .js extension
- lowerCamelCase for variables, functions, properties, and methods
- Structured logging: logger.info("message", { key: value })
- Error messages include function context and relevant parameters
- Comments at file top describe purpose and limitations (in English)
- User-facing text (logs, GitHub comments) in English
- Git commit messages in English only
- Do not add JSDoc type definitions on TypeScript code

## Important Notes

- PRs MUST be created with REFACTORY_GITHUB_TOKEN (Senna46 PAT).
  GitHub App installation tokens would author the PR as a bot and Bugbot
  would skip them.
- Push also uses the PAT so GitHub webhooks fire for Bugbot.
- Clone/fetch uses the App installation token.
- The process exits after one cycle. launchd starts it on Sunday 00:00.
- `--force` is for the install-time trial and manual reruns.
- Do not pnpm-install target repositories as a "verify" step.
