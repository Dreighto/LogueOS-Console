# Proposal: Multi-Repo Chat Composer Revamp & Resilient UX

## Status: Locked — Mixed-Worker Execution (CC + AGY per PR-by-PR fit)
**Author:** Antigravity (AGY), Claude Code (CC) & Captain (Dreighto)  
**Date:** 2026-05-25  
**Target Repositories:** `LogueOS-Console` (UI and state), `LogueOS-Orchestrator` (dynamic targeting)

---

## 1. Problem Statement & Goals
The current `chat` interface inside `LogueOS-Console` (`src/routes/chat/+page.svelte`) is a powerful, multi-agent co-working interface, but it suffers from several visual and operational pain points:
1. **Vertical Chrome Clutter:** The top bar, global system command bar, bottom navigation, starter prompts, and agent pills take up over **110px of vertical space** before a single message is rendered. This is highly restrictive on mobile viewports.
2. **Hardcoded Repository Scope:** The workflow actions (Critique, Build, Verify, Retry) are hardcoded to the `'LogueOS-Console'` repository in backend dispatches. To use the chat as a primary hub for all project work, the target repository must be dynamically switchable.
3. **Connectivity Vulnerability:** Running the Console over Tailscale on mobile devices means cellular dropouts are common. Unsent message drafts can be lost on connection drop, and scroll positions can snap or jitter unexpectedly.

---

## 2. Proposed System Design

### A. The "Unified Composer Capsule" (Bottom Input Controls)
To ensure maximum ease of access, the bottom input bar is a fully integrated, single-row capsule (as shown in the `chat_composer_mockup` visual). The operator has direct access to all necessary input modalities without visual clutter:

*   **Pills & Routing:** The **Agent Selector** (`🤖 Auto`) and **Repository Selector** (`📁 Console`) badges sit cleanly in the bottom-left corner of the input area.
*   **Asset Attachment (Paperclip):** A dedicated paperclip button sits on the right, allowing the operator to upload and attach images directly from their device or paste/drop them into the text area.
*   **Image Mode Toggle (`✨` Sparkles):** Clicking the sparkles button activates Gemini-powered image generation. When active, the composer's outer border pulses with a subtle green highlight, visually confirming that the next prompt will generate a visual mockup.
    *   *Scoping Rule:* Image uploads are routed globally via `/api/chat/uploads` to the Console's database, but the prompt context is evaluated on behalf of the selected repository workspace.
*   **Voice Dictation Microphone Icon (`🎙️`):** Dictation microphone sits inside the text input capsule on the far right (acting as standard vocal text input).
*   **Hands-Free Walkie-Talkie Toggle (`🎧`):** Sits just outside the input box capsule next to the sparkles `✨` button to toggle Talkback Mode.

### B. Mobile-First Ultra-Compact Layout & Auto-Observation
To maximize screen space on high-end mobile viewports like the iPhone 16 Pro Max, we will replace the bulky multi-row headers with an **Ultra-Compact Single-Row Header** that remains permanently active.

1.  **Single-Row Minimalist Header (Chat-Only):** 
    *   This compact header is **explicitly Chat-only (`/chat` route)**. Other routes (Home, Workers, Settings) retain their full-size brand headers to preserve system identity and ease of navigation.
    *   Implementation: `src/routes/+layout.svelte` utilizes route-aware Svelte branching:
        ```typescript
        const headerStyle = $derived(page.url.pathname === '/chat' ? 'compact' : 'full');
        ```
    *   In the `compact` state, we eliminate the large "LogueOS Console" text header and the system command bar entirely in chat mode. This saves **84px** of top header (48px) and system command bar (36px) height while keeping the 32px bottom nav always visible to ensure perfect tab switching.
    *   We render a highly compact **32px header**: just the small, colorful logo (`favicon.png`) on the far left, a tiny `Default ▾` thread switcher in the center, and a subtle `Reset Context` icon-button on the far right.
    *   This provides an **instant, zero-animation vertical savings of over 84px** without requiring complex hide-and-reveal animations or risking keyboard-appearance collisions on iOS Safari.
2.  **Compact Activity Micro-Tracker:** When a worker is active, a thin, sleek progress badge slides in right below the minimalist header (e.g., `⚡ CC: Editing 'vite.config.ts'... [View Logs]`). This gives complete, real-time feedback while using less than 16px of height.
3.  **Smart Tab Autofocus & Deep Linking:** Tapping `[View Logs]` automatically navigates the user to the dedicated `/activity` tab (to observe full-screen CLI logs). To support robust deep-linking and match native browser behaviors, navigation back to the chat is handled via standard browser history navigation (`history.back()`).

### C. Offline Resilience & Syncing
To protect against mobile network dropouts over Tailscale, we will build three client-side safeguards:

1.  **Non-Blocking Local Draft Caching:** Rather than writing on every keystroke (which blocks the main thread), we will implement a reactive `$state<Map<string, string>>` containing all thread drafts. A single debounced effect (~300ms) will flush the serialized map to a single `localStorage` key. Restoration happens implicitly via map lookup whenever the `activeThread` changes.
    *   *Cross-Device Sync:* Drafts are device-local by default in PR 1. A server-synced draft storage via a lightweight `/api/chat/drafts` backend endpoint is scheduled as a future Phase 2 enhancement.
2.  **Connection Status Dot:** Render a tiny indicator dot inside the input capsule wired to the existing EventSource connectivity events. Green for online, pulsing amber for Tailscale reconnecting. If a send fails, the prompt is retained in the text area so it can be retried.
3.  **Forced-Layout Scroll Lock:** To eliminate heavy scroll-event layout calculations, we will attach an `IntersectionObserver` to a sentinel `<div>` at the feed bottom. The feed will not automatically yank the viewport down unless the user is actively intersecting the bottom. If offline activity occurs, the app renders an `--- Unread Messages ---` divider and displays a floating `X new messages ↓` pill.
4.  **iOS Input Hygiene:** The composer `<textarea>` will have an explicit `text-base` (16px) minimum font-size to prevent automatic iOS Safari viewport zooming on focus.

### D. Native Voice Integration (Speech-to-Text via AssemblyAI, Read-Aloud via Browser)
We will use a two-provider split that funds STT with existing credits and keeps TTS free and offline-capable.

1.  **Speech-to-Text (Voice Dictation) — AssemblyAI proxy:** Tapping the microphone icon in the composer starts a browser `MediaRecorder` capture (supported on iOS Safari 14+). On mic-button release, the audio blob is POSTed to a new Console endpoint `/api/chat/transcribe`, which proxies to AssemblyAI's async transcription API using `ASSEMBLY_AI_API_KEY` (sourced from `.env`). The returned transcript text is appended to the composer.
    *   *Initial implementation:* Async (single POST after release, ~500ms latency post-release).
    *   *AssemblyAI Daily Minute Cap:* Checked inside `/api/chat/transcribe`, we enforce a default rate-limit of **30 minutes/day** of active transcription (`ASSEMBLYAI_DAILY_MINUTE_CAP` in env), returning a `429 Too Many Requests` code if exceeded to prevent runaway credit depletion.
2.  **Speech Synthesis (Voice Read-Aloud) — ElevenLabs proxy:** A speaker icon next to worker replies POSTs the reply text to a new Console endpoint `/api/chat/speak`. The endpoint proxies to ElevenLabs using `ELEVENLABS_API_KEY` from env, streams MP3 back, and the client plays it in a single persistent `<audio>` element (reused across replies, never re-created — important for iOS gesture-unlock continuity).
    *   **Voice locked:** Emma (`voice_id: 56bWURjYFHyYyVf490Dp`). Australian female, conversational, mid-age. Chosen on iPhone audition.
    *   **Model locked:** `eleven_turbo_v2_5` (50% credit discount, ~400ms latency).
    *   **Proxy Security & Authentication:** The `/api/chat/speak` endpoint will validate Console JWT/session authorization headers to prevent unauthenticated public abuse of ElevenLabs credits.
    *   **Rate-Limiting Cost Protection:** We enforce a daily cap (`ELEVENLABS_DAILY_CHAR_CAP` in env, defaulting to `50000` characters per day, or ~$5 USD worst-case), returning `429 Too Many Requests` if exceeded. A small text indicator (e.g., `ElevenLabs: 12.4k / 50.0k chars today`) will be rendered in the Settings page via a new `/api/chat/speak/status` endpoint.
3.  **Hands-Free "Talkback Mode" (Walkie-Talkie Loop):** A dedicated toggle button next to the microphone dictation icon triggers an automated state machine loop for seamless on-the-go voice iteration:
    *   *Step A (Capture):* The microphone records your spoken voice. Detects silence/pauses or button-release to automatically stop.
    *   *Step B (Transcribe):* Automatically POSTs the audio blob to `/api/chat/transcribe` for rapid background transcription.
        *   *Realtime Streaming:* Realtime WebSocket streaming with AssemblyAI is mandatory here to prevent 2-4s of dead air per conversational turn.
    *   *Step C (Dispatch):* Auto-submits the returned text to `/api/chat` targeting the selected agent (e.g. AGY or CC). **Model locked to Gemini Flash-lite via AGY OAuth** (with `GEMINI_API_KEY` fallback only on OAuth failure) — server-side enforced regardless of the thread's normal §2F tier. Rationale: walkie-talkie loops generate many short replies; Flash-lite is the cheapest constant-behavior model with predictable cost ceiling. Cross-references §2F locked decision #7.
    *   *Step D (Speak):* Svelte page listener captures the resulting agent text, POSTs it to `/api/chat/speak` (the §2D.2 ElevenLabs proxy), receives MP3 audio, and plays it via the single persistent `<audio>` element.
    *   *Step E (Loop):* The second playback ends, a small chime plays, and the PWA auto-arms the microphone to listen for your next response, repeating the cycle.
4.  **iOS Safari & Talkback Safety Caveats:**
    *   **Audio-element user-gesture lock:** On iOS Safari, `audio.play()` requires a user gesture. **Mitigation:** We "unlock" the audio element by playing a 1-frame silent base64 WAV within the initial Talkback-toggle click handler. Subsequent async plays succeed. Verified on iPhone 16 Pro Max via standalone `/voice_test.html` test.
    *   **Screen-sleep / background suspension:** iOS pauses PWA JS when screen sleeps. **Mitigation:** request `navigator.wakeLock.request('screen')` (Screen Wake Lock API, iOS 16.4+) on toggle-on, release on toggle-off. The phone must stay face-up and unlocked.
    *   **Echo / feedback loop:** Built-in speaker + mic loop. **Mitigation:** require earbuds for Talkback, or pass `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })`.
    *   **Privacy & "Listening" UI:** Mic is hot for long stretches. We display a prominent "🔴 LISTENING" indicator in-UI while active.
    *   **Emergency Stop:** Always-visible "STOP TALKBACK" button + voice-activated stop word ("stop", "cancel") monitored client-side.
    *   **Talkback Safety Auto-Stop:** Talkback automatically deactivates and releases mic controls after **3 minutes of continuous silence**, 3 consecutive transcription errors, or OS-level mic focus change to prevent credit drainage.

### E. PWA Push Notifications (Web Push API)
Since the console operates over Tailscale and triggers long-running background agent workflows, we will implement native push notifications.

1.  **VAPID Key Generation:** VAPID keys are generated once via `pywebpush` CLI on the server. The public key is shipped to the Console client via SSR during initial page load, and the private key is securely stored in `LogueOS-Orchestrator/.env`.
2.  **Server-Side Library:** We will use `pywebpush` in the Orchestrator backend to sign and dispatch push notification payloads.
3.  **Subscription Endpoint Persistence:** A new SQLite table `web_push_subscriptions` is created in `logueos_memory.db` to persist subscription payloads per device:
    ```sql
    CREATE TABLE web_push_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT UNIQUE NOT NULL,
        subscription_json TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    ```
4.  **Service Worker Registration:** SvelteKit's native `src/service-worker.ts` is extended to register a `push` event listener (do NOT create `/static/service-worker.js` as it conflicts with SvelteKit auto-registration). The service worker triggers the native alert:
    ```javascript
    self.addEventListener('push', (event) => {
        const data = event.data.json();
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/favicon.png',
            vibrate: [100, 50, 100],
            data: { url: data.url }
        });
    });
    ```
5.  **Permission UI Flow:** Tapping a "Enable Push Alerts" toggle on the **Settings** page triggers the native browser notification permission prompt.
6.  **iOS-Specific Quirks:** Apple's Web Push requires the operator to have home-screen-installed the PWA *and* launched it at least once since the device last rebooted. A warning explaining this behavior is detailed inline within the Settings page toggle.

---

### F. Server-Driven Model Routing with Auto-Escalation (Multi-Provider)

The chat tab routes model choice on the **server side** based on the detected conversation phase. The operator drives intent (talking vs planning); the server picks the right model. No manual picker pill required for the default path — but a manual override pill IS available for when the operator wants explicit control.

**Locked design decisions (2026-05-26):**

1.  **Default chat tier is FAST** (Haiku 4.5 / Gemini Flash-lite equivalent). All casual chat lives at this tier.
2.  **Server auto-escalates** when the conversation phase shifts into planning / architecture / multi-step reasoning. Server detects the shift; client doesn't ask.
3.  **Operator override pill** lets the operator manually lock a tier (Quick / Planning / Deep) — overrides auto-escalation for that thread.
4.  **OAuth is primary for ALL providers; API keys are fallback.** Save metered API-key allotment for when OAuth fails or quota is exhausted.
5.  **Gemini API key is RESERVED for image generation only** (faster pathway, dedicated bucket). Chat through Gemini uses AGY's OAuth.
6.  **Server-side persistence** — current tier + auto-escalation state stored in `logueos_memory.db` keyed by thread_id. Cross-device consistent: switching from laptop to phone preserves thread state.
7.  **Talkback (§2D.3) is hard-locked to Flash-lite via Gemini OAuth** (API key fallback only). Walkie-talkie loop generates many short replies; the cheapest fast model with constant behavior is the right fit; explicit bucket so cost ceiling is predictable.

**Tier definitions:**

| Tier | Default model | Triggers when... | Auth source (primary → fallback) |
|---|---|---|---|
| 🪶 **Chat** (default) | Claude Haiku 4.5 / Gemini Flash-lite | Default state. Short messages, casual exchange. | Anthropic: Claude Max sub via `MIRU_ROUTING_KEY` ‖ Gemini: AGY OAuth → `GEMINI_API_KEY` (only if OAuth fails) |
| ⚖️ **Planning** | Claude Sonnet 4.6 / Gemini 2.5 Flash | Phase shift detected (planning / design / multi-step). | Anthropic: Claude Max sub ‖ Gemini: AGY OAuth → `GEMINI_API_KEY` |
| 🧠 **Deep** | Claude Opus 4.7 / Gemini 2.5 Pro | Phase shift detected (architecture / hard judgment / deep analysis). | Anthropic: Claude Max sub ‖ Gemini: AGY OAuth → `GEMINI_API_KEY` |
| 🔧 **Local** | Qwen 14b (Ollama) | Operator explicit override (offline / privacy). | Ollama local, no auth |

**Phase-detection heuristics (server-side, in `src/lib/server/phase_classifier.ts`):**

The classifier inspects each incoming user message + last 3 assistant messages and outputs a tier label. Cheap, deterministic, runs synchronously before model dispatch (sub-10ms):

*   **Length signal:** messages > 280 chars OR multi-paragraph → suggests planning.
*   **Keyword signal:** triggers shift on phrases like "let's plan", "let's design", "architecture", "think through", "walk me through", "what do you think about", "compare these", "deep dive".
*   **Conversational depth signal:** if last 4 turns have been escalating (each reply longer than the previous), shift up.
*   **Explicit override:** operator manual pill locks the tier regardless of heuristics.
*   **Persistence:** once a thread shifts to Planning/Deep, it STAYS there for the rest of the thread (no automatic de-escalation — switching back down is operator-driven).

The classifier is intentionally NOT an LLM call (cost). If false-positives become a problem in production, the doc explicitly allows replacing it with a Hermes-routed local classifier (Qwen 7b — free, fast, runs on the existing Ollama).

**OAuth-first routing (`src/lib/server/llm_router.ts`):**

```
For Anthropic:
  primary:  Claude Max subscription via MIRU_ROUTING_KEY (subscription-tier billing)
  fallback: (none — MIRU_ROUTING_KEY IS the subscription path; if it fails, surface error)

For Gemini:
  primary:  AGY OAuth (read from ~/.gemini/oauth_creds.json, shared with AGY)
  fallback: GEMINI_API_KEY env var (only if OAuth returns 401/403 or quota exhausted)
  rule:     GEMINI_API_KEY is RESERVED for image generation. Chat path attempts OAuth
            first; only falls back to the key when OAuth genuinely cannot serve the request.

For OpenAI:
  primary:  OPENAI_API_KEY (no OAuth path for OpenAI chat API)
  fallback: (none)

For Ollama:
  primary:  local socket (no auth)
  fallback: (none)
```

When the OAuth fallback chain exhausts, the router falls forward to the SAME tier on a DIFFERENT provider before returning an error. Example: if Anthropic Claude Max hits a transient outage on a Planning-tier request, the router automatically retries with Gemini 2.5 Flash (the Planning-tier Gemini equivalent) before surfacing a failure. The operator gets a one-time toast: "Anthropic unavailable; routed through Gemini for this reply." Cap-exhausted is treated the same way — fall forward to another provider in the same tier rather than 429-ing the operator.

**Backend architecture:**

*   Extends existing `src/routes/api/chat/+server.ts` to read the persisted thread tier (or run classifier if absent), pick the model, and route.
*   New `src/lib/server/phase_classifier.ts` — pure-function heuristic returning a tier label.
*   New `src/lib/server/llm_router.ts` — provider selection + OAuth-first auth chain + cross-provider fall-forward on failure.
*   Four provider modules:
    *   `src/lib/server/providers/anthropic.ts` — Claude Max via `MIRU_ROUTING_KEY`
    *   `src/lib/server/providers/openai.ts` — `OPENAI_API_KEY`
    *   `src/lib/server/providers/gemini.ts` — OAuth from shared `~/.gemini/oauth_creds.json`, API key as fallback only
    *   `src/lib/server/providers/ollama.ts` — local socket
*   Each provider exports a streaming `chat({ messages, model, signal, authMode })` function returning an `AsyncIterable<string>`.
*   New `chat_thread_state` table in `logueos_memory.db`:
    ```sql
    CREATE TABLE chat_thread_state (
        thread_id TEXT PRIMARY KEY,
        current_tier TEXT NOT NULL DEFAULT 'chat',
        operator_override TEXT NULL,
        last_model_used TEXT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    ```

**Composer UI — minimal pill (override only):**

The pill in the composer is mostly a **status indicator** + manual override:

1.  Default state: shows the current auto-escalation tier as a small badge: `[🪶 Chat]` / `[⚖️ Planning]` / `[🧠 Deep]` / `[🔧 Local]`.
2.  Tap the badge → option to lock the tier (override auto-escalation) or reset to "Auto."
3.  No tier selection on first message — the server picks. The operator only intervenes when they want to override.

This keeps the surface clean (no extra UI work in PR 1c besides the badge), with the heavy lifting on the server.

**Cost guardrails:**

*   `ANTHROPIC_DAILY_TOKEN_CAP` (default 1,000,000 tokens/day — generous since Claude Max sub is the primary path; cap is a safety valve)
*   `OPENAI_DAILY_TOKEN_CAP` (default 200,000 tokens/day — OpenAI is fallback only, lower cap)
*   `GEMINI_DAILY_TOKEN_CAP` (default 2,000,000 tokens/day — OAuth is generous; cap protects against runaway loops)
*   On cap exceeded: router falls forward to next-cheapest provider in same tier (see OAuth-first routing block above). If ALL providers in tier exhausted, returns `cap_exhausted` with the next-tier-up offered as a switch suggestion.
*   Settings page shows: today's tokens per provider, today's voice characters (§2D.2), today's STT minutes (§2D.1).

**Mobile / iOS UX:**

*   Status badge respects 44px minimum tap target.
*   Override modal opens upward on small viewports.
*   Tier emoji always visible for at-a-glance status awareness.

**Why this matters:**

The current chat tab routes everything through whatever provider was wired most recently (Gemini Flash-lite per recent commits). The server-driven auto-escalation pattern means casual chat stays cheap automatically, but the moment the operator pivots into design work, the model upgrades without an explicit tap. OAuth-first routing means metered API-key budgets only burn when the subscription/OAuth paths can't serve the request — exactly the cost-efficient default the operator asked for.

---

### G. Thread Management (Sidebar, Pin, Archive, Rename, Auto-Title)

The chat tab will gain a thread list with full lifecycle controls — patterns proven in ChatGPT, Claude.ai, and Slack. Industry-validated (see Decision Log entry 9 for research citations).

**Layout:**
- **Desktop:** collapsible left sidebar (250px wide, toggle to hide)
- **Mobile:** full-screen overlay list, opened via a "Threads" button in the §2B compact header

**List ordering:**
1. Pinned threads at top (**unlimited count** — explicitly NOT copying ChatGPT's hated 3-pin cap)
2. Active threads chronological by `last_activity_at` (newest first)
3. Archived threads in a collapsible "Archived" section at the bottom (hidden by default per Decision Log entry 11; toggle to reveal)

**Per-thread display:**
- Auto-generated title (from first assistant reply, matching ChatGPT/Claude.ai pattern)
- Last-message timestamp
- Tier badge (🪶/⚖️/🧠/🔧) inherited from §2F state
- Active-worker indicator (pulsing dot) if a dispatched worker is in flight on a chat-initiated action

**Kebab-menu actions per thread:**
- 📌 **Pin / Unpin** — instant, no confirmation, no cap
- ✏️ **Rename** — inline edit (click title, type, blur to save). No modal.
- 📦 **Archive** — soft-delete, moves to Archived section, recoverable indefinitely
- 🗑️ **Delete** — only available on already-archived threads. Two-step pattern (archive first, then delete) aligns with operator's `Fail-Closed Directive` on irreversible ops.
- 📝 **Summary** — one-shot LLM call (Flash-lite tier) generating a 2-3-sentence summary; stored in `chat_thread_meta.summary`. Shown on hover (desktop) / long-press (mobile). Does NOT auto-generate — operator-triggered to keep cost predictable.
- 🧠 **Remember this** — flags the thread for high-priority Tier 0 emission to `logueos_memory.db` per §2H.

**Switching:** click in sidebar → full state swap. No tab metaphor. Universal pattern across ChatGPT / Claude.ai / Gemini / Slack threads.

**Backend (new `chat_thread_meta` table):**
```sql
CREATE TABLE chat_thread_meta (
    thread_id TEXT PRIMARY KEY REFERENCES chat_thread_state(thread_id),
    title TEXT NOT NULL DEFAULT 'New thread',
    pinned BOOLEAN NOT NULL DEFAULT 0,
    archived BOOLEAN NOT NULL DEFAULT 0,
    summary TEXT NULL,
    remember_flag BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

Auto-title generation hook: after the first assistant reply on a new thread, fire a Flash-lite call with a "Generate a 5-7 word title from this exchange" prompt; persist to `chat_thread_meta.title`. Operator can rename anytime.

### H. Team Memory Emission from Chat (Tier 0 Pipeline)

The chat surface doubles as a **team training instrument** — every meaningful conversation auto-deposits a Tier 0 observation into `data/logueos_memory.db`. The same pool the Gatekeeper injects into dispatched workers' contexts. Operator's framing: "we are training a team, not just robots."

**Auto-emission triggers (server-side):**

1.  **Thread archived by operator** → emit a single Tier 0 observation summarizing the thread (Flash-lite-generated body, ~150-tokens, cheap).
2.  **Manual `🧠 Remember this` flag** on a thread (see §2G kebab menu) → forces high-priority emission with operator-supplied tag, regardless of thread tier or status.
3.  **Phase-classifier signal (§2F):** when a thread reaches Deep tier and stays there for 3+ exchanges, mark as observation candidate. Quick-tier threads don't auto-emit (noise filter — we don't want every "what time is it" question polluting the memory pool).
4.  **Worker dispatch from chat:** when a chat thread triggers a Critique/Build/Verify/Retry dispatch, emit a linking observation so the dispatched worker sees the operator's framing as injected memory.

**Schema (uses existing pipeline — no new tables):**

Calls existing `tools/emit_observation.py` (per kernel canon). Tier 0 observation rows in `data/logueos_memory.db` get new chat-specific metadata:

- `source: "chat_thread"`
- `thread_id` for back-reference
- `tier_at_emit: "chat" | "planning" | "deep"`
- `models_used`: JSON array of provider/model combinations involved in producing the lesson
- `project_id`: inherited from §3 workspace selection at the time of the thread
- `task_shape`: inferred from §2F phase classifier (e.g., `["planning", "architecture"]`)

**Privacy guard (hard rule):**

Before any observation is persisted, the body string is run through a redactor that scans for substrings matching any value of any `LogueOS-Orchestrator/.env` variable. Matches are replaced with `[REDACTED:VAR_NAME]`. This is a fail-closed check — if redaction can't run (e.g., env file unreadable), emission is blocked rather than risking a key leak into the shared memory pool.

**Retrieval (operator-facing surface in Settings page):**

- Today's emitted observations count (e.g., "🧠 3 observations emitted today")
- Lifetime emission count + retention reminder
- Browser modal showing each observation with: source thread link, models used, tier at emit, body preview, manual delete button
- Operator can review + edit/delete observations BEFORE they get promoted to Tier 1 by the existing synthesis pipeline

**Retrieval (worker-facing — no new code, uses existing pipeline):**

Workers dispatched after chat-sourced observations land automatically receive them via the Gatekeeper's existing context injection. No change to worker prompts required — the injection layer is already wired per the kernel `Organizational Learning Layer` doc.

**Why this matters (operator's framing, captured verbatim):**

> "We are training a team. Not just robots."

The chat surface is the operator's primary mechanism for transferring tacit knowledge to the dispatched workers. Without §2H, every chat session's lessons die when the thread is archived. With §2H, they become injection-ready context for the next worker that touches a related task — and the team's collective competence compounds over time.

---

## 3. The Workspace Registry Configuration (`workspaces.json`)

To make onboarding new repositories highly scalable, a single, central JSON registry file will act as the single source of truth for the entire environment.

*   **Config Location:** `data/config/workspaces.json` (inside the `LogueOS-Orchestrator` directory). This separates operator-facing Markdown canon (`.logueos/`) from system-internal, runtime-mutable configurations.
*   **The Schema Contract:**
    ```json
    {
      "schema_version": 1,
      "workspaces": [
        {
          "name": "LogueOS-Console",
          "display_name": "Console",
          "group": "LogueOS Kernel",
          "emoji": "💻",
          "default_branch": "main",
          "pool_size": 1,
          "is_archived": false
        },
        {
          "name": "project-miru",
          "display_name": "Miru",
          "group": "Miru Cluster",
          "emoji": "👁️",
          "default_branch": "main",
          "pool_size": 4,
          "is_archived": false
        }
      ]
    }
    ```
*   **Dynamic Bootstrapping:** We will ship `tools/bootstrap_workspaces_json.py` inside the Orchestrator directory as part of PR 1a. This script reads the static `_APPROVED_TARGET_REPOS` and current JS `WORKTREE_POOLS` configurations to dynamically bootstrap `data/config/workspaces.json`.
*   **Path Portability:** Absolute file-system paths are dropped from the schema. Paths are computed dynamically at runtime using `{LOGUEOS_WORKTREE_BASE}/{name}` to ensure configuration stays 100% portable across machines and platforms.
*   **Worktree Pools Alignment:** The `dispatch_listener` service will be refactored to read from this central configuration file, removing the duplicate `WORKTREE_POOLS` map and aligning all systems under one registry.
*   **Hot-Reload & Fallback Behavior:** The `/api/v1/workspaces` endpoint will re-read the JSON file on every request to ensure zero caching bugs. If the JSON is missing or malformed, the gateway logs a warning and fallback-defaults to the static `_APPROVED_TARGET_REPOS` list to prevent blank dropdown menus.
*   **Onboarding Ergonomics (Honest Option A):** Registering a new project in the console requires no code changes once worktrees are created. However, full onboarding still requires setting up the physical git worktree and parking branch. A later PR (e.g., PR 4) will ship `tools/onboard_workspace.py` to fully automate the shell worktree setup.

---

## 4. Technical Changes in `LogueOS-Console`

### `src/routes/chat/+page.svelte` (UI Layer)
*   Refactor the large composer template lines (Lines 1258–1436) into the unified pill cluster.
*   Implement Map-based draft caching loaded on `onMount`:
    ```typescript
    let drafts = $state<Map<string, string>>(new Map());
    
    // On Mount: Load map from localStorage
    // Debounced write effect:
    let debounceTimer: ReturnType<typeof setTimeout>;
    $effect(() => {
        const text = textDraft;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (text.trim()) {
                drafts.set(activeThread, text);
            } else {
                drafts.delete(activeThread);
            }
            try {
                localStorage.setItem('chat_drafts_v1', JSON.stringify(Array.from(drafts.entries())));
            } catch { /* quota exceeded, drop silently */ }
        }, 300);
    });
    ```
*   Implement dynamic `target_repo` selection inside `handleWorkflowAction` rather than hardcoding it:
    ```typescript
    // Before: target_repo: 'LogueOS-Console'
    // After:  target_repo: selectedRepo
    ```

### `src/routes/+layout.svelte` (Layout Chrome)
*   Add a reactive `immersiveMode` flag that collapses headers and the system command bar when `/chat` is active, utilizing smooth transitions.

---

## 5. Visual Mockup Reference
High-fidelity mockups showing the visual design are available in the local repository docs folder:
*   **Unified Composer Capsule:** `[Mockup Image](./images/2026-05-25_chat-composer-mockup.png)`
*   **Ultra-Compact Minimalist Header:** `[Mockup Image](./images/2026-05-25_chat-compact-header.png)`

---

## 6. Phased Rollout & PR Division
To ensure maximum stability, quick code reviews, and zero-risk deploys, we have divided the rollout into **10 surgical phases** (Gateway/UI divisions + model-routing + thread-management + team-memory-emission PRs). Workers are assigned per-PR based on strength fit: **CC** for kernel/backend/iOS-edge-case/security-sensitive work, **AGY** for Svelte UI iteration. CC reviews every AGY PR before merge per `gmi-pr-review` discipline. **PR 1a and PR 1b may be dispatched in parallel** (different repos, no code dependency between them; PR 1b just can't MERGE until PR 1a does, saving ~30 min wallclock).

**Feature-flag / kill-switch policy (Decision Log entry 9, D10):** PRs 4, 5, 6 add user-facing features that touch external APIs (AssemblyAI, ElevenLabs, push subscriptions). Each ships behind a `.env` flag (`ENABLE_VOICE_DICTATION`, `ENABLE_TALKBACK`, `ENABLE_WEB_PUSH`) so the operator can disable a feature without a git revert if production reveals a fatal bug. PRs 1/1a/1b/1c/2/3/7/8 are pure infrastructure / UI surfaces — feature flag not required; revert via `git revert` is acceptable.

**Unit test discipline (Decision Log entry 9, D11):** Each PR adds Vitest unit tests for new code where the failure surface is non-obvious (router, classifier, providers, proxies, redactor, dead-sub reaper, observation emit). Thin UI work in PRs 1b/2/3/7 may skip if the verification is purely visual.

1.  **PR 1a (Orchestrator Workspaces Backend) — CC:** Bootstrapping script `tools/bootstrap_workspaces_json.py` + dynamic `GET /api/v1/workspaces` endpoint + fallbacks + unit tests.
    *   *LOC Target:* ~60 LOC
    *   *Verification:* Assert curl `GET /api/v1/workspaces` returns 200 with the bootstrap workspaces array.
2.  **PR 1b (Console Core UI + Upload Extension + Cross-Device Draft Sync) — AGY:** Expose workspaces SSR-load + core composer dropdown (hides archived workspaces by default, with toggle to reveal — Decision Log entry 9, D5) + map-based debounced draft cache **synced server-side via new `/api/chat/drafts` endpoint backed by `chat_thread_state` table** (Decision Log entry 9, D14 — cross-device promoted from Phase 2 into this PR; only marginal cost since the table is added in PR 1c) + iOS 16px textarea zoom styling + **extend existing `/api/chat/uploads` endpoint to accept `target_repo` parameter** (Decision Log entry 9, D12 — endpoint currently doesn't accept it; ~15 LOC bump).
    *   *LOC Target:* ~180 LOC (was ~120; bumped for uploads extension + cross-device draft sync endpoint)
    *   *Verification:* Draft persists on page refresh AND across devices (type on laptop → appears on phone after page reload). Workspace dropdown hides archived; toggle reveals them; selection steers `target_repo` on dispatch (verified via network panel POST payloads). Image upload carries `target_repo` in the POST body.
3.  **PR 1c (Server-Driven Model Routing + OAuth-First Provider Chain + Tailscale Identity Auth) — CC:** `phase_classifier.ts` (L1 keyword/length heuristic + optional L2 LLM classifier for ambiguous middle band — Decision Log entry 12) + `llm_router.ts` (OAuth-first auth chain + cross-provider fall-forward + 402-billing-vs-outage classification + `provider_used`/`model_used` surfaced in every response payload — Decision Log entry 12) + four provider modules (anthropic / openai / gemini / ollama) + `chat_thread_state` SQLite table + minimal status-badge UI + per-provider daily token caps + Settings page spend banner. **PLUS Tailscale identity authentication via `hooks.server.ts`:** check `Tailscale-Funnel-Request` header — if present, request came through Funnel and is denied for sensitive endpoints; if absent, request came over tailnet directly and is automatically authenticated as the operator (Decision Log entry 9, D13 — Console currently has zero auth; this PR closes that gap before any paid-API endpoints go live). CC owns this PR because the backend touches three auth surfaces, cost-cap logic, DB schema, AND auth middleware — exactly the surface where operational-detail discipline matters most.
    *   *LOC Target:* ~460 LOC (was ~380; bumped for Tailscale identity auth in `hooks.server.ts` + L2 classifier scaffolding)
    *   *Verification:* (a) Default chat replies route through Anthropic Claude Max / Gemini OAuth — verified by inspecting network panel + token-cap counter. (b) Send a "let's plan this feature" message → server auto-escalates to Planning tier, status badge updates, reply visibly improves. (c) Manually override tier via badge → next message respects the lock. (d) Simulate Anthropic outage (block via /etc/hosts) → router falls forward to Gemini same-tier, operator gets a one-time toast. (e) Per-thread state persists across page reload AND across device (laptop → phone). (f) Talkback (§2D.3) hard-routes to Flash-lite regardless of thread tier. (g) Hit `/api/chat/speak` via Funnel from a non-tailnet device → returns 401. Hit from tailnet → returns 200. (h) Chat response payload always includes `provider_used` + `model_used` fields. (i) Simulate Anthropic 402 billing error → router rotates credential within Anthropic, does NOT drop to a lower tier.
4.  **PR 2 (Resilience & Observer) — AGY:** Deliver the `IntersectionObserver` scroll-lock, unread boundary divider, and EventSource-wired connection status dot.
    *   *LOC Target:* ~150 LOC
    *   *Verification:* Assert scroll position is locked during background streaming updates + connection signal dot transitions from green to amber on Tailscale drops.
5.  **PR 3 (Chat-Only Compact Header) — AGY:** Implement the ultra-compact 32px header branch specifically on the `/chat` route in `+layout.svelte`, and the active micro-tracker.
    *   *LOC Target:* ~120 LOC
    *   *Verification:* Confirm top bars are fully hidden and compact bar active on `/chat`, but globally visible on other Console pages.
6.  **PR 4 (One-Shot Voice Dictation & Read-Aloud) — CC:** Add the AssemblyAI async speech-to-text proxy API (one-shot dictation), ElevenLabs `/api/chat/speak` authenticated proxy with Emma's voice, the `ELEVENLABS_DAILY_CHAR_CAP` daily safety cap, client-side persistent `<audio>` integration, and full deletion of the auditioning test scaffolding.
    *   *LOC Target:* ~220 LOC
    *   *Verification:* Dictate a sentence via the PWA mic button → plays back with Emma's voice via speaker button → test files physically removed from repository tree.
7.  **PR 5 (Realtime Talkback Mode) — CC:** Implement AssemblyAI realtime WebSocket streaming, PWA Screen Wake-Locks (`navigator.wakeLock`), audio-element iOS warm-up logic, and the automated walkie-talkie state-machine loop.
    *   *LOC Target:* ~180 LOC
    *   *Verification:* Walk with phone unlocked → speak → auto-replies read out → mic auto-arms hands-free loop.
8.  **PR 6 (PWA Web Push Notifications) — CC:** Implement `pywebpush` signing (VAPID subject formatted as `mailto:dreighto@gmail.com`, NOT bare domain — Apple returns 403 on bare-domain subjects). `web_push_subscriptions` database schema. Extend `src/service-worker.ts` with `push` event listener — **every `showNotification` call MUST be wrapped in `event.waitUntil(...)`** (iOS Safari kills the push subscription after 3 silent pushes if this is missing — see Decision Log entry 10). Adopt **Declarative Web Push (iOS 18.4+/Safari 18.4+, March 2025) as primary path, SW push as fallback** — declarative payload-carries-display-data, immune to SW bugs. Server-side dead-subscription reaper that re-prompts the operator on 403/410 (iOS provides no client-side `pushsubscriptionchange` signal — backend must detect dead subs). Settings page UI alerts toggle.
    *   *LOC Target:* ~400 LOC (was ~250 — bumped for Declarative Web Push, `event.waitUntil` discipline, and dead-sub reaper backend per 2026 production research)
    *   *Verification:* Assert native lock-screen push alerts arrive on iPhone 16 Pro Max when CC finishes background compiles with the PWA completely shut. After 5 consecutive pushes (well past the 3-silent-push iOS kill threshold), subscription remains alive (proves `event.waitUntil` wrap is correct). Block VAPID push at the dead-sub layer for a fake endpoint → reaper detects 410 and surfaces re-prompt in the Console UI.
9.  **PR 7 (Thread Management — Sidebar / Pin / Archive / Rename / Auto-Title) — AGY:** Implement the sidebar layout (collapsible desktop, full-screen overlay mobile), `chat_thread_meta` SQLite schema, all kebab-menu actions (pin/rename inline/archive/delete two-step/summary on-demand/remember flag), auto-title generation from first assistant reply.
    *   *LOC Target:* ~250 LOC
    *   *Verification:* Pin/unpin a thread (instant, top of list, no cap). Rename via inline click-edit (no modal). Archive moves thread to collapsible Archived section. Delete only available on already-archived threads (two-step pattern). Auto-title generated within 2s of first assistant reply. Summary modal renders the LLM-generated summary on hover/long-press.
10.  **PR 8 (Team Memory Emission from Chat — Tier 0 Pipeline) — CC:** Server-side thread-archive trigger calling `tools/emit_observation.py`. Manual `🧠 Remember this` endpoint. Phase-classifier signal hook (Deep tier × 3+ exchanges → emission candidate). Dispatch-from-chat linking observation. Privacy redactor scanning observation body for `.env` value substrings before persist (fail-closed). Settings page surface showing today's emission count + browser modal with delete capability.
    *   *LOC Target:* ~180 LOC
    *   *Verification:* Archive a thread → observation appears in `data/logueos_memory.db` Tier 0 table with correct `source`, `thread_id`, `tier_at_emit`, `models_used`, `project_id`. Test: paste a fake `OPENAI_API_KEY=sk-foo` into a chat message, archive thread → observation body shows `[REDACTED:OPENAI_API_KEY]` not the literal key. Round-trip test: emit observation, dispatch a worker on a related task, confirm Gatekeeper injects the observation into the worker's prompt (validates the team-learning loop end-to-end).

**Worker assignment summary:** CC owns 6 PRs (1a, 1c, 4, 5, 6, 8) — kernel/backend/security/iOS-edge-case/memory-pipeline. AGY owns 4 PRs (1b, 2, 3, 7) — pure Svelte UI iteration where AGY's frontend speed wins.

---

### Mandatory Deploy & Rebuild Protocol
Every Console PR merge requires the following post-ship sequence to compile static assets and restart the server process correctly on port 18767:
1.  **Rebuild:** `npm run build`
2.  **Restart Service:** `sudo systemctl restart logueos-console.service` (or `Stop-Process` on Port 18767 bound PID)
3.  **Verify Health:** `curl -I https://room.taila28611.ts.net/console/` (assert 200 OK)

---

## Appendix: Architectural Decision Log

1.  **Immersive View Pivot (2026-05-25):** Replaced proposed animated hide-and-reveal immersive view with a permanently ultra-compact 32px header specifically for `/chat` to prevent iOS Safari keyboard-appearance collisions and scroll-gesture conflicts.
2.  **Voice Read-Aloud Audition (2026-05-25):** Locked ElevenLabs conversational **Emma** voice (`voice_id: 56bWURjYFHyYyVf490Dp`) utilizing high-efficiency `eleven_turbo_v2_5` models over native iOS system SpeechSynthesis to achieve ChatGPT-grade conversational flow on iPhone.
3.  **Audio element Gesture Bypass (2026-05-25):** Swapped undocumented `SpeechSynthesis` warm-up workaround for the highly stable, PWA industry-standard silent WAV base64 audio-element click-unlock trick to survive async network-response boundaries on iOS Safari.
4.  **Service-Worker Integrity (2026-05-25):** Moved proposed static SW listener directly into SvelteKit's native `src/service-worker.ts` auto-registration file to prevent registry conflicts and silent-fails.
5.  **Dynamic Workspace Registry (2026-05-25):** Shifted static workspace mapping from a hardcoded Python array to a centralized, hot-reloadable `data/config/workspaces.json` read on every request, with fallbacks to dynamic approved lists on parse failures.
6.  **Mixed-Worker Execution (2026-05-25, revised):** Initial reassignment to CC-only was reverted after operator clarified intent — "AGY out of this interactive session" did NOT mean "AGY out of the dispatch loop." Final assignment: CC owns 5 PRs (1a backend, 1c model picker, 4/5 voice, 6 push), AGY owns 3 PRs (1b/2/3 pure UI). CC reviews every AGY PR before merge per `gmi-pr-review` skill.
7.  **Server-Driven Model Routing with Auto-Escalation (2026-05-26):** REVISED from original manual-picker design. The server detects conversation phase (chat / planning / deep) via heuristic classifier and auto-escalates the model. Operator override pill is available but the default path is fully server-driven. Locked sub-decisions: (a) OAuth is primary for every provider; API keys are fallback. (b) `GEMINI_API_KEY` is RESERVED for image generation only — chat uses AGY OAuth. (c) Per-thread state persists server-side in `chat_thread_state` SQLite table for cross-device consistency. (d) When a provider hits a cap or outage, router falls forward to next-cheapest same-tier provider before surfacing an error. (e) Talkback (§2D.3) is hard-locked to Gemini Flash-lite via OAuth regardless of thread tier — predictable cost ceiling for the high-volume conversational loop. Rationale: operator is sole user, doesn't need manual picker overhead; server-driven auto-escalation makes the cost-efficient default automatic without sacrificing access to deeper models when the conversation calls for it.
8.  **Canon Baseline Grandfather (2026-05-26):** Pre-execution: merged Orchestrator PR #106 grandfathering 29 post-Linux-migration project-name references in `.logueos/reference/` port/restart/roadmap docs to unblock the canon-contamination CI gate. Without this, every Orchestrator PR cut from current main (including PR 1a) would have failed CI. Independent of this epic's design, blocking dependency.
9.  **Sanity-Check Decisions Locked (2026-05-26):** Operator answered 13 sanity-check decisions before greenlight. D5 = (a) hide archived workspaces by default with toggle. D6 = both inline message + activity banner on worker completion. D7 = emoji prefix + metadata for model audit. D8 = (a) operator-console-ui density per PR. D9 = (a) PR 1a/1b in parallel. D10 = (c) feature flags for PR 4/5/6, revert OK for 1/2/3. D11 = (a) unit tests per PR. D12 = (a) `/api/chat/uploads` extension folded into PR 1b. D13 = (a) Tailscale identity auth folded into PR 1c (Console has zero auth today; verified). D14 = (b) cross-device draft sync promoted into PR 1b.
10.  **iOS Web Push Hardening (2026-05-26):** Research-validated additions to PR 6, all from 2026 production failure reports. (a) Every `showNotification` MUST wrap in `event.waitUntil()` — Safari kills sub after 3 silent pushes without this. (b) Ship Declarative Web Push (iOS 18.4+) as primary path, SW push as fallback — Apple designed declarative to insulate against SW bugs. (c) Server-side dead-subscription reaper (iOS provides no client-side expiry signal). (d) VAPID subject formatted as `mailto:` not bare domain.
11.  **Thread Management & Team Memory Emission Added (2026-05-26):** Two new design sections (§2G Thread Management + §2H Team Memory Emission from Chat) and two new PRs (PR 7 AGY, PR 8 CC). Thread management patterns adopted from ChatGPT / Claude.ai / Slack (unlimited pins explicitly — NOT copying ChatGPT's hated 3-pin cap; inline rename; two-step delete archive-first). Team memory emission converts the chat surface into a training instrument for the dispatched-worker team: meaningful thread archives + manual `🧠 Remember this` flags + Deep-tier signal auto-emit Tier 0 observations into `data/logueos_memory.db`, which the Gatekeeper already injects into worker contexts. Privacy redactor scans observation bodies against `.env` values before persist. Operator framing captured verbatim: "we are training a team, not just robots."
12.  **§2F Router Refinements from Research (2026-05-26):** Three industry-grounded refinements folded in. (a) Classify 402 billing errors as "rotate credential, do not fall to lower tier" — conflating cap-hit with outage drops a tier unnecessarily (Hermes Agent credential-pool pattern). (b) Always surface `provider_used` + `model_used` in every chat response payload so operator can audit silent fallbacks (OpenRouter + Vercel AI Gateway convention). (c) Phase classifier layered as L1 keyword/length heuristic (sub-10ms) + L2 LLM-as-classifier only for the ambiguous middle band — single-tier heuristic routers stall at 75-80% accuracy; two-tier hits 90%+ per RouterBench.
