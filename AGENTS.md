# AGENTS.md

Guidelines for AI agents working on this codebase.

## Repository Purpose

This is **refactory**, a weekly job that opens one behavior-preserving
cleanup pull request per allowlisted repository. It does NOT detect bugs
and it does NOT merge those pull requests.

## Before Making Changes

1. Run `npm run typecheck` to verify the codebase compiles
2. Read the relevant source files before editing
3. Understand the flow (main.ts -> cycleRunner -> refactorRunner / gitOps)

## Code Style Rules

- TypeScript with strict mode enabled
- ESM modules with `.js` import extensions
- lowerCamelCase for all identifiers
- Every source file starts with a comment block describing purpose and limitations
- All user-facing text (logs, GitHub comments) must be in English
- Git commit messages must be in English only
- Use structured logging: `logger.info("message", { contextKey: contextValue })`
- Error handling must include detailed context
- Prefer readability over efficiency
- Do not add JSDoc type definitions on TypeScript code

## Module Dependency Graph

 main.ts
 -> config.ts
 -> logger.ts
 -> githubClient.ts
 -> state.ts
 -> cycleRunner.ts
    -> gitOps.ts
    -> refactorRunner.ts
    -> verify.ts
    -> schedule.ts
 -> types.ts (shared by all)

## Testing Changes

After any code change:

 npm run typecheck
 npm run build

## Environment Variables

All config uses the `REFACTORY_` prefix. Required:

- REFACTORY_APP_ID
- REFACTORY_PRIVATE_KEY_PATH or REFACTORY_PRIVATE_KEY
- REFACTORY_GITHUB_TOKEN (classic PAT as Senna46)

Target repositories come from `REFACTORY_REPOS`, not from every App installation.

## Common Tasks

### Adding a new config option

1. Add field to Config in types.ts
2. Parse it in config.ts loadConfig()
3. Add to .env.example with a documentation comment

### Changing Claude behavior

- Prompt and allowed tools: refactorRunner.ts
- Timeout: REFACTORY_CLAUDE_TIMEOUT (seconds)

### Changing the weekly skip rule

- schedule.ts hasCompletedThisSundayCycle()
