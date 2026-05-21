# LogueOS Console — UX Cleanup Plan

**Date:** 2026-05-21
**Status:** Validated blueprint — implementation not yet started
**Tracking:** Linear LOS-112 (umbrella) + child tickets (see Ticket Map)
**Repo:** `Dreighto/LogueOS-Console` (operator PWA, port 18767)

---

## TL;DR

The console does not need redesigning — every screen has already been redesigned. It needs **unifying**: every screen made to follow one shared set of rules, plus a guardrail so it cannot drift apart again. This plan does that in three waves of low-risk work, and leaves three open questions for the operator.

## The diagnosis — why this, why now

The console works, and individual screens are fine. But it *reads* as unfinished because it was built across many separate per-screen tickets (LOS-44 density pass, LOS-75–80 plain-English redesigns, LOS-41 nav, LOS-111 animation) and **never had a pass *across* all of them.** The inconsistencies live in the gaps between those tickets. The fix is one cross-screen unification pass — not another redesign.

Confirmed two ways: a full code audit (CC, current code) and an independent audit (AGY / Gemini, LOS-112 / PR #55). Two different models, auditing separately, found the same six structural problems.

## What is wrong — current state

**1. Naming is inconsistent.**

- The job-dispatch feature has **four names**: nav tab "Ask", page title "Give the Team a Job", inner panel "Job Center", home-screen button "give the team a job". The "Ask" tab also wears a chat-bubble icon — implying a Q&A chat — but it opens a structured dispatch form.
- The home tab is labelled "Runs", but the page heading is "Team Heartbeat", and there is no actual runs list.
- **Four of six** nav tabs have a label that does not match the page's own heading (Runs→Team Heartbeat, Workers→Team, Activity→What's Happening, Ask→Give the Team a Job).

**2. Visual drift — built in layers, never unified.**

- Colour is done **three ways**: semantic theme tokens (defined in `src/app.css`), raw Tailwind shades (`text-slate-400` etc.), and hardcoded hex (`#161B22`, `#21262D`, `#8B949E`). The "theme-token cleanup" commit (#53) fixed some screens but not Workers, Activity, or Home.
- Every screen invents its own page-heading style and size (`text-lg` / `text-xl` / `text-2xl`; `font-sans` vs `font-mono`).
- The "Live" status pill is implemented twice with slightly different markup; `RunCard` and `WorkerCard` are near-duplicates with drifted spacing.

**3. Density vs. legibility.**

- Heavy use of 9–11px text (`text-[9px]`, `text-[10px]`, `text-[11px]`) for metadata and labels. Good for cramming data; hard to read at a glance on a phone.

**4. Leftovers and rough edges.**

- Dead theme tokens for retired workers (`--color-worker-codex`, `--color-worker-cursor`).
- Dead "desktop-width" responsive code (`md:` / `lg:` grid breakpoints) that can never trigger inside the phone-locked 480px shell.
- A style token `text-dim` is used on the Activity and Settings screens but is not defined in the theme — likely rendering as nothing.
- A cryptic `v1a` version badge in the header.
- The home screen hardcodes a worker rename (`w.id === 'gemini' ? 'Antigravity'`) instead of using the shared `workerLabel()` helper.
- The Usage / cost screen exists but is not in the navigation — only reachable via a small "Details" link.
- The Terminal screen was deliberately gutted (#45) — a known hole.

**What is genuinely good (keep it):** the "Pause Everything" kill switch (clear, colour-coded, confirm modal); empty states on every screen; the app-like polish (view transitions, skeletons, toasts); a solid, consistently-structured technical foundation.

## What the research says

A deep best-practice pass (mobile operator-console / observability-dashboard UX) produced the principles this plan follows:

- **Bottom nav: 3–5 items.** Six is one too many — it shrinks tap targets and exceeds quick-decision working memory.
- **Minimum mobile body text ~16px.** 14px "tests fine but strains in use." The console's 9–11px is well under.
- **Tab labels must match page titles** — mismatch causes measurable cognitive load; inconsistent labelling raises error rates ~48%.
- **One concept, one name.** Verb-first action labels; no ALL-CAPS labels (it *reduces* readability).
- **Density must earn its place** — group information that supports one decision; for a non-technical operator, ~12–15 elements visible at once.
- **Lead with "what needs my attention"**; translate technical terms into plain language.

## AGY's independent cross-check

AGY independently corroborated all six structural findings (colour drift, heading/tab mismatch, inconsistent typography, too-small text, component duplication, the need for a design system). It also contributed: a shared **Card** base component, a concrete **page-header pattern**, using the **destructive/error token** for error blocks, using **weight & opacity** for hierarchy instead of shrinking text, and **skeleton loaders** on more screens. (AGY's worktree was on a stale base, so its exact line numbers are dated — the structural agreement is the value.)

## The plan

Four parts, sequenced low-risk-first.

### Wave 1 — Quick wins (low risk, high impact)

The biggest jump in "intuitive" for the least effort — mostly find-and-replace.

- **Naming consistency.** One name per thing:
  - The dispatch feature → **"Jobs"** everywhere (nav tab, page title, panel header, home button). Swap the chat-bubble icon for a send/plus icon.
  - Every nav tab label = that page's own heading. Proposed: **Home, Team, Activity, Memory, Jobs, Settings**. The friendly phrases ("What's Happening", etc.) move to the small subtitle line under each heading — clear heading, warm subtitle.
- **Dead-code cleanup.** Remove retired-worker tokens; remove dead desktop-responsive code; fix or remove the broken `text-dim` token; drop the `v1a` badge; route the home worker-name through `workerLabel()`.

### Wave 2 — Visual unification

Kills the "unfinished" feel. Establish the shared system, then apply it everywhere.

- **Colour → one system.** Migrate all hardcoded hex and raw Tailwind shades to the semantic theme tokens already in `app.css`. Error blocks use the `destructive` token.
- **Typography + one page-header.** Adopt a single type scale; build one shared page-header component; apply it to every screen.
- **Component dedup.** Create a shared `Card` base (used by `RunCard`, `WorkerCard`); merge the duplicated "Live" pill into one component.

### Wave 3 — Settled (operator decisions, 2026-05-21)

- **Text-size floor** — raise the minimum: read-critical text ~13–14px, small labels ~11–12px, nothing below ~11px. Folded into LOS-116.
- **Navigation** — 6 tabs → 5: Settings moves to a header gear icon; the Usage/cost screen gets a discoverable entry. Ticket LOS-119.
- **Terminal screen** — retire it (remove the gutted route + leftover references; LOS-119). A proper rebuild is deferred as separate feature work (LOS-120).

### Guardrail — so it cannot drift again

The root cause was *no shared rulebook*. After Waves 1–2, add to the repo: the **naming lexicon** + a **colour-token usage rule** (and, ideally, a lightweight lint check). This is what makes the cleanup *stick*.

## Proposed design system

The shared rules Waves 1–2 establish.

**Type scale** (one typeface per role; sizes finalised by the Wave 3 density decision):

- Page heading — `text-xl font-bold tracking-tight`
- Section label — small uppercase, `font-bold tracking-wider text-muted-foreground` (final size set by the density decision; recommend ≥11px)
- Body / summary — `text-sm leading-relaxed`
- Metadata — `text-xs font-mono` (recommend a 12px floor, not 10–11px)

**Colour-token usage** (always tokens, never raw hex):

- Background `bg-background` · Surface/card `bg-surface` / `bg-card` · Borders `border-border` · Primary action `text-cta` / `bg-cta` · Muted text `text-muted-foreground` · Errors `destructive`

**Page-header pattern** (one component, every screen):

```svelte
<div class="mb-4 flex items-center justify-between">
  <h1 class="text-xl font-bold tracking-tight">{PageTitle}</h1>
  {OptionalActionOrStatus}
</div>
```

**Naming lexicon** (one term per concept):

| Concept                      | Use                  | Not                                  |
| ---------------------------- | -------------------- | ------------------------------------ |
| The dashboard / home screen  | Home                 | Runs, Team Heartbeat, Today          |
| The worker fleet screen      | Team                 | Workers                              |
| The event stream screen      | Activity             | What's Happening                     |
| Sending work to the team     | Jobs / "Send a job"  | Ask, Job Center, Give the Team a Job |
| A dispatch event             | Run                  | Dispatch, Trace                      |
| The identifier               | Trace ID             | ID, Hash                             |
| Worker status                | State                | Status                               |
| A Linear ticket              | Ticket ID            | Issue, ID                            |
| The refresh action           | Sync                 | Refresh                              |

## Ticket map

Filed under LOS-112 (umbrella). The seven rows below are filed as **LOS-113, LOS-114, LOS-115, LOS-116, LOS-117, LOS-118, LOS-119** (in row order).

| # | Ticket                                                              | Wave | Size |
| - | ------------------------------------------------------------------- | ---- | ---- |
| 1 | Naming consistency — one name per feature, tab labels match headings | 1    | S    |
| 2 | Dead-code cleanup — stale tokens, dead layouts, `text-dim`, `v1a`    | 1    | S    |
| 3 | Colour — migrate hardcoded hex / raw shades to theme tokens          | 2    | M    |
| 4 | Typography + shared page-header component                           | 2    | M    |
| 5 | Component dedup — shared Card base, single Live pill                 | 2    | M    |
| 6 | Guardrail — naming lexicon + token-usage rule in-repo                | —    | S    |
| 7 | Wave 3 — operator-decision items (density / nav / Terminal)          | 3    | —    |

Sequencing: Wave 1 (tickets 1–2) first; Wave 2 (3–5) after; the guardrail (6) once 1–2 land; Wave 3 (7) once the operator decides the three open questions.

## Decisions (settled 2026-05-21)

All three Wave 3 questions are decided — the operator went with the recommendations:

1. **Text-size floor** — raise the minimum: read-critical text (numbers, names, statuses) ~13–14px, small uppercase labels ~11–12px, nothing below ~11px; weight and opacity for hierarchy. → folded into **LOS-116**.
2. **Navigation 6→5** — Settings moves to a header gear icon, leaving Home / Team / Activity / Memory / Jobs; the Usage/cost screen gets a discoverable entry. → **LOS-119**.
3. **Terminal screen** — retire it: remove the gutted route and leftover references. → **LOS-119**. A proper rebuild is preserved as deferred feature work → **LOS-120** (backlog, not scheduled).

---

*Sources: CC console audit (current code, 2026-05-21) · deep UX research pass · AGY independent audit (LOS-112 / PR #55).*
