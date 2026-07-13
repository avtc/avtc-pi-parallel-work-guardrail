# avtc-pi-parallel-work-guardrail

Lets you block or approve agent-called git operations that would disrupt parallel work — worktree-aware, with auto-decide after timeout.

## Features

- **10 disruptive categories** — stash, checkout/restore, branch-switch, destructive reset, rebase, amend, merge/pull, push, redirect workarounds, and plumbing restore
- **5 modes, including hands-off auto-decide** — off, ask (prompt), block, or ask with auto-allow / auto-block after 15 min of no response
- **Worktree-aware** — 6 categories are allowed without a prompt inside a git worktree, since worktree-scoped ops don't collide with the main branch
- **Bypass-resistant** — disruptive ops can't slip past it via `git -C`, `--git-dir`, `--work-tree`, or by being buried in `&&`, `||`, `;`, pipes, or subshells
- **Confirmation dialog** — confirmable operations are routed through a prompt before they run

The confirmation dialog for a disruptive operation (routed via `showSelectWithNote`, auto-resolves to **Block** on timeout):

![select with note confirmation](assets/images/select-with-note.png)

## Categories

| Category | Blocked commands | Relaxed in worktree? |
|---|---|---|
| **Stash** | `git stash`, `stash push`, `stash pop`, `stash drop`, `stash clear`, `stash branch` | No |
| **Checkout/restore** | `git checkout --`, `git restore` | Yes |
| **Branch switch** | `git checkout`, `git switch` (all variants) | Yes |
| **Destructive reset** | `git reset --hard`, `reset --mixed <ref>`, bare `reset <ref>` | No |
| **Rebase** | `git rebase`, `git pull --rebase` (excludes --abort/--continue/--skip) | No |
| **Amend** | `git commit --amend` | Yes |
| **Merge** | `git merge`, `git pull` (non-rebase) | Yes |
| **Push** | `git push` | No |
| **Redirect workaround** | `git show ... > file`, `git cat-file ... > file` | Yes |
| **Plumbing restore** | `git checkout-index`, `git read-tree --reset -u` | Yes |

## Commands

| Command | Description |
|---|---|
| `/parallel-work-guardrail:settings` | Open the settings UI (guardrail mode selection) |

## Configuration

Settings are stored in `~/.pi/agent/avtc-pi-parallel-work-guardrail-settings.json` (global) or `<cwd>/.pi/avtc-pi-parallel-work-guardrail-settings.json` (project overrides win) and edited via `/parallel-work-guardrail:settings`. Requires [`avtc-pi-settings-ui`](https://github.com/avtc/avtc-pi-settings-ui) and [`avtc-pi-ui-components`](https://github.com/avtc/avtc-pi-ui-components) (installed automatically as dependencies).

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `parallelWorkGuardrail` | string | `"ask"` | Guardrail mode: `"off"` (skip all checks), `"ask"` (prompt user, waits indefinitely), `"block"` (auto-block every disruptive command), `"ask-allow-15m"` (prompt + auto-allow after 15m of no response), `"ask-block-15m"` (prompt + auto-block after 15m) |

## Installation

```bash
pi install npm:avtc-pi-parallel-work-guardrail
```

## Full suite

Check out the full suite of related extensions, [avtc-pi](https://github.com/avtc/avtc-pi) — deterministic feature development, subagent delegation, working-memory, behavioral learning, parallel-work guardrails, durable decisions, notifications, and more.

Developed with [Z.ai](https://z.ai/subscribe?ic=N5IV4LLOOV) — get 10% off your subscription via this referral link.

## License

MIT
