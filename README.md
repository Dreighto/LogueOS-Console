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

## Locked Design References

Canonical visual sources in `project-miru` repo:
- `data/peer_reviews/logueos-map-and-plan.html`
- `data/peer_reviews/logueos-runs-tab.html`
- `data/peer_reviews/logueos-button-icon-system.html`

## Cross-repo Note

Worker rule canon (CLAUDE.md, AGENTS.md, .miru/) lives in the `project-miru` repo and is shared. Workers operating in this repo follow rules from there but write code here.
