# LogueOS Console — Design System

One rulebook so the console doesn't drift apart again.

Every screen of this console was redesigned separately over time, and the
screens slowly diverged: different colours for the same thing, five different
heading styles, near-duplicate components. The **LOS-112 cleanup** (Waves 1–3)
unified them. This document is the guardrail that keeps them unified.

**If you add or change a screen, follow these rules.** The colour rule is
enforced mechanically by `npm run check:drift`; the rest is convention plus
code review.

---

## Naming lexicon — one term per concept

The same thing must be called the same name in the nav tab, the page heading,
the panel header, and any button that points to it.

| Concept                       | Use                     | Not                                  |
| ------------------------------ | ----------------------- | ------------------------------------ |
| The dashboard / home screen    | **Home**                | Runs, Team Heartbeat, Today          |
| The worker fleet screen        | **Team**                | Workers                              |
| The event stream screen        | **Activity**            | What's Happening                     |
| Sending work to the team       | **Jobs** / "Send a job" | Ask, Job Center, Give the Team a Job |
| A dispatch event               | **Run**                 | Dispatch, Trace                      |
| The run identifier             | **Trace ID**            | ID, Hash                             |
| Worker status                  | **State**               | Status                               |
| A Linear ticket                | **Ticket ID**           | Issue, ID                            |
| The refresh action             | **Sync**                | Refresh                              |

The page heading is the plain noun from this table. The warm phrasing
("What's happening", etc.) belongs in the subtitle line under the heading —
never in the heading itself.

---

## Type scale

One typeface per role. Build hierarchy with **weight and opacity**
(`text-muted-foreground`), never by shrinking text below the floor.

| Role          | Classes                                                          |
| ------------- | ---------------------------------------------------------------- |
| Page heading  | `text-xl font-bold tracking-tight` (use `PageHeader.svelte`)     |
| Section label | `text-xs font-bold tracking-wider uppercase text-muted-foreground` |
| Body / summary | `text-sm leading-relaxed`                                       |
| Metadata      | `text-xs` — `text-xs font-mono` where it is data                 |

**Text-size floor (operator decision, 2026-05-21): nothing below ~11px.**

- Standard small text → `text-xs` (12px).
- The smallest size permitted → `text-[11px]`, and only for dense data-viz labels.
- `text-[10px]`, `text-[9px]` and smaller are **banned**.

---

## Colour — always tokens, never raw values

Colour is defined **once**, in `src/app.css` (the `@theme` block). Components
reference the **semantic tokens** only — never a hardcoded hex value, never a
raw Tailwind shade.

| Use                     | Token                                                    |
| ----------------------- | -------------------------------------------------------- |
| Page background         | `bg-background`                                          |
| Card / panel surface    | `bg-surface` (alias `bg-card`)                           |
| Borders                 | `border-border` (and `divide-border`)                    |
| Primary text            | `text-foreground`                                        |
| Muted / secondary text  | `text-muted-foreground`                                  |
| Primary action          | `text-cta` / `bg-cta`                                    |
| Errors                  | `destructive`                                            |
| Status colours          | `status-green` / `-amber` / `-red` / `-blue` / `-purple` |

**Banned in `src/**/*.svelte`:**

- A hex value inside an arbitrary class — `bg-[#161b22]`, `divide-[#30363d]`,
  `shadow-[0_0_4px_#22c55e]`.
- A raw Tailwind shade utility — `text-slate-400`, `border-gray-700`,
  `bg-blue-500`.

If a colour you need has no token, **add the token to `app.css` first**, then
use it. An arbitrary value may reference a token via a CSS variable —
`shadow-[0_0_4px_var(--color-status-green)]`.

The only places literal colour values are allowed: `src/app.css` (defines the
tokens) and the colour-data files (`src/lib/styles/colors.ts`,
`src/lib/config/workers.*` — deliberate worker-identity colour data).

### Known exceptions — not yet migrated

The drift check scans utility classes only. These pre-date the cleanup and are
tracked for a follow-up pass:

- `<style>` blocks in `+layout.svelte` and `RunDetail.svelte` — scrollbar /
  body-background CSS still uses literal hex.
- `WorkerCard.svelte` — three worker-state hex values live in the component
  script (`#3B82F6` etc.); they belong in the colour-data layer.

---

## Shared components — use them, don't re-roll them

| Component            | Use for                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `PageHeader.svelte`  | Every screen's heading — title + optional subtitle + optional right slot. |
| `Card.svelte`        | Any bordered surface card. Renders as a link when given `href`.          |
| `LivePill.svelte`    | The ambient green "Live" indicator.                                     |

Do not hand-write a heading, a card border, or a status pill. If you find
yourself copying one, that is drift — reuse or extract instead.

---

## The drift check

`npm run check:drift` scans `src/**/*.svelte` for the banned hardcoded colours
above and fails if it finds any. **Run it before opening a console PR.**

It is not yet wired into CI — this repo has no CI workflows. Automating it
(and the residual-hex cleanup above) is tracked as a follow-up to LOS-118.
