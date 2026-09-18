# refactory job (launchd)

Run refactory every Sunday at 00:00 (Mac timezone; plist also sets `TZ=Asia/Tokyo`).
The process starts, processes the allowlist, and exits. It does not stay resident.

## Prerequisites

- `.env` configured (copy from `.env.example`)
- `npm run build` completed
- `claude` CLI installed and on PATH (`~/.local/bin` is included)

## Install

From the project root:

```bash
chmod +x deploy/install-daemon.sh deploy/run-once.sh
./deploy/install-daemon.sh
./deploy/run-once.sh
```

`run-once.sh` is the install-time trial (`--force`). It can take a long time
because each repository gets up to 45 minutes of `claude -p`.

## Commands

| Action | Command |
| --- | --- |
| Check status | `launchctl list \| grep refactory` |
| Manual run | `./deploy/run-once.sh` |
| Unload | `launchctl unload ~/Library/LaunchAgents/com.senna.refactory.plist` |
| View stdout | `tail -f ~/.refactory/logs/stdout.log` |
| View stderr | `tail -f ~/.refactory/logs/stderr.log` |

## Update after code changes

1. `npm run build`
2. No restart is required; the next Sunday start uses the new `dist/`.

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.senna.refactory.plist
rm ~/Library/LaunchAgents/com.senna.refactory.plist
```
