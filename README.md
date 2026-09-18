# refactory

Weekly, behavior-preserving refactoring for repositories that accumulate scattered UI pieces and helper functions from Cursor and Codex feature work.

The job starts every Sunday at 00:00 JST, looks at each allowlisted repository, picks **one** cleanup theme, and opens a pull request against the default branch. After install, run once with `--force` so the first trial does not wait until Sunday.

## Default allowlist

- `d6e-ai/d6e`
- `d6e-ai/d6e-auth`
- `d6e-ai/ai-gateway`
- `d6e-products/d6e-valuation`
- `d6e-ai/ai-keiri`

## Behavior

- One theme per repository per cycle. A huge monorepo is not rewritten in a single PR.
- Skip a repository when an open PR already contains `<!-- REFACTORY_MANAGED -->`.
- Skip a repository when `last_run_at` is at or after last Sunday 00:00 JST, unless `--force` (or `REFACTORY_FORCE=1`) is set. A Friday trial therefore still allows the coming Sunday run.
- Empty diff: no pull request.
- Verify is `git diff --check` only. Full `pnpm install` / test suites are not run here.
- Pull requests are created with a Senna46 PAT so Cursor Bugbot can review them.

## Run locally

```bash
cp .env.example .env
# fill REFACTORY_APP_ID, REFACTORY_PRIVATE_KEY_PATH, REFACTORY_GITHUB_TOKEN
npm install
npm run build
node dist/main.js --force
```

## launchd

See [deploy/README.md](deploy/README.md). The LaunchAgent uses `StartCalendarInterval` (Sunday 00:00). It does not poll.

## Configuration

All settings use the `REFACTORY_` prefix. See `.env.example`.
