# AGY — Chat Surface V2 Redo (full briefing, end-to-end)

You're being asked to do a second pass on the immersive chat surface CC just built. CC got the AESTHETIC right (full-bleed Conversational OS, single unified composer pill, no global chrome) but stubbed most of the FUNCTIONALITY — the image button, paperclip, mic, talkback, model picker, and threads panel are all non-functional placeholders or pure state-flip stubs. The operator wants your independent pass so they can compare side-by-side.

---

## What to read (everything's on disk at `/home/dreighto/dev/LogueOS-Console/`)

| File | What it is |
|---|---|
| `docs/images/2026-05-25_chat-composer-mockup.png` | Original AGY composer mockup — VISUAL SOURCE OF TRUTH |
| `docs/images/2026-05-25_chat-compact-header.png` | Original AGY full chat surface mockup — VISUAL SOURCE OF TRUTH |
| `src/routes/chat-v2/+page.svelte` | CC's V2 — preserve the philosophy, fix the stubs |
| `src/routes/+layout.svelte` | Layout — already has 'immersive' hook around line 88 |
| `src/routes/chat/+page.svelte` | V1 safety net — DO NOT TOUCH |
| `static/gmi-handoff/cc-v2-screenshot.png` | What CC's V2 looks like at iPhone 16 Pro Max width |
| `docs/2026-05-25_chat-composer-revamp.md` | Backend design doc — backend context only, NOT the visual spec |

---

## What CC built (live at `/console/chat-v2`)

Achieved:
- ✅ Full-bleed dark canvas, no global chrome, no bottom nav, no sidebar
- ✅ Single unified composer pill at the bottom
- ✅ Cinematic spacing between message turns
- ✅ Ambient bloom gradient background
- ✅ Old `/chat` preserved as safety net
- ✅ All backend endpoints reused unchanged

Stubbed / broken:

1. **Sparkles (image-gen) button** — placeholder, no `onClick` handler
2. **Paperclip (attach) button** — placeholder, no `onClick` handler
3. **Mic button** — wired to MediaRecorder + `/api/chat/transcribe` but probably broken (untested permission/empty-blob/no-visible-feedback paths)
4. **Talkback toggle** — pure state-flip stub. ZERO actual walkie-talkie loop wiring. No AssemblyAI realtime WebSocket, no auto-rearm, no Step A→E state machine
5. **Recording/Talkback indicators** — used global toast notifications that render as huge bars at the top of viewport (ugly, lazy)
6. **Repo + thread dropdowns** — `bg-black/80` + `backdrop-blur` looks transparent on the gradient bloom — text unreadable
7. **Model picker / tier indicator** — bare emoji only, no model name, no override UI. The §2F model-routing UI from the locked design doc was dropped entirely
8. **Threads UI** — only a chip dropdown in the header. Operator wanted threads in a dedicated side panel or their own visible section (per pre-locked plan; CC unilaterally removed the sidebar)

---

## Operator's verbatim feedback to CC

> "I have been testing out the chat. I sent a message and it still reads like the system is the one I am talking to when it should be a planning partner. The image icon isn't working so either it's not wired in intentionally or you didn't wire it in correctly. One thing we will need to work on and fix is the mic and talk back loop. Especially the indicators when they get tapped. All I see is a huge green or red bar right above the page and that is unappealing and feels lazy. The mic doesn't even work if that is supposed to be working. Same wit the talkback. The paperclip attatchment icon doesn't work. The project/repo dropdown is transparent and I can't even read what is being shown to me in the dropdown. Same goes with the session dropdown. I see no model/effort picker. I don't even know which model I am speaking with. I was under the impression we were going to have the recent threads appear in a side panel or their own section since we discussed this so what is going on here cc?"

---

## What to do (concrete steps)

### 1. Cut a branch

```bash
cd /home/dreighto/dev/LogueOS-Console
git fetch origin main
git checkout -b agy/chat-v2-redo origin/main
```

### 2. Add 'agy' to the immersive route check

Open `src/routes/+layout.svelte` around line 88. The `headerStyle` derived currently triggers `'immersive'` only for paths ending in `chat-v2`. Extend it so `chat-v2-agy` also matches. Example:

```typescript
const headerStyle = $derived(
    page.url.pathname.endsWith('/chat-v2') || page.url.pathname.endsWith('/chat-v2-agy')
        ? 'immersive'
        : page.url.pathname.endsWith('/chat') ? 'compact' : 'full'
);
```

### 3. Build your version at `/chat-v2-agy`

Create:
- `src/routes/chat-v2-agy/+page.server.ts` (you can copy from CC's `src/routes/chat-v2/+page.server.ts` — same data loader)
- `src/routes/chat-v2-agy/+page.svelte` (your own version of the surface)

### 4. Wire EVERY button. No stubs.

Specific list:

- **Paperclip** → `/api/chat/uploads` (POST multipart with `target_repo`). On success, insert markdown image link into the textarea.
- **Sparkles (image gen)** → toggles image-mode local state, sends `image: true` flag in `/api/chat` POST body. On message send while image-mode is on, the agent routes the prompt to image generation.
- **Mic** → MediaRecorder → POST blob to `/api/chat/transcribe` → fill textarea with returned text. Show state INSIDE the composer pill — color the border amber, swap mic icon for a square stop icon. NO toast.
- **Talkback** → actual walkie-talkie loop. Use `/api/chat/transcribe/stream` to get AssemblyAI realtime token (response gives `{token, ws_url}`). Open WebSocket directly to AssemblyAI from the browser. As transcript chunks come in, accumulate. On silence/end, POST to `/api/chat` with talkback flag (forces Flash-lite tier). On reply, POST text to `/api/chat/speak` → play returned MP3 via the persistent `<audio>` element → re-arm mic. Auto-stop after 3 minutes of detected silence OR 3 consecutive transcription failures OR explicit toggle off.
- **Model picker** → visible at all times. Show currently-routing model (read from `/api/chat/tier?thread_id=X` `last_model_used` field). Tap to open override modal — operator picks tier (Quick / Planning / Deep / Local). PUT to `/api/chat/tier?thread_id=X` with `{tier}` body.
- **Threads** → dedicated panel or section, NOT a header chip. Options:
  - Collapsible left panel on desktop, slide-out drawer on mobile (the original PR 7 pattern)
  - A horizontal row of recent thread chips above the message feed
  - A pinned "Recent" section in a thread overlay accessed via a quiet header button
  - Pick what reads best in the Conversational OS aesthetic; operator left this open.

### 5. Fix CC's specific UX failures

- **Dropdown backgrounds** — solid dark fill (`bg-zinc-900` or `bg-[#0a0a0a]`), no transparency over the gradient bloom. Readable on every background.
- **NO global toasts for in-flight state.** Recording/Talkback state must show in the composer pill itself via border color + icon swap + optional small pulsing dot.
- **Operator bubbles** — match the mockup (orange/bright outline glow), not CC's filled purple/pink gradient.
- **Agent replies** — label with "LogueOS" (or worker name) in cyan with a sparkles icon, matching the mockup's `LogueOS` chip on each agent message.
- **Composer state indicators** — border glow shifts color with mode:
  - idle: subtle purple gradient
  - recording: amber edge
  - talkback active: emerald edge
  - sending: brief pulse

### 6. Build + screenshot at iPhone 16 Pro Max width

```bash
cd /home/dreighto/dev/LogueOS-Console
npm run build
sudo systemctl restart logueos-console.service
chromium --headless --no-sandbox --disable-gpu --window-size=430,932 \
  --screenshot=/home/dreighto/snap/chromium/common/agy-v2.png \
  "http://127.0.0.1:18767/console/chat-v2-agy"
```

Compare your screenshot to `docs/images/2026-05-25_chat-composer-mockup.png` and `docs/images/2026-05-25_chat-compact-header.png` side-by-side. If yours doesn't match, iterate before opening the PR.

### 7. Open a PR

```bash
git add -A
git commit -m "feat(chat): AGY's V2 pass — full-bleed immersive surface with wired controls"
git push -u origin agy/chat-v2-redo
gh pr create --title "feat(chat): AGY's V2 pass — full-bleed immersive surface with wired controls" \
  --body "..."
```

Then STOP. CC + the operator will review side-by-side.

---

## Backend contracts (all endpoints exist, do NOT change)

| Endpoint | Purpose |
|---|---|
| `GET /api/chat?thread=X` | Poll messages for a thread |
| `POST /api/chat` | Send a message. Body: `{message, thread, target_repo, image?, talkback?}` |
| `GET /api/chat/drafts?thread_id=X` | Get persisted draft |
| `PUT /api/chat/drafts?thread_id=X` | Save draft. Body: `{body}` |
| `GET /api/chat/tier?thread_id=X` | Current tier + last_model_used |
| `PUT /api/chat/tier?thread_id=X` | Operator override. Body: `{tier}` |
| `GET /api/chat/usage` | Per-provider daily token usage |
| `GET /api/chat/threads` | List threads `{active: [...], archived: [...]}` |
| `PATCH /api/chat/threads/[id]` | Pin/archive/rename. Body: `{pinned?, archived?, title?}` |
| `POST /api/chat/threads/[id]/auto-title` | Generate title from first exchange |
| `POST /api/chat/threads/[id]/summary` | Generate 2-3 sentence summary |
| `POST /api/chat/threads/[id]/remember` | Flag for Tier 0 memory emission |
| `POST /api/chat/transcribe` | STT (multipart file upload) |
| `GET /api/chat/transcribe/stream` | Get AssemblyAI realtime token (Talkback) |
| `POST /api/chat/speak` | TTS (returns audio/mpeg). Body: `{text, voice_id?}` |
| `GET /api/chat/speak/status` | Voice quota usage |
| `POST /api/chat/uploads` | Image upload (multipart file + `target_repo`) |
| `GET /api/chat/observations` | Recent Tier 0 emissions |
| `GET /api/chat/activity?limit=N` | Worker activity stream |
| `POST /api/chat/push/subscribe` | Web Push subscribe |
| `GET /api/v1/workspaces` (gateway, port 18766) | Workspace list |

---

## Constraints

- Do NOT modify `/chat` (V1 safety net at `src/routes/chat/+page.svelte`).
- Do NOT modify CC's `/chat-v2` (the comparison at `src/routes/chat-v2/+page.svelte`).
- Do NOT modify ANY `/api/chat/*` endpoint. They all work; use them.
- iOS-friendly: textarea must be `text-base` (16px+) to prevent zoom on focus.
- Safe-area-inset handling on top + bottom (the immersive layout in +layout.svelte already does this at the outer container).
- Reuse the existing `immersive` layout mode (extend the `.endsWith()` check to include `chat-v2-agy`).

## Tone-of-voice note (separate issue, flag in your PR description)

The operator says the chat backend responds with a generic "I am the system" voice, when it should feel like talking to a planning partner. That's a backend system-prompt change in `src/lib/server/providers/*.ts` or the route handler at `src/routes/api/chat/+server.ts`, separate from the visual rewrite. Flag it in your PR description so the operator can decide whether to address it now or after the visual layer settles.

---

Open the PR when done. CC will diff-review and we go from there.
