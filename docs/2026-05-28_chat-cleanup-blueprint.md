# Chat Surface — Cleanup & Efficiency Blueprint

**Date:** 2026-05-28
**Author:** CC (VP Ops)
**Status:** Proposed — execution authorized by operator (blueprint-first, then in order)
**Trigger:** The chat surface grew rapidly (SDK-foundation track + bridge + voice +
tools + Canvas + workspace context). Operator directive: "compile and clean up
code to make it run more efficiently."

---

## Current state (measured 2026-05-28, live `main`)

| Signal | Value | Note |
|---|---|---|
| `src/routes/chat/+page.svelte` | **2,194 LOC** | The monolith. Largest file by far. |
| `src/routes/settings/+page.svelte` | 946 LOC | Secondary monolith (out of scope for now) |
| `src/routes/api/chat/sdk-stream/+server.ts` | 597 LOC | The live streaming endpoint (SDK 6) |
| `src/routes/api/chat/+server.ts` | 576 LOC | **Legacy** non-SDK endpoint — cutover candidate |
| `src/routes/api/chat/stream/` | exists | **Legacy custom-SSE** route — dead-code candidate |
| `TIER_MODELS` map | duplicated | Copy in `sdk-stream/+server.ts` AND `llm_router.ts` |
| `svelte-check` errors | **9** | Web Speech types, route typing, settings Uint8Array |
| `eslint` problems | **76** | unused-props, prefer-const, a11y, etc. |

Baseline preserved: every E2E chat path passes today (9/9 audit, 2026-05-28).
This cleanup must keep that green — each workstream re-runs the
`chat-surface-harness` E2E sweep before merge.

---

## Workstreams (execution order)

### 0. Blueprint (this doc) — DONE
Reviewed by operator before any code change.

### 1. Dead-code removal  ·  one PR  ·  LOW risk
**Pre-flight done (2026-05-28).** Findings:
- `/api/chat/stream/[trace_id]` (custom-SSE, `text/event-stream`) — **0 callers**
  (only an internal comment mentions EventSource). **CONFIRMED DEAD → delete.**
- `/api/chat/+server.ts` — **NOT dead.** The client still uses GET (`?thread=`
  read), DELETE (`?id=` remove message), AND POST (non-streaming/dispatch path,
  `+page.svelte` lines 630/1171/1666). **KEEP.** The earlier assumption that the
  legacy POST was superseded was wrong — only the *streaming* path moved to
  `sdk-stream`; the non-streaming `/api/chat` path is still live.
- **Action:** delete `src/routes/api/chat/stream/` only. **Rollback:** revert PR.

### 2. De-duplicate `TIER_MODELS`  ·  its own careful PR  ·  MED risk (deferred)
NOT a trivial import — the two copies use **different provider vocabularies**:
`llm_router.ts` uses `anthropic`/`gemini`/`ollama` (and is not exported);
`sdk-stream/+server.ts` uses `anthropic`/`google`/`local`. Unifying them means
reconciling the two `Provider` type systems, exporting a single source, and
re-running all 5 provider paths through the E2E harness. Do as a focused PR,
NOT bundled with a deletion.

### 3. Lint / type hygiene baseline  ·  one PR  ·  LOW risk
Clear the 9 `svelte-check` errors + the 76 eslint problems so the typecheck/lint
gate is green and future changes surface *real* regressions instead of drowning
in pre-existing noise.
- Web Speech API types (`SpeechRecognition`) — add lib augmentation.
- Route-typing strictness in `chat/+page.svelte`.
- `settings/+page.svelte` `Uint8Array` push-key typing.
- `svelte/no-unused-props`, `prefer-const`, a11y nits.
- **No behavior change** — types/lint only. E2E sweep confirms.

### 4. Finish Task #7 — decompose `chat/+page.svelte`  ·  1+ PRs  ·  MED-HIGH risk
The 2,194-line monolith. Task #7 already extracted WorkspaceContextModal,
ThreadsSidebar, ChatHeader, Composer (PRs 1–4 of 5). **PR 5 of 5** is the
remaining extraction. Continue pulling cohesive units out of `+page.svelte`:
- streaming/transport orchestration → a `.svelte.ts` module
- thread CRUD + draft cache → a store module
- voice/talkback state machine → its own module
- keep `+page.svelte` as thin composition + layout
- **Risk:** this is runes-mode reactive code (`$state`/`$effect`/
  IntersectionObserver/stream buffers) — follow `svelte-5-runes-disciplinarian`;
  re-run the full E2E harness after each extraction; ship small PRs, not one big
  bang.

### Roadmap (NOT this pass)
- **Tool-calling on the CLI bridge.** Sonnet/Opus route through `claude --print`,
  which doesn't carry SDK tool definitions, so tools work only on Haiku/Gemini/
  Local today. Enabling tools on the bridge models is a feature, not cleanup.

---

## Definition of done (per workstream)
1. `npm run build` clean.
2. `prettier --check` + `eslint` clean on changed files (and the app-wide count
   strictly decreases for the hygiene PR).
3. `svelte-check` introduces no new errors (decreases for the hygiene PR).
4. `chat-surface-harness` E2E sweep re-run: all model paths + thread CRUD +
   tools + repo switch still pass.
5. PR merged, branch pruned, repo on clean `main`.

## Success metrics (before → target)
- `chat/+page.svelte`: 2,194 LOC → < ~1,200 (thin composition).
- `svelte-check` errors: 9 → 0.
- `eslint` problems: 76 → 0.
- Dead chat routes: 1 removed (`/api/chat/stream` custom-SSE); `/api/chat` retained (GET/DELETE/POST still in use).
- `TIER_MODELS` copies: 2 → 1.
