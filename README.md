# LogueOS Console

The operator-facing dashboard for the LogueOS multi-agent dispatch loop.

**Stack:** SvelteKit + Svelte 5 (runes) + TailwindCSS + shadcn-svelte + LayerChart + lucide-svelte

**Status:** Bootstrap phase. See LOS-1 in Linear for the P1a build spec (5-tab nav shell, hero metrics, dispatch chain visualization, activity feed, run-detail screens).

## Relationship to other repos

| Repo | Purpose |
|------|---------|
| [Dreighto/project-miru](https://github.com/Dreighto/project-miru) | The dispatch loop runtime (workers, gateway, audit logs, Hermes shadow predictor). All worker rule files (CLAUDE.md, AGENTS.md, `.miru/overlays/`, `.miru/reference/`) live here — they are the canon for any repo any worker operates in. |
| **Dreighto/LogueOS-Console (this repo)** | The dashboard that watches the loop. Reads dispatch state via the dispatch_listener API (port 19100) and the `miru_memory.db` SQLite store. Writes nothing to project-miru's runtime. |
| [LogueOS framework docs](https://github.com/Dreighto/LogueOS) (planned) | The methodology framework that Project Miru runs on. Currently lives at `D:\dev\LogueOS\` as 7 markdown docs; not yet a separate repo. |

## How workers operate on this repo

Workers dispatched against LOS tickets land in `D:\dev\LogueOS-Console-w*` worktrees, separate from the `D:\dev\miru-w*` pool. They load worker-rule canon from the project-miru repo (CLAUDE.md, AGENTS.md, etc.) but write code into this repo only. PRs land here. CI lives here.

See `.miru/reference/source-of-truth.md` in project-miru for the full truth hierarchy and multi-repo dispatch model.

## Getting started

Once LOS-1 ships, this README will be replaced with proper SvelteKit-project quickstart instructions (`pnpm install`, `pnpm dev`, etc.).
