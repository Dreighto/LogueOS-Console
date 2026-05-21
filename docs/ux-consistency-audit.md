# LogueOS Console UX Consistency Audit (LOS-112)

| Date       | Auditor          | Scope                      |
| :--------- | :--------------- | :------------------------- |
| 2026-05-20 | GMI (Gemini CLI) | LogueOS-Console /src audit |

## 1. Information Architecture & Navigation

### Findings

- **Tab Count (5):** Runs, Workers, Activity, Ask, Settings. Standard mobile-first bottom nav.
- **Header vs. Tab Labels:**
  - `Runs` tab (path: `/`) has heading "Recent Runs" in `src/routes/+page.svelte:61`.
  - `Workers` tab (path: `/workers`) has heading "Workers" in `src/routes/workers/+page.svelte:31`.
  - `Activity`, `Ask`, `Settings` match their headings exactly.
- **Nav/Action Separation:** Mostly clean. `Sync` button is an action inside the `Recent Runs` view (`+page.svelte:62`). Worker controls (Kill/Restart) are inside `WorkerCard.svelte`.

### Recommendations

- **Heading Alignment:** Rename "Recent Runs" to "Runs" in `+page.svelte` to match the bottom nav label and other pages.
- **Status Indicators:** The "Live" pulse in `workers/+page.svelte:36` is a good pattern. Consider bringing a similar "Syncing" or "Live" indicator to the main Runs feed header for consistency.

## 2. Naming & Terminology

### Lexicon Table

| Concept        | Current Variants     | Proposed Canonical Term | Rationale                                          |
| :------------- | :------------------- | :---------------------- | :------------------------------------------------- |
| Dispatch Event | Run, Dispatch, Trace | **Run**                 | Matches the `Runs` tab and `RunCard`.              |
| Identifier     | Trace ID, ID, Hash   | **Trace ID**            | Technically accurate for the system.               |
| Worker State   | State, Status        | **State**               | Used in `worker.ts` types and `WorkerCard.svelte`. |
| Ticket         | Ticket ID, Issue, ID | **Ticket ID**           | Matches Linear/Orchestrator terminology.           |
| Sync Action    | Sync, Refresh        | **Sync**                | Already used in the primary feed button.           |

## 3. Visual Consistency

### Findings

- **Color Usage:**
  - `src/app.css` defines theme tokens (e.g., `--color-surface: #161b22`), but components frequently use hardcoded hex values.
  - `RunCard.svelte:22`: `border-[#21262D] bg-[#161B22]`.
  - `WorkerCard.svelte:21`: `border-[#21262D] bg-[#161B22]`.
  - `+page.svelte:81`: `border-red-500/20 bg-red-500/5`.
- **Typography:**
  - `RunCard` uses `text-sm` for summary and `text-[11px]` for meta.
  - `WorkerCard` uses `text-lg` for title and `text-xs` for state.
  - Page headings vary between `text-xl` (`+page.svelte:61`) and `text-2xl` (`workers/+page.svelte:31`).
- **Component Duplication:** `RunCard` and `WorkerCard` have very similar layout logic but slightly different padding and internal spacing.

### Recommendations

- **Tokenize Styles:** Replace hardcoded hex values (`#161B22`, etc.) with Tailwind 4 theme tokens (`bg-surface`, `border-border`).
- **Standardize Headings:** Adopt `text-xl font-bold tracking-tight` as the standard for all top-level page headings.
- **Refactor Cards:** Create a shared `Card` base component or utility classes to ensure identical border, background, and hover behaviors.

## 4. Density vs. Legibility

### Findings

- **Density:** High, appropriate for an "Operator Console."
- **Legibility:** `text-[10px]` and `text-[11px]` are heavily used for metadata. On a mobile device, this may be too small for quick glancing.
- **Example:** `RunCard.svelte:60` uses `text-[11px]` for Trace ID, relative time, and PR number.

### Recommendations

- **Minimum Font Size:** Bump the baseline metadata size from `10px/11px` to `xs` (12px) where space permits.
- **Visual Hierarchy:** Use font-weight and opacity (e.g., `text-muted-foreground`) rather than extreme size reduction to differentiate primary vs. secondary data.

## 5. Discoverability & Gaps

### Findings

- **Missing States:** `Activity`, `Ask`, and `Settings` are placeholder-only.
- **Dead Code:** None obvious, but `RunCard.svelte:40` has a comment about deferred "Live in-flight state" logic.
- **Deep Links:** PR and Linear links in `RunDetail.svelte` are excellent for discoverability.

### Recommendations

- **Skeleton Screens:** Expand the use of `RunCardSkeleton` to other pages to maintain visual continuity during loads.
- **Empty States:** The empty state in `+page.svelte:89` is good. Ensure `workers/+page.svelte:50` uses the same visual pattern (currently uses hardcoded colors).

## 6. Interaction Polish

### Findings

- **Loading:** Handled via skeletons in main feed, but `WorkerCard` lacks a skeleton pattern.
- **Error States:** `+page.svelte` has a nice error block, but it uses hardcoded Tailwind red shades rather than a "destructive" or "error" token.
- **Feedback:** The `Sync` button spin animation is a great touch.

### Recommendations

- **Unified Status Tokens:** Use the `destructive` tokens from `app.css` for error blocks.
- **Consistent Transitions:** Standardize on `transition-all duration-200` for hover and state changes.

---

## Proposed Unified Design System

### Canonical Type Scale

- **Page Heading:** `text-xl font-bold tracking-tight`
- **Section Label:** `text-[10px] uppercase font-bold tracking-wider text-muted-foreground`
- **Body / Summary:** `text-sm leading-relaxed`
- **Metadata:** `text-xs font-mono`

### Color-Token Usage

- **Background:** `bg-background`
- **Surface/Card:** `bg-surface` or `bg-card`
- **Borders:** `border-border`
- **Primary Action:** `text-cta` / `bg-cta`
- **Muted Text:** `text-muted-foreground`

### Page-Header Pattern

```html
<div class="mb-4 flex items-center justify-between">
	<h2 class="text-xl font-bold tracking-tight">{PageTitle}</h2>
	{OptionalActionOrStatus}
</div>
```

## Prioritized Fix List

1. **[S] Tokenize Primary UI:** Replace hex codes in `RunCard` and `WorkerCard` with CSS variables. (Quick win, high impact for theme sync).
2. **[S] Heading Alignment:** Standardize page title sizes and labels.
3. **[M] Common Card Component:** Refactor shared card styles into a wrapper or global classes.
4. **[M] Metadata Bump:** Increase font size of metadata strings to `xs` (12px) for better legibility.
5. **[L] Implement P3/P5 Shells:** Start building out the `Activity` and `Settings` layouts to match the new design system.

---

**STATUS: CONFIRMED WORKING**
Audit complete. PR opened with `docs/ux-consistency-audit.md`.
