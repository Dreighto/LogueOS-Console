# Gemini CLI — LogueOS-Console Repo Overlay

This file applies when a Gemini session's working directory is inside the LogueOS-Console
repo (or one of its `LogueOS-Console-w*` worktrees) — most often a dispatch_listener worker
spawned in to do Console UI work. It layers on top of the global Gemini foundations in
`~/.gemini/skills/` (including the interactive co-working protocol, if this is an interactive
session rather than a headless dispatch).

It is a thin repo overlay. The interactive-session rules, ticket/PR authority, close-out
protocol, and boot context all live in the global skill `~/.gemini/skills/interactive-co-working.md`
and in `D:\dev\LogueOS-Orchestrator\.logueos\overlays\workflow-interactive.md`. Don't
duplicate them here.

---

## What this repo is

`Dreighto/LogueOS-Console` — the operator's mobile-first PWA console for the LogueOS
multi-agent system: worker cards, kill switch, usage tracker, Team Memory feed,
state-handoff-log viewer. SvelteKit. Local checkout `D:\dev\LogueOS-Console`.

## MCP servers in this workspace

`.gemini/settings.json` here wires the audited `logueos-gateway` (sole writes path: git /
Linear / docs / Notion, gated per the `X-LogueOS-Tool-Profile` header set at spawn time)
plus the frontend toolkit (`svelte`, `shadcn-svelte`, `lucide-icons`, `a11y-scanner`,
`vitest`, `playwright`) and `sequential-thinking`. Interactive sessions launched via the
operator's `gmi` shorthand already carry the full toolkit from the global config; this
workspace config is what makes the frontend toolkit available to dispatched workers landing
in a worktree here.

## Frontend craft

When touching Console UI:

- Typed contracts — no `any`. Explicit `loading` / `empty` / `error` states for every async
  surface.
- Dense operator-console aesthetic: mono font, 1px borders, maximize visible data points —
  not airy marketing spacing. The `operator-console-ui` skill covers this; the
  `frontend-systems-engineer` skill covers component discipline (audit for redundancy,
  micro-interactions, keyboard shortcuts, 4px/8px grid).
- Prefer SSR (`+page.server.ts` load functions) over client-side fetch-on-mount where it
  fits — the Console untangle moved data fetching server-side; keep it that way.
- New routes go under `src/routes/`; shared server logic under `src/lib/server/`; types
  under `src/lib/types/`.

## Repo boundary

Working on other repos under `D:\dev` from an interactive session is fine (you launched at
the umbrella). A headless worker dispatched into a Console worktree stays in that worktree —
if a task requires leaving it, stop and report.
