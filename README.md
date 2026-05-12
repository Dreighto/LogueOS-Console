# LogueOS Console

Operator-facing dashboard for LogueOS dispatch loop. Mobile-first, 5 tabs, SvelteKit + Svelte 5 runes + TailwindCSS + shadcn-svelte + lucide-svelte + LayerChart.

## How to run

```bash
npm install
npm run dev
```

(pnpm is preferred if available in your environment).

## Roadmap

- **P1a: Shell + 5-tab nav (current)** - Foundation with placeholder content and design system.
- **P1b: Runs data** - Real data wiring + run cards.
- **P1c: Run detail** - Detail view + waterfall view.
- **P2: Workers** - Worker roster, heartbeat, and control actions.
- **P3: Activity** - Cross-system event chronology.
- **v1.5: Ask** - Conversational layer over data.
- **P5: Settings** - Configuration and global controls.

## Data sources

This dashboard reads from the LogueOS Orchestrator's filesystem (the "kernel")
at the paths below. Both repos must be checked out on the same machine for
local dev to work.

| Env var | Default | Purpose |
| :--- | :--- | :--- |
| LOGUEOS_COMPLETION_LOG_PATH | D:\\dev\\LogueOS-Orchestrator\\data\\cc_completion_log.jsonl | Source for the Runs feed (P1b) |
| LOGUEOS_WORKER_LOG_PATH | D:\\dev\\LogueOS-Orchestrator\\logs\\dispatch_listener_stdout.log | Source for the Workers/Activity feed (P2) |
| LOGUEOS_RUN_POLL_MS | 5000 | How often the feeds re-fetch |
| LOGUEOS_RUN_FEED_LIMIT | 50 | Most recent N rows shown |

Future P-tickets will add Linear and GitHub API integrations + WebSocket
for live in-flight state. Current implementation uses read-only filesystem polling.

## Locked Design References

Canonical visual sources in the LogueOS ecosystem:
- `D:\\dev\\LogueOS-Orchestrator\\data\\peer_reviews\\logueos-map-and-plan.html`
- `D:\\dev\\LogueOS-Orchestrator\\data\\peer_reviews\\logueos-runs-tab.html`
- `D:\\dev\\LogueOS-Orchestrator\\data\\peer_reviews\\logueos-button-icon-system.html`

## Cross-repo Note

Worker rule canon (CLAUDE.md, AGENTS.md, .logueos/) lives in the `LogueOS-Orchestrator` repo and is shared. Workers operating in this repo follow rules from there but write code here. Project-specific rules (like those for `project-miru`) layer on top when a worker is dispatched to a project worktree.
