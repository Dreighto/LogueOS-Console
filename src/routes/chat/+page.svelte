<script lang="ts">
	import type { PageData } from './$types';
	import type { ChatMessage } from '$lib/types/chat';
	import { onMount, tick } from 'svelte';
	import { resolve, base } from '$app/paths';
	import {
		Send,
		Terminal,
		User,
		Cpu,
		AlertTriangle,
		Check,
		X,
		Loader2,
		MessageSquare,
		Play,
		HelpCircle,
		BookOpen,
		Edit3,
		CheckCircle2,
		Plus,
		Paperclip,
		Sparkles,
		RefreshCw,
		ChevronDown
	} from 'lucide-svelte';
	import type { Workspace } from './+page.server';
	import { toasts } from '$lib/utils/toasts';
	import { formatShortTime } from '$lib/utils/format';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Markdown from '$lib/components/Markdown.svelte';

	let { data }: { data: PageData } = $props();

	// ─────────────────────────────────────────────────────────────────
	// Multi-thread state
	// Each conversation has its own thread_id. The default thread is
	// "default". Operators create new threads via the switcher dropdown.
	// All messages, dispatches, and history slices are scoped to the
	// active thread.
	// ─────────────────────────────────────────────────────────────────
	type ThreadInfo = { thread_id: string; message_count: number; latest_ts: string };
	let activeThread = $state<string>(data.activeThread || 'default');
	let threads = $state<ThreadInfo[]>(data.threads || [{ thread_id: 'default', message_count: 0, latest_ts: '' }]);
	let threadSwitcherOpen = $state(false);

	// ─────────────────────────────────────────────────────────────────
	// LLM tier badge (PR 1c). Shows current conversation tier derived
	// by the server phase classifier. Operator can tap to override.
	// ─────────────────────────────────────────────────────────────────
	type Tier = 'chat' | 'planning' | 'deep' | 'local';
	let currentTier = $state<Tier>('chat');
	let tierOverrideOpen = $state(false);

	const TIER_LABELS: Record<Tier, string> = {
		chat: '🪶 Chat',
		planning: '⚖️ Planning',
		deep: '🧠 Deep',
		local: '🔧 Local'
	};

	async function fetchTier(threadId: string) {
		try {
			const resp = await fetch(resolve(`/api/chat/tier?thread_id=${encodeURIComponent(threadId)}`));
			if (resp.ok) {
				const body = await resp.json();
				if (body.current_tier) currentTier = body.current_tier as Tier;
			}
		} catch { /* offline — keep last known tier */ }
	}

	async function setTierOverride(tier: Tier | null) {
		tierOverrideOpen = false;
		try {
			const resp = await fetch(resolve('/api/chat/tier'), {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ thread_id: activeThread, tier })
			});
			if (resp.ok) {
				const body = await resp.json();
				if (body.current_tier) currentTier = body.current_tier as Tier;
			}
		} catch { /* silent */ }
	}

	// Active chat state seeded from SSR to ensure zero flicker on load.
	let messages = $state<ChatMessage[]>(data.messages || []);
	let textDraft = $state('');
	let sending = $state(false);
	// Agent selector pill state. 'auto' falls back to the @-mention heuristic;
	// 'claude-code' / 'agy' locks every subsequent send to that worker until
	// the operator picks something else. Persists for the page-load session.
	// agentLock controls dispatch routing:
	//   'auto'        — every send fires a worker (gateway role-routes unless @-mentioned)
	//   'claude-code' — every send goes to CC
	//   'agy'         — every send goes to AGY
	//   'hermes'      — every send goes to local Hermes (Qwen via Ollama),
	//                   free + fast (~1-3s), no file-system access, sounding board
	//   'silent'      — chat note only, no worker spawns (notes / annotations)
	let agentLock = $state<'auto' | 'claude-code' | 'agy' | 'hermes' | 'silent'>('auto');
	// Image-generation mode. Toggle is a button next to the paperclip; when
	// ON, the next send is treated as a Gemini image-gen prompt instead of
	// a chat message. Stays sticky until the operator turns it off, so
	// back-to-back image work doesn't need re-toggling.
	let imageMode = $state(false);
	let actionSubmitting = $state<number | null>(null); // messageId of active action being updated
	let feedContainer = $state<HTMLDivElement | null>(null);
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	let attachInputEl = $state<HTMLInputElement | null>(null);
	let examplesOpen = $state(false);

	// ─────────────────────────────────────────────────────────────────
	// Workspace (repo) selector — drives target_repo on all dispatches.
	// Persisted per-thread in localStorage; PR 1c will move to server.
	// ─────────────────────────────────────────────────────────────────
	let selectedRepo = $state('LogueOS-Console');
	let repoDropdownOpen = $state(false);
	let showArchivedWorkspaces = $state(false);
	let workspaceByThread = $state<Record<string, string>>({});

	const selectedWorkspace = $derived<Workspace | undefined>(
		[...(data.workspaces ?? []), ...(data.archivedWorkspaces ?? [])].find(
			(w) => w.name === selectedRepo
		)
	);

	function selectWorkspace(name: string) {
		selectedRepo = name;
		repoDropdownOpen = false;
		workspaceByThread = { ...workspaceByThread, [activeThread]: name };
		try {
			localStorage.setItem('chat_workspaces_v1', JSON.stringify(workspaceByThread));
		} catch { /* ignore */ }
	}

	// ─────────────────────────────────────────────────────────────────
	// Cross-device draft sync. localStorage is the offline write-through;
	// the /api/chat/drafts endpoint is the cross-device source of truth.
	// ─────────────────────────────────────────────────────────────────
	let drafts = $state<Map<string, string>>(new Map());
	let draftDebounceTimer: ReturnType<typeof setTimeout>;

	// Debounce textDraft changes → save to localStorage + PUT to server.
	$effect(() => {
		const text = textDraft; // reactive dependency — fires on every keystroke
		clearTimeout(draftDebounceTimer);
		draftDebounceTimer = setTimeout(() => {
			// activeThread captured in callback (not tracked, avoids spurious fires)
			const tid = activeThread;
			if (text.trim()) {
				drafts.set(tid, text);
			} else {
				drafts.delete(tid);
			}
			try {
				localStorage.setItem('chat_drafts_v1', JSON.stringify(Array.from(drafts.entries())));
			} catch { /* storage quota exceeded */ }
			// Fire-and-forget server sync for cross-device persistence.
			void fetch(resolve(`/api/chat/drafts?thread_id=${encodeURIComponent(tid)}`), {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ body: text })
			}).catch(() => { /* offline — localStorage copy is the fallback */ });
		}, 300);
	});

	// Starter prompt library — small, hand-curated. Kept inline so opening
	// the drawer is zero-fetch. Categories help orient as the list grows.
	const STARTER_PROMPTS: { category: string; label: string; prompt: string }[] = [
		{ category: 'Brainstorm', label: 'Suggest a feature', prompt: '@agy suggest a new feature for the Console that would speed up my workflow. Be specific and pitch the tradeoffs.' },
		{ category: 'Brainstorm', label: 'Refactor ideas', prompt: '@agy look at the chat tab and suggest 3 refactor ideas, ordered by impact-per-effort.' },
		{ category: 'Review', label: 'Audit recent diff', prompt: '@cc audit the last 5 commits on main for any regressions or rough edges.' },
		{ category: 'Review', label: 'Check theme tokens', prompt: '@agy check that all color usage in the Console uses theme tokens (no hex literals).' },
		{ category: 'Verify', label: 'Run the test suite', prompt: '@cc run the unit test suite and report any failures.' },
		{ category: 'Verify', label: 'Smoke test the build', prompt: '@cc verify the latest build runs and key routes (/console, /chat, /activity) load.' },
		{ category: 'Investigate', label: 'Why is X slow?', prompt: '@cc investigate why dispatch responses are slow — trace the wait between operator send and final reply.' },
		{ category: 'Investigate', label: 'Triage Linear', prompt: '@cc do a 3-day Linear ticket sweep and report what should move state.' }
	];

	// Auto-grow the textarea up to ~6 visible lines. CSS-only (resize: none)
	// won't grow at all; we set the height directly from scrollHeight so the
	// composer expands as you type. Done in an effect — no per-keystroke
	// listener, no layout thrash.
	$effect(() => {
		// Re-runs whenever textDraft changes.
		const _ = textDraft;
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		const next = Math.min(textareaEl.scrollHeight, 168); // ~6 lines at text-base
		textareaEl.style.height = `${next}px`;
	});

	// Worker activity (per-trace): live progress from emit_chat_activity.py.
	// Keyed by trace_id; arrays are oldest-first per trace.
	type Activity = {
		id: number;
		trace_id: string;
		action: string;
		target: string | null;
		timestamp: string;
	};
	let activityByTrace = $state<Record<string, Activity[]>>({});

	// Live worker stdout stream (per-trace). EventSource subscribers append
	// chunks here; the UI renders a tailing pane under each active worker
	// bubble. Capped client-side at ~64 KB to keep DOM nodes manageable.
	const STREAM_BUFFER_MAX = 64 * 1024;
	let streamByTrace = $state<Record<string, string>>({});
	let streamEnded = $state<Record<string, boolean>>({});
	const streamSources = new Map<string, EventSource>();

	// requestAnimationFrame batching for streaming chunks. SSE chunks land
	// 5-30× per second; rendering each one triggers a full marked.parse +
	// DOMPurify pass on the entire accumulated buffer, plus a DOM diff for
	// the streaming bubble. That CPU spike per chunk made the output feel
	// choppy ("the worker is replying back during build mode is clunky").
	//
	// Fix: accumulate incoming chunks in a Map, schedule a single state
	// update per animation frame (~16 ms = 60 fps). The Markdown component
	// then re-renders at most once per frame regardless of chunk arrival
	// rate, which matches what ChatGPT / Claude.ai do for streaming feel.
	const pendingStreamChunks = new Map<string, string>();
	let streamFlushScheduled = false;
	function scheduleStreamFlush() {
		if (streamFlushScheduled) return;
		streamFlushScheduled = true;
		requestAnimationFrame(() => {
			streamFlushScheduled = false;
			if (pendingStreamChunks.size === 0) return;
			const updates: Record<string, string> = { ...streamByTrace };
			for (const [traceId, chunk] of pendingStreamChunks) {
				let next = (updates[traceId] || '');
				next = next + (next.endsWith('\n') || next.length === 0 ? '' : '\n') + chunk;
				if (next.length > STREAM_BUFFER_MAX) {
					next = '...[truncated]...\n' + next.slice(next.length - STREAM_BUFFER_MAX);
				}
				updates[traceId] = next;
			}
			pendingStreamChunks.clear();
			streamByTrace = updates;

			// Auto-scroll the feed during streaming when the operator was
			// already at the bottom. Without this the streaming bubble grows
			// downward but the viewport stays put — you watch the text fall
			// below the fold. Using 'auto' (instant) not 'smooth' because
			// each frame already changes the content; a 200ms smooth animation
			// per frame would visibly stutter and fight itself.
			if (userAtBottom && feedContainer) {
				feedContainer.scrollTop = feedContainer.scrollHeight;
			}
		});
	}

	// Stick-to-bottom scroll: chat threads should behave like iMessage/Slack —
	// land at the bottom on first paint, auto-scroll on new messages ONLY if
	// the operator is already near the bottom. If they've scrolled up to read
	// history, show a "X new ↓" pill instead of yanking the viewport.
	let userAtBottom = $state(true);
	let unseenCount = $state(0);
	let lastSeenMessageId = $state<number | null>(null);
	// ID of the first message that arrived while scrolled up (drives the unread divider).
	let firstUnseenMessageId = $state<number | null>(null);
	// IntersectionObserver sentinel element — bound in the template at feed bottom.
	let scrollSentinel = $state<HTMLDivElement | null>(null);
	// Connection status dot wired to the EventSource (SSE) streams in syncStreamSubscriptions.
	let connStatus = $state<'green' | 'amber' | 'red'>('green');
	let connDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	let connConsecutiveErrors = 0;

	// Optimistic "dispatching..." indicator. Set true the moment the operator
	// hits send; cleared when the dispatch-side system bubble (or a streaming
	// bubble, whichever comes first) lands in the messages list. Closes the
	// 3-5s perception gap between "I sent" and "agent is working" — without
	// this the chat feels dead during the gateway + listener + worker
	// cold-start round-trip.
	let dispatching = $state(false);
	let dispatchingSinceMsgId = $state<number | null>(null);

	// 1s message poll — the dominant chat-side latency between worker
	// emit_chat_message landing in the DB and the operator seeing it.
	// Dropping from 3s shaves up to 2s off every dispatch's perceived
	// completion time. The query is a single SELECT against a tiny indexed
	// table; cost is negligible.
	const POLL_INTERVAL_MS = 1000;
	// Activity ticker pulls one row per active trace per tick. 1s while
	// something is running, 3s when idle. Idle rate intentionally stays at
	// 3s so we don't hammer the DB when no traces are active.
	const ACTIVITY_POLL_FAST_MS = 1000;
	const ACTIVITY_POLL_IDLE_MS = 3000;

	// A trace is "active" if it was dispatched but hasn't finished yet.
	// Multiple signals indicate it's done; if ANY fires the trace is inactive:
	//   1. emit_chat_activity emitted a terminal action (completed | failed)
	//   2. The worker emitted a chat_messages row from cc / agy / system-reply
	//      tied to this trace_id (i.e. the final emit_chat_message). This is
	//      the most reliable signal because workers tend to emit a final
	//      message even if they skip the activity rows.
	//   3. The SSE stream closed itself (streamEnded[traceId] is true). The
	//      stream closes when cc_completion_log.jsonl shows the trace's row.
	function isTraceActive(traceId: string): boolean {
		// Signal 3 — SSE stream ended (server saw the completion-log row).
		if (streamEnded[traceId]) return false;

		// Signal 1 — explicit terminal activity row.
		const rows = activityByTrace[traceId] || [];
		const last = rows[rows.length - 1]?.action || '';
		if (last === 'completed' || last === 'failed') return false;

		// Signal 2 — the worker emitted its final reply into the chat as a
		// non-system message. The system "Agent dispatched" row uses the same
		// trace_id but sender='system'; a follow-up from sender='cc' or 'agy'
		// (or any non-system) with the same trace_id means the worker spoke.
		for (const m of messages) {
			if (m.trace_id !== traceId) continue;
			if (m.sender === 'system' || m.sender === 'operator') continue;
			// cc / agy / any worker sender = the worker's reply landed.
			return false;
		}

		return true;
	}

	function tracesFromMessages(msgs: ChatMessage[]): string[] {
		const set = new Set<string>();
		for (const m of msgs) {
			if (m.trace_id) set.add(m.trace_id);
		}
		return Array.from(set);
	}

	function scheduleConnStatus(status: 'green' | 'amber' | 'red') {
		if (connDebounceTimer !== null) clearTimeout(connDebounceTimer);
		connDebounceTimer = setTimeout(() => {
			connStatus = status;
			connDebounceTimer = null;
		}, 1000);
	}

	// Scroll the chat container to the absolute bottom. Wraps in
	// requestAnimationFrame so the call lands after layout/paint — on first
	// mount, calling scrollTo before the messages render does nothing.
	async function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
		await tick();
		if (!feedContainer) return;
		const el = feedContainer;
		requestAnimationFrame(() => {
			el.scrollTo({ top: el.scrollHeight, behavior });
		});
	}

	async function jumpToLatest() {
		userAtBottom = true;
		unseenCount = 0;
		firstUnseenMessageId = null;
		if (messages.length > 0) lastSeenMessageId = messages[messages.length - 1].id;
		await scrollToBottom('smooth');
	}

	// Poll the API for new messages stateless and snappy
	async function pollMessages() {
		try {
			const resp = await fetch(resolve('/api/chat') + `?thread=${encodeURIComponent(activeThread)}`);
			if (!resp.ok) return;
			const body = await resp.json();
			const newMessages: ChatMessage[] = body.messages || [];

			if (newMessages.length === messages.length && JSON.stringify(newMessages) === JSON.stringify(messages)) {
				return;
			}

			const prevLastId = messages.length > 0 ? messages[messages.length - 1].id : null;
			messages = newMessages;

			// Clear the "dispatching..." indicator once the dispatch follow-up
			// (system "Agent dispatched" bubble OR a real worker reply) has
			// landed after the operator's most recent send.
			if (dispatching && dispatchingSinceMsgId !== null) {
				const settled = newMessages.some(
					(m) =>
						m.id > (dispatchingSinceMsgId as number) &&
						(m.sender === 'system' || (m.sender !== 'operator' && m.trace_id))
				);
				if (settled) {
					dispatching = false;
					dispatchingSinceMsgId = null;
				}
			}

			// Stick-to-bottom: only auto-scroll when the operator was already
			// reading at the bottom. If they've scrolled up to read history,
			// count new arrivals and let the "X new ↓" pill bring them back
			// when they want.
			if (userAtBottom) {
				scrollToBottom('smooth');
				if (newMessages.length > 0) {
					lastSeenMessageId = newMessages[newMessages.length - 1].id;
				}
			} else {
				const newOnes = newMessages.filter((m) => prevLastId === null || m.id > prevLastId);
				if (newOnes.length > 0) {
					unseenCount += newOnes.length;
					if (firstUnseenMessageId === null && newOnes[0]) {
						firstUnseenMessageId = newOnes[0].id;
					}
				}
			}
		} catch {
			// silent fallback
		}
	}

	// Pull all activity rows for every trace mentioned in the current chat.
	// One trip per trace is wasteful as the active-trace set grows; for the
	// foreseeable usage volume (≤10 traces visible) the single round-trip
	// per poll-tick is fine.
	async function pollActivity() {
		const traces = tracesFromMessages(messages);
		if (traces.length === 0) return;

		const updates: Record<string, Activity[]> = { ...activityByTrace };
		await Promise.all(
			traces.map(async (traceId) => {
				try {
					const resp = await fetch(
						resolve('/api/chat/activity') + `?trace_id=${encodeURIComponent(traceId)}`
					);
					if (!resp.ok) return;
					const body = await resp.json();
					updates[traceId] = body.activity || [];
				} catch {
					// silent
				}
			})
		);
		activityByTrace = updates;
	}

	function anyTraceActive(): boolean {
		return tracesFromMessages(messages).some(isTraceActive);
	}

	// Open an EventSource for each active trace; close any whose trace has
	// completed/failed since last tick. Idempotent — safe to call from the
	// poll loop. The browser's EventSource auto-reconnects on transient drop.
	function syncStreamSubscriptions() {
		const traces = tracesFromMessages(messages);
		const active = new Set(traces.filter(isTraceActive));

		// Open for newly-active traces.
		for (const traceId of active) {
			if (streamSources.has(traceId)) continue;
			try {
				const url = base + '/api/chat/stream/' + encodeURIComponent(traceId);
				const es = new EventSource(url);
				es.addEventListener('chunk', (ev) => {
					const data = (ev as MessageEvent).data as string;
					// Server formatted as one data: line per source line; the
					// EventSource API rejoins them with \n. Queue into the
					// per-trace pending bucket and schedule a single rAF flush.
					const prev = pendingStreamChunks.get(traceId) || '';
					const next = prev + (prev.endsWith('\n') || prev.length === 0 ? '' : '\n') + data;
					pendingStreamChunks.set(traceId, next);
					scheduleStreamFlush();
				});
				es.onopen = () => {
					connConsecutiveErrors = 0;
					scheduleConnStatus('green');
				};
				es.addEventListener('end', () => {
					streamEnded = { ...streamEnded, [traceId]: true };
					es.close();
					streamSources.delete(traceId);
				});
				es.addEventListener('error', () => {
					connConsecutiveErrors++;
					scheduleConnStatus(connConsecutiveErrors >= 3 ? 'red' : 'amber');
				});
				streamSources.set(traceId, es);
			} catch (e) {
				console.error('failed to open stream for', traceId, e);
			}
		}

		// Close streams for traces no longer active.
		for (const [traceId, es] of streamSources.entries()) {
			if (!active.has(traceId)) {
				es.close();
				streamSources.delete(traceId);
			}
		}
		// No active traces → reset conn status to green (nothing to fail).
		if (active.size === 0) {
			connConsecutiveErrors = 0;
			scheduleConnStatus('green');
		}
	}

	onMount(() => {
		// Restore draft map and workspace selections from localStorage.
		try {
			const savedDrafts = JSON.parse(localStorage.getItem('chat_drafts_v1') || '[]') as [string, string][];
			drafts = new Map(savedDrafts);
			const localDraft = drafts.get(activeThread) || '';
			if (localDraft) textDraft = localDraft;
		} catch { /* corrupted key — ignore */ }
		try {
			const savedWS = JSON.parse(localStorage.getItem('chat_workspaces_v1') || '{}') as Record<string, string>;
			workspaceByThread = savedWS;
			const savedRepo = savedWS[activeThread];
			if (savedRepo) selectedRepo = savedRepo;
		} catch { /* corrupted key — ignore */ }

		// Async: fetch server draft for cross-device sync (overwrites local if newer).
		void fetch(resolve(`/api/chat/drafts?thread_id=${encodeURIComponent(activeThread)}`))
			.then((r) => (r.ok ? r.json() : null))
			.then((body: { body?: string } | null) => {
				if (body?.body) {
					textDraft = body.body;
					drafts.set(activeThread, body.body);
					try {
						localStorage.setItem('chat_drafts_v1', JSON.stringify(Array.from(drafts.entries())));
					} catch { /* ignore */ }
				}
			})
			.catch(() => { /* offline — use local copy */ });

		// Fetch initial tier for badge.
		void fetchTier(activeThread);

		// First paint may not have measured the feed yet — defer to the next
		// frame so scrollHeight reflects the rendered messages, then jump
		// without animation. Snap-to-bottom feel like iMessage.
		requestAnimationFrame(() => {
			scrollToBottom('auto');
			if (messages.length > 0) {
				lastSeenMessageId = messages[messages.length - 1].id;
			}
		});

		// IntersectionObserver on the sentinel div at the bottom of the feed.
		// When sentinel enters feedContainer's visible area → user is at bottom.
		// No scroll-event math; no layout thrash on every scroll tick.
		let sentinelObserver: IntersectionObserver | null = null;
		if (feedContainer && scrollSentinel) {
			sentinelObserver = new IntersectionObserver(
				(entries) => {
					const entry = entries[0];
					if (entry?.isIntersecting) {
						userAtBottom = true;
						unseenCount = 0;
						firstUnseenMessageId = null;
						if (messages.length > 0) {
							lastSeenMessageId = messages[messages.length - 1].id;
						}
					} else {
						userAtBottom = false;
					}
				},
				{ root: feedContainer, threshold: 0 }
			);
			sentinelObserver.observe(scrollSentinel);
		}

		const interval = setInterval(pollMessages, POLL_INTERVAL_MS);

		// Activity ticker — separate cadence than messages so a running worker
		// can paint progress without forcing the heavier message poll to speed
		// up too. setTimeout chain lets us adapt cadence based on whether any
		// trace is currently active. Each tick also re-syncs stream subscriptions.
		let activityTimer: ReturnType<typeof setTimeout> | null = null;
		const scheduleActivity = () => {
			if (activityTimer !== null) clearTimeout(activityTimer);
			const next = anyTraceActive() ? ACTIVITY_POLL_FAST_MS : ACTIVITY_POLL_IDLE_MS;
			activityTimer = setTimeout(async () => {
				await pollActivity();
				syncStreamSubscriptions();
				scheduleActivity();
			}, next);
		};
		// Kick off the first activity fetch immediately, then schedule.
		void pollActivity().then(() => {
			syncStreamSubscriptions();
			scheduleActivity();
		});

		// Re-fetch instantly when screen returns to focus
		const onVisibility = () => {
			if (document.visibilityState === 'visible') {
				pollMessages();
				void pollActivity();
				syncStreamSubscriptions();
			}
		};
		document.addEventListener('visibilitychange', onVisibility);

		return () => {
			clearInterval(interval);
			if (activityTimer !== null) clearTimeout(activityTimer);
			if (connDebounceTimer !== null) clearTimeout(connDebounceTimer);
			sentinelObserver?.disconnect();
			document.removeEventListener('visibilitychange', onVisibility);
			// Close every open SSE on unmount.
			for (const es of streamSources.values()) {
				try { es.close(); } catch { /* noop */ }
			}
			streamSources.clear();
		};
	});

	// Submit a new operator message
	async function handleSendMessage() {
		if (!textDraft.trim() || sending) return;
		const draft = textDraft.trim();
		textDraft = '';
		sending = true;

		try {
			const resp = await fetch(resolve('/api/chat'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					sender: 'operator',
					message: draft,
					agent: agentLock,
					thread: activeThread,
					image: imageMode
				})
			});

			if (!resp.ok) {
				const err = await resp.json().catch(() => ({}));
				throw new Error(err.error || `HTTP ${resp.status}`);
			}

			const body = await resp.json();
			// Update tier badge from response.
			if (body.current_tier) currentTier = body.current_tier as Tier;
			// Snappy local append. The operator just sent — always pin them
			// to the bottom so they see their own message + the incoming
			// "Agent dispatched" follow-up.
			messages = [...messages, body.message];
			userAtBottom = true;
			unseenCount = 0;
			lastSeenMessageId = body.message?.id ?? lastSeenMessageId;
			// Show the instant "dispatching agent..." indicator unless the
			// pill is Silent (in which case no worker fires, so no spinner).
			if (agentLock !== 'silent') {
				dispatching = true;
				dispatchingSinceMsgId = body.message?.id ?? null;
			}
			scrollToBottom('smooth');

			// Trigger immediate follow-up poll to fetch any auto-dispatched system notification
			setTimeout(pollMessages, 500);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Unknown error';
			toasts.add(`Failed to send: ${msg}`, 'error');
			textDraft = draft; // restore draft on error
		} finally {
			sending = false;
		}
	}

	// Operator approves or denies a terminal command card
	async function handleAction(messageId: number, status: 'approved' | 'denied') {
		if (actionSubmitting !== null) return;
		actionSubmitting = messageId;

		try {
			const resp = await fetch(resolve('/api/chat/approve'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message_id: messageId,
					status
				})
			});

			if (!resp.ok) {
				const err = await resp.json().catch(() => ({}));
				throw new Error(err.error || `HTTP ${resp.status}`);
			}

			toasts.add(`Command ${status === 'approved' ? 'approved' : 'denied'} successfully.`, 'success');
			
			// Snappy local update
			messages = messages.map((m) => {
				if (m.id === messageId) {
					const updatedAction = m.interactive_action ? { ...m.interactive_action, status } : null;
					return { ...m, status, interactive_action: updatedAction };
				}
				return m;
			});

			// Instantly poll to fetch the resulting system message logging the decision
			setTimeout(pollMessages, 400);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Unknown error';
			toasts.add(`Action failed: ${msg}`, 'error');
		} finally {
			actionSubmitting = null;
		}
	}

	function handleKeyPress(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSendMessage();
		}
	}

	// Upload state — true while an image is being POSTed. Disables send so the
	// operator can't accidentally fire off a message with a half-uploaded image.
	let uploading = $state(false);

	async function uploadImage(file: File): Promise<string | null> {
		const fd = new FormData();
		fd.append('file', file);
		fd.append('target_repo', selectedRepo);
		const resp = await fetch(resolve('/api/chat/uploads'), {
			method: 'POST',
			body: fd
		});
		if (!resp.ok) {
			const text = await resp.text().catch(() => '');
			throw new Error(`upload failed: HTTP ${resp.status} ${text.slice(0, 120)}`);
		}
		const body = await resp.json();
		return body.url || null;
	}

	async function handleImageFiles(files: File[]) {
		if (files.length === 0) return;
		uploading = true;
		try {
			for (const file of files) {
				try {
					const url = await uploadImage(file);
					if (!url) continue;
					// Append the markdown image at the end of the current draft.
					// Wrap with blank lines so multiple pastes stack instead of running together.
					const tag = `\n\n![${file.name || 'image'}](${url})\n\n`;
					textDraft = (textDraft + tag).replace(/^\n+/, '');
				} catch (e: unknown) {
					const msg = e instanceof Error ? e.message : 'upload error';
					toasts.add(msg, 'error');
				}
			}
		} finally {
			uploading = false;
		}
	}

	function handlePaste(e: ClipboardEvent) {
		if (!e.clipboardData) return;
		const files: File[] = [];
		for (const item of Array.from(e.clipboardData.items)) {
			if (item.kind === 'file' && item.type.startsWith('image/')) {
				const f = item.getAsFile();
				if (f) files.push(f);
			}
		}
		if (files.length > 0) {
			e.preventDefault();
			void handleImageFiles(files);
		}
	}

	function handleDrop(e: DragEvent) {
		if (!e.dataTransfer) return;
		const files: File[] = [];
		for (const f of Array.from(e.dataTransfer.files)) {
			if (f.type.startsWith('image/')) files.push(f);
		}
		if (files.length > 0) {
			e.preventDefault();
			void handleImageFiles(files);
		}
	}

	// Drop a "--- NEW CONVERSATION ---" marker so future worker dispatches
	// don't replay older context into a fresh thread. The server slices
	// history after the most recent such marker before building prompts.
	let resetting = $state(false);
	async function handleNewConversation() {
		if (resetting) return;
		resetting = true;
		try {
			const resp = await fetch(resolve('/api/chat/reset'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ thread: activeThread })
			});
			if (!resp.ok) {
				const err = await resp.json().catch(() => ({}));
				throw new Error(err.error || `HTTP ${resp.status}`);
			}
			const body = await resp.json();
			messages = [...messages, body.message];
			scrollToBottom('smooth');
			toasts.add('Started a new conversation. Older context cleared from worker dispatches.', 'success');
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'Unknown error';
			toasts.add(`Reset failed: ${msg}`, 'error');
		} finally {
			resetting = false;
		}
	}

	function isResetMarker(m: ChatMessage): boolean {
		return m.sender === 'system' && m.message.startsWith('--- NEW CONVERSATION ---');
	}

	// ──────────────────────────────────────────────────────────────
	// Multi-thread switching
	// ──────────────────────────────────────────────────────────────
	async function refreshThreads() {
		try {
			const resp = await fetch(resolve('/api/chat/threads'));
			if (!resp.ok) return;
			const body = await resp.json();
			threads = body.threads || threads;
		} catch {
			// silent
		}
	}

	async function switchThread(threadId: string) {
		if (threadId === activeThread) {
			threadSwitcherOpen = false;
			return;
		}

		// Save the current draft before switching away from this thread.
		const prevThread = activeThread;
		const prevDraft = textDraft;
		if (prevDraft.trim()) {
			drafts.set(prevThread, prevDraft);
			try {
				localStorage.setItem('chat_drafts_v1', JSON.stringify(Array.from(drafts.entries())));
			} catch { /* ignore */ }
		}

		activeThread = threadId;
		threadSwitcherOpen = false;
		messages = [];
		streamByTrace = {};
		streamEnded = {};
		activityByTrace = {};
		dispatching = false;
		dispatchingSinceMsgId = null;
		unseenCount = 0;
		userAtBottom = true;

		// Restore workspace selection for the new thread.
		const savedRepo = workspaceByThread[threadId];
		if (savedRepo) selectedRepo = savedRepo;

		// Restore draft: use localStorage for instant paint, then async-reconcile with server.
		textDraft = drafts.get(threadId) || '';
		void fetch(resolve(`/api/chat/drafts?thread_id=${encodeURIComponent(threadId)}`))
			.then((r) => (r.ok ? r.json() : null))
			.then((body: { body?: string } | null) => {
				if (body?.body && body.body !== textDraft) {
					textDraft = body.body;
					drafts.set(threadId, body.body);
					try {
						localStorage.setItem('chat_drafts_v1', JSON.stringify(Array.from(drafts.entries())));
					} catch { /* ignore */ }
				}
			})
			.catch(() => { /* offline — localStorage copy stands */ });

		// Persist the choice so a fresh page load (phone or desktop) lands
		// here instead of the default thread. Fire-and-forget; never blocks
		// the visual switch.
		void fetch(resolve('/api/chat/state'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ thread: threadId })
		}).catch(() => {
			/* silent — local switch already happened, persistence is best-effort */
		});
		// Reload messages for the new thread and refresh tier badge.
		await pollMessages();
		await pollActivity();
		syncStreamSubscriptions();
		void fetchTier(threadId);
		requestAnimationFrame(() => scrollToBottom('auto'));
	}

	function slugifyThreadName(name: string): string {
		return name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40) || 'thread';
	}

	function newThread() {
		const raw = window.prompt('New thread name (letters, numbers, dashes):');
		if (!raw) return;
		const slug = slugifyThreadName(raw);
		// Add to local list so the switcher shows it instantly; the server
		// only knows about a thread once a message lands in it, so the
		// refresh after a first send will reconcile.
		if (!threads.some((t) => t.thread_id === slug)) {
			threads = [{ thread_id: slug, message_count: 0, latest_ts: '' }, ...threads];
		}
		void switchThread(slug);
	}

	// ──────────────────────────────────────────────────────────────────────
	// Per-message workflow actions: critique / build / verify / copy / retry
	// ──────────────────────────────────────────────────────────────────────
	// Each worker reply gets a small footer row of action buttons. These let
	// the operator chain agents (AGY brainstorm → CC critique → AGY build →
	// CC verify) without leaving the chat, just by tapping a button on the
	// reply they want to act on.
	let workflowSubmitting = $state<string | null>(null); // `${msgId}:${action}`

	function isWorkerReply(m: ChatMessage): boolean {
		// 'operator' messages we sent, 'system' marker rows — neither qualify
		// for workflow actions. Anything else (cc, agy, future workers) is a
		// reply we can act on.
		return m.sender !== 'operator' && m.sender !== 'system';
	}

	async function copyToClipboard(text: string): Promise<boolean> {
		try {
			if (navigator.clipboard && navigator.clipboard.writeText) {
				await navigator.clipboard.writeText(text);
				return true;
			}
		} catch {
			/* fall through to manual */
		}
		// Fallback: hidden textarea + execCommand. Older iOS Safari versions
		// silently fail navigator.clipboard outside user-gesture contexts.
		try {
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.left = '-9999px';
			document.body.appendChild(ta);
			ta.select();
			const ok = document.execCommand('copy');
			document.body.removeChild(ta);
			return ok;
		} catch {
			return false;
		}
	}

	async function handleWorkflowAction(
		messageId: number,
		action: 'critique' | 'build' | 'verify' | 'retry' | 'copy',
		opts: { agent?: 'claude-code' | 'agy'; messageText?: string } = {}
	) {
		const key = `${messageId}:${action}`;
		if (workflowSubmitting !== null) return;
		workflowSubmitting = key;

		try {
			if (action === 'copy') {
				const ok = await copyToClipboard(opts.messageText || '');
				toasts.add(ok ? 'Copied to clipboard.' : 'Copy failed.', ok ? 'success' : 'error');
				return;
			}

			// For dispatching actions, pick the target agent. Critique and
			// retry default to "the other one" (a CC reply → CC critique would
			// be circular). Build defaults to AGY (frontend leaning). Verify
			// defaults to CC. Operator can override via the agent pill if they
			// want differently — fall back to agentLock when explicit.
			const sourceMsg = messages.find((mm) => mm.id === messageId);
			const sourceSender = sourceMsg?.sender;
			let agent: 'claude-code' | 'agy' = 'claude-code';
			if (opts.agent) {
				agent = opts.agent;
			} else if (action === 'critique' || action === 'retry') {
				agent = sourceSender === 'cc' ? 'agy' : 'claude-code';
			} else if (action === 'build') {
				agent = 'agy';
			} else if (action === 'verify') {
				agent = 'claude-code';
			}

			const resp = await fetch(resolve('/api/chat/workflow'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					action,
					source_message_id: messageId,
					target_agent: agent,
					target_repo: selectedRepo
				})
			});
			if (!resp.ok) {
				const err = await resp.json().catch(() => ({}));
				throw new Error(err.error || `HTTP ${resp.status}`);
			}
			toasts.add(`${action} dispatched to ${agent}.`, 'success');
			void pollMessages();
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : 'workflow error';
			toasts.add(msg, 'error');
		} finally {
			workflowSubmitting = null;
		}
	}

	// Inline-streaming helpers. For each system "Agent dispatched" bubble with
	// an active trace, we render a SYNTHETIC worker bubble that grows with
	// the SSE stream while the worker is in flight. When the real worker
	// reply lands (a non-system non-operator chat_messages row with the same
	// trace_id), the synthetic bubble is hidden — the real bubble takes over
	// and is persisted via chat_messages for SSR + history.
	function hasRealWorkerReply(traceId: string): boolean {
		for (const m of messages) {
			if (m.trace_id !== traceId) continue;
			if (m.sender === 'system' || m.sender === 'operator') continue;
			return true;
		}
		return false;
	}

	// Infer sender from trace_id prefix so the synthetic bubble styles itself
	// correctly (orange for cc, purple for agy/gemini). Defaults to 'cc' if
	// the prefix is unrecognized.
	function senderFromTrace(traceId: string): 'cc' | 'agy' {
		const prefix = traceId.split('-')[0]?.toLowerCase() || '';
		if (prefix === 'agy' || prefix === 'gemini') return 'agy';
		return 'cc';
	}

	function shouldRenderStreamingBubble(m: ChatMessage): boolean {
		if (!m.trace_id) return false;
		if (m.sender !== 'system') return false;
		// Only attach a streaming bubble to the dispatch announcement, not
		// to other system messages that happen to carry a trace_id.
		if (!m.message.startsWith('Agent dispatched:')) return false;
		const buf = streamByTrace[m.trace_id] || '';
		if (buf.length === 0) return false;
		if (hasRealWorkerReply(m.trace_id)) return false;
		return true;
	}
</script>

<svelte:head>
	<title>Co-Working Chat — LogueOS</title>
</svelte:head>

<!-- h-full flexes inside the parent <main flex-1>, which is the canonical
     pattern (per mobile-chat-ux skill). Magic-number heights like
     calc(100dvh-100px) break when iOS shrinks 100dvh on keyboard appearance,
     pushing the composer below the visible area. -->
<div class="flex flex-col h-full overflow-hidden -m-4">
	<div class="shrink-0 flex items-start justify-between gap-2 px-2 pt-1">
		<!-- Thread switcher: replaces the static "Co-Working Chat" title. Shows
		     the active thread name + chevron; tap opens a dropdown of all
		     known threads with a "+ New thread" button. Operators can run
		     multiple parallel conversations and switch between them. -->
		<div class="relative shrink-0">
			<button
				type="button"
				onclick={() => (threadSwitcherOpen = !threadSwitcherOpen)}
				class="flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1.5 transition-colors hover:bg-surface/80 active:scale-95"
				aria-label="Switch chat thread"
				aria-expanded={threadSwitcherOpen}
			>
				<MessageSquare size={12} class="text-muted-foreground" />
				<span class="font-sans text-sm font-bold text-foreground tracking-tight">
					{activeThread === 'default' ? 'Default' : activeThread}
				</span>
				<span class="text-muted-foreground text-xs" aria-hidden="true">▾</span>
			</button>
			{#if threadSwitcherOpen}
				<div
					class="absolute left-0 top-full mt-1 z-30 flex flex-col rounded-md border border-border bg-background/95 shadow-lg backdrop-blur-md min-w-[200px] max-h-[60vh] overflow-y-auto custom-scrollbar animate-fade-in"
				>
					{#each threads as t (t.thread_id)}
						<button
							type="button"
							onclick={() => switchThread(t.thread_id)}
							class="flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-surface
								{t.thread_id === activeThread ? 'bg-surface/60 text-foreground' : 'text-muted-foreground'}"
						>
							<span class="font-sans text-sm">
								{t.thread_id === 'default' ? 'Default' : t.thread_id}
							</span>
							<span class="font-mono text-[10px] text-muted-foreground">{t.message_count}</span>
						</button>
					{/each}
					<button
						type="button"
						onclick={newThread}
						class="flex items-center gap-1.5 px-3 py-2 border-t border-border text-cta font-sans text-sm hover:bg-cta/5 transition-colors"
					>
						<Plus size={12} />
						<span>New thread</span>
					</button>
				</div>
			{/if}
		</div>

		<button
			type="button"
			onclick={handleNewConversation}
			disabled={resetting}
			class="shrink-0 mt-1 flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground hover:bg-surface/80 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
			title="Drop a 'new conversation' marker inside this thread so old context isn't replayed to workers."
		>
			{#if resetting}
				<Loader2 size={10} class="animate-spin" />
			{:else}
				<RefreshCw size={10} />
			{/if}
			<span>Reset context</span>
		</button>
	</div>

	<!-- Main Chat Area (Scrollable Feed) -->
	<div
		bind:this={feedContainer}
		class="relative flex-1 overflow-y-auto px-2 py-4 flex flex-col gap-4 custom-scrollbar"
	>
		{#if messages.length === 0}
			<div class="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-border rounded-lg bg-surface/10">
				<MessageSquare size={36} class="text-muted-foreground mb-3 opacity-60" />
				<h3 class="font-sans text-sm font-bold text-foreground">No Chat History</h3>
				<p class="font-sans text-xs text-muted-foreground max-w-xs mt-1">
					Type your first request below to ping GMI or CC. Mentions like <code class="text-cta">@agy</code> or <code class="text-cta">@cc</code> will automatically boot them up!
				</p>
			</div>
		{:else}
			{#each messages as m (m.id)}
				{#if !isResetMarker(m) && m.id === firstUnseenMessageId}
					<!-- Unread boundary: first message that arrived while operator was scrolled up. -->
					<div class="flex items-center gap-2 my-1 animate-fade-in" aria-label="New messages">
						<div class="h-px flex-1 bg-border/60"></div>
						<span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70 shrink-0">New Messages</span>
						<div class="h-px flex-1 bg-border/60"></div>
					</div>
				{/if}
				{#if isResetMarker(m)}
					<!-- Conversation boundary — dispatched workers after this point
					     see no context from before. -->
					<div class="flex items-center gap-2 my-1 animate-fade-in" aria-label="New conversation">
						<div class="h-px flex-1 bg-border"></div>
						<div class="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
							<Plus size={10} />
							<span>New conversation · {formatShortTime(m.timestamp)}</span>
						</div>
						<div class="h-px flex-1 bg-border"></div>
					</div>
				{:else}
				<!-- Message Container — left-border thread-grouped when trace_id present -->
				<div class="flex flex-col gap-1 {m.sender === 'operator' ? 'items-end' : 'items-start'} {m.trace_id ? 'thread-grouped' : ''} animate-fade-in">
					
					<!-- Metadata strip -->
					<div class="flex items-center gap-1.5 px-1 font-mono text-[10px] uppercase text-muted-foreground">
						{#if m.sender === 'operator'}
							<span>Operator</span>
							<User size={10} />
						{:else if m.sender === 'system'}
							<span class="text-status-blue">System</span>
						{:else}
							{@const senderClass = m.sender === 'agy'
								? 'text-purple-400'
								: m.sender === 'hermes'
									? 'text-status-green'
									: 'text-orange-400'}
							<Cpu size={10} class={senderClass} />
							<span class={senderClass}>{m.sender}</span>
						{/if}
						<span>·</span>
						<span>{formatShortTime(m.timestamp)}</span>
					</div>

					<!-- Speech Bubble -->
					<div
						class="max-w-[85%] rounded-lg px-3.5 py-2 font-sans text-sm leading-relaxed select-text
							{m.sender === 'operator'
								? 'bg-cta/15 border border-cta/30 text-white rounded-tr-none'
								: m.sender === 'system'
									? 'bg-surface/50 border border-border/50 text-muted-foreground w-full max-w-none text-center font-mono text-xs py-1.5'
									: 'bg-surface border border-border text-foreground rounded-tl-none'}"
					>
						<Markdown content={m.message} />

						<!-- Render interactive action cards if present -->
						{#if m.interactive_action}
							<div class="mt-3 rounded border border-border/80 bg-background/80 p-3 flex flex-col gap-2 font-mono text-xs">
								<div class="flex items-center gap-1.5 text-status-amber border-b border-border/50 pb-1.5 uppercase font-bold text-[10px] tracking-wider">
									<Terminal size={12} />
									<span>Interactive Command Request</span>
								</div>

								<div class="text-[11px] text-muted-foreground">
									Reason: <span class="text-foreground italic">{m.interactive_action.reason}</span>
								</div>

								<div class="bg-surface/60 border border-border/40 p-2 rounded text-[11px] text-green-400 break-all select-all font-mono leading-tight">
									$ {m.interactive_action.command}
								</div>

								<!-- Card Actions -->
								<div class="flex items-center gap-2 mt-2 w-full">
									{#if m.interactive_action.status === 'pending'}
										<button
											type="button"
											onclick={() => handleAction(m.id, 'denied')}
											disabled={actionSubmitting !== null}
											class="flex-1 flex items-center justify-center gap-1.5 rounded border border-status-red/40 bg-status-red/10 py-1.5 font-sans font-bold uppercase tracking-wider text-status-red text-[11px] transition-all duration-200 active:scale-95 hover:bg-status-red/20 focus:outline-none"
										>
											{#if actionSubmitting === m.id}
												<Loader2 size={12} class="animate-spin" />
											{:else}
												<X size={12} />
												<span>Deny</span>
											{/if}
										</button>
										<button
											type="button"
											onclick={() => handleAction(m.id, 'approved')}
											disabled={actionSubmitting !== null}
											class="flex-1 flex items-center justify-center gap-1.5 rounded border border-status-green/40 bg-status-green/10 py-1.5 font-sans font-bold uppercase tracking-wider text-status-green text-[11px] transition-all duration-200 active:scale-95 hover:bg-status-green/20 focus:outline-none shadow-[0_0_10px_rgba(34,197,94,0.05)]"
										>
											{#if actionSubmitting === m.id}
												<Loader2 size={12} class="animate-spin" />
											{:else}
												<Check size={12} />
												<span>Approve</span>
											{/if}
										</button>
									{:else}
										<div
											class="w-full text-center py-1.5 rounded text-[10px] uppercase font-bold tracking-widest border font-sans
												{m.interactive_action.status === 'approved' 
													? 'border-status-green/30 bg-status-green/5 text-status-green' 
													: 'border-status-red/30 bg-status-red/5 text-status-red'}"
										>
											{m.interactive_action.status === 'approved' ? '✓ Command Approved' : '✗ Command Denied'}
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</div>

					<!-- Per-message workflow actions on WORKER replies only.
					     Five icons: Critique, Build, Verify, Copy, Retry. All
					     compact + tooltip-labeled to stay out of the way on
					     phone. Pure render — no extra fetches. -->
					{#if isWorkerReply(m)}
						<div class="flex items-center gap-1 mt-0.5 text-muted-foreground">
							<button
								type="button"
								onclick={() => handleWorkflowAction(m.id, 'critique')}
								disabled={workflowSubmitting !== null}
								title="Send to the other agent for critique"
								aria-label="Critique"
								class="flex items-center gap-1 rounded border border-transparent hover:border-border hover:text-foreground px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-colors active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
							>
								{#if workflowSubmitting === `${m.id}:critique`}
									<Loader2 size={10} class="animate-spin" />
								{:else}
									<HelpCircle size={10} />
								{/if}
								<span>Critique</span>
							</button>
							<button
								type="button"
								onclick={() => handleWorkflowAction(m.id, 'build')}
								disabled={workflowSubmitting !== null}
								title="Dispatch AGY to implement this proposal"
								aria-label="Build"
								class="flex items-center gap-1 rounded border border-transparent hover:border-border hover:text-foreground px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-colors active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
							>
								{#if workflowSubmitting === `${m.id}:build`}
									<Loader2 size={10} class="animate-spin" />
								{:else}
									<Terminal size={10} />
								{/if}
								<span>Build</span>
							</button>
							<button
								type="button"
								onclick={() => handleWorkflowAction(m.id, 'verify')}
								disabled={workflowSubmitting !== null}
								title="Dispatch CC to verify the implementation/claim"
								aria-label="Verify"
								class="flex items-center gap-1 rounded border border-transparent hover:border-border hover:text-foreground px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-colors active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
							>
								{#if workflowSubmitting === `${m.id}:verify`}
									<Loader2 size={10} class="animate-spin" />
								{:else}
									<CheckCircle2 size={10} />
								{/if}
								<span>Verify</span>
							</button>
							<button
								type="button"
								onclick={() => handleWorkflowAction(m.id, 'copy', { messageText: m.message })}
								disabled={workflowSubmitting !== null}
								title="Copy reply to clipboard"
								aria-label="Copy"
								class="flex items-center gap-1 rounded border border-transparent hover:border-border hover:text-foreground px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-colors active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
							>
								<BookOpen size={10} />
								<span>Copy</span>
							</button>
							<button
								type="button"
								onclick={() => handleWorkflowAction(m.id, 'retry')}
								disabled={workflowSubmitting !== null}
								title="Retry the original operator request with the other agent"
								aria-label="Retry"
								class="flex items-center gap-1 rounded border border-transparent hover:border-border hover:text-foreground px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-colors active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
							>
								{#if workflowSubmitting === `${m.id}:retry`}
									<Loader2 size={10} class="animate-spin" />
								{:else}
									<RefreshCw size={10} />
								{/if}
								<span>Retry</span>
							</button>
						</div>
					{/if}

						<!-- Activity ticker: for any message tied to a worker trace, render the
						     stream of progress events emitted via tools/emit_chat_activity.py.
						     If the trace is mentioned but has no activity yet, show a pulsing
						     "Working..." placeholder. -->
						{#if m.trace_id}
							{@const acts = activityByTrace[m.trace_id] || []}
							{@const active = isTraceActive(m.trace_id)}
							{#if acts.length > 0 || active}
								<div class="mt-1 flex flex-col gap-0.5 font-mono text-[11px] {m.sender === 'operator' ? 'items-end' : 'items-start'}">
									{#each acts as a (a.id)}
										<div
											class="flex items-center gap-1.5 px-1
												{a.action === 'completed' ? 'text-status-green' :
													a.action === 'failed' ? 'text-status-red' :
														a.action === 'edited' ? 'text-cta' :
															a.action === 'ran' ? 'text-status-blue' : 'text-muted-foreground'}"
										>
											{#if a.action === 'reading'}
												<BookOpen size={10} />
											{:else if a.action === 'edited'}
												<Edit3 size={10} />
											{:else if a.action === 'ran'}
												<Terminal size={10} />
											{:else if a.action === 'thinking'}
												<Loader2 size={10} class="animate-spin" />
											{:else if a.action === 'completed'}
												<CheckCircle2 size={10} />
											{:else if a.action === 'failed'}
												<AlertTriangle size={10} />
											{:else}
												<span>·</span>
											{/if}
											<span class="uppercase tracking-wider opacity-80">{a.action}</span>
											{#if a.target}
												<span class="text-foreground/70 truncate max-w-[260px]">{a.target}</span>
											{/if}
										</div>
									{/each}
									{#if active && (acts.length === 0 || (acts[acts.length - 1].action !== 'completed' && acts[acts.length - 1].action !== 'failed'))}
										<div class="flex items-center gap-1.5 px-1 text-muted-foreground animate-pulse">
											<Loader2 size={10} class="animate-spin" />
											<span class="uppercase tracking-wider">Working...</span>
										</div>
									{/if}
								</div>
							{/if}

							<!-- Live worker stdout — collapsed by default; expand to see what
							     the worker is actually saying as it works. -->
							{#if streamByTrace[m.trace_id]}
								{@const buf = streamByTrace[m.trace_id]}
								{@const ended = streamEnded[m.trace_id]}
								<details class="mt-1 w-full max-w-[85%] {m.sender === 'operator' ? 'self-end' : 'self-start'}">
									<summary
										class="cursor-pointer select-none font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
									>
										<Terminal size={10} />
										<span>Worker output ({buf.length.toLocaleString()} chars{ended ? ', ended' : ', live'})</span>
									</summary>
									<pre
										class="mt-1 max-h-48 overflow-y-auto overflow-x-auto rounded border border-border/60 bg-background/70 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all custom-scrollbar"
									>{buf}</pre>
								</details>
							{/if}
						{/if}
					</div>

					<!-- Synthetic streaming bubble: appears below the "Agent dispatched"
					     system message while the worker is in flight, grows with SSE
					     stream chunks, and disappears once the real worker reply
					     lands in chat_messages. -->
					{#if shouldRenderStreamingBubble(m)}
						{@const senderLabel = senderFromTrace(m.trace_id || '')}
						{@const buf = streamByTrace[m.trace_id || ''] || ''}
						<div class="flex flex-col gap-1 items-start animate-fade-in">
							<div class="flex items-center gap-1.5 px-1 font-mono text-[10px] uppercase text-muted-foreground">
								<Cpu size={10} class={senderLabel === 'agy' ? 'text-purple-400' : 'text-orange-400'} />
								<span class={senderLabel === 'agy' ? 'text-purple-400' : 'text-orange-400'}>{senderLabel}</span>
								<span>·</span>
								<span class="flex items-center gap-1">
									<Loader2 size={10} class="animate-spin" />
									<span>streaming</span>
								</span>
							</div>
							<!-- Plain pre-wrap text during streaming. The Markdown
							     component re-parses + re-highlights on every state
							     change; doing that for each rAF tick during a fast
							     stream made the worker's reply feel choppy. The
							     formatted version lands when the real chat_messages
							     reply supersedes this synthetic bubble. -->
							<div
								class="max-w-[85%] rounded-lg rounded-tl-none border border-border bg-surface px-3.5 py-2 font-sans text-sm leading-relaxed select-text text-foreground whitespace-pre-wrap break-words"
							>{buf}</div>
						</div>
					{/if}
				{/if}
				{/each}

				<!-- Instant dispatch feedback: fills the perception gap between
				     "operator hit send" and "Agent dispatched" landing from the
				     server (gateway round-trip + listener spawn ≈ 1-3s). The
				     pulsing line disappears as soon as the system bubble OR a
				     streaming bubble takes over. -->
				{#if dispatching}
					<div class="flex flex-col gap-1 items-start animate-fade-in">
						<div class="flex items-center gap-1.5 px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground animate-pulse">
							<Loader2 size={10} class="animate-spin" />
							<span>dispatching agent...</span>
						</div>
					</div>
				{/if}
			{/if}
		<!-- IntersectionObserver sentinel — always rendered at the bottom of feed content.
		     When this element is visible inside feedContainer, the user is at the bottom. -->
		<div bind:this={scrollSentinel} class="h-px w-full shrink-0" aria-hidden="true"></div>
		</div>

	<!-- "X new ↓" pill: appears when new messages arrive while the operator is
	     scrolled up reading history. Tap to scroll to the bottom. Anchored
	     above the composer; hidden when at bottom or no unseen messages. -->
	{#if !userAtBottom && unseenCount > 0}
		<button
			type="button"
			onclick={jumpToLatest}
			class="self-center -mb-1 mt-0 flex items-center gap-1.5 rounded-full border border-cta/40 bg-cta/15 px-3 py-1 font-sans text-xs font-bold text-cta backdrop-blur-md shadow-lg transition-all duration-150 active:scale-95 hover:bg-cta/25 animate-fade-in"
			aria-label="Jump to latest messages"
		>
			<span>{unseenCount} new</span>
			<span aria-hidden="true">↓</span>
		</button>
	{/if}

	<!-- Composer: single-row pill cluster + auto-grow textarea with inline
	     attach + send icons + examples drawer. Replaces the old 3-row stack
	     (suggestions + Send-to row + input) for ~30% less vertical space
	     on phone. -->
	<div class="shrink-0 border-t border-border bg-background/95 p-2 flex flex-col gap-1.5">

		<!-- Examples drawer (collapsed by default; only rendered when open) -->
		{#if examplesOpen}
			<div class="flex flex-col gap-1 px-1 pb-1 animate-fade-in">
				{#each Array.from(new Set(STARTER_PROMPTS.map((p) => p.category))) as cat (cat)}
					<div class="flex items-center gap-1.5 mt-0.5">
						<span class="text-[10px] font-mono uppercase tracking-wider text-muted-foreground shrink-0 w-20">{cat}</span>
						<div class="flex flex-wrap gap-1">
							{#each STARTER_PROMPTS.filter((p) => p.category === cat) as ex (ex.label)}
								<button
									type="button"
									onclick={() => { textDraft = ex.prompt; examplesOpen = false; textareaEl?.focus(); }}
									class="px-2 py-0.5 rounded bg-surface/50 border border-border text-[11px] font-mono text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors active:scale-95"
								>
									{ex.label}
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Control row: examples button + agent switcher pills, single line -->
		<div class="flex items-center gap-2 select-none text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
			<button
				type="button"
				onclick={() => (examplesOpen = !examplesOpen)}
				class="flex items-center gap-1 rounded border border-border bg-transparent px-1.5 py-0.5 transition-colors active:scale-95 hover:text-foreground hover:border-foreground/30"
				title="Open examples / starter prompts"
				aria-label="Examples"
			>
				<Sparkles size={10} />
				<span>Examples</span>
			</button>
			<span class="text-muted-foreground/50">·</span>
			<span class="shrink-0">Send to</span>
			<div class="flex items-center gap-1">
				<button
					type="button"
					onclick={() => (agentLock = 'auto')}
					class="px-2 py-0.5 rounded border transition-colors active:scale-95
						{agentLock === 'auto'
							? 'border-foreground/30 bg-foreground/5 text-foreground'
							: 'border-border bg-transparent text-muted-foreground hover:text-foreground'}"
					title="Use the @-mention heuristic to decide. Default."
				>
					Auto
				</button>
				<button
					type="button"
					onclick={() => (agentLock = 'claude-code')}
					class="px-2 py-0.5 rounded border transition-colors active:scale-95
						{agentLock === 'claude-code'
							? 'border-orange-400/40 bg-orange-400/10 text-orange-400'
							: 'border-border bg-transparent text-muted-foreground hover:text-foreground'}"
					title="Lock all sends to Claude Code."
				>
					CC
				</button>
				<button
					type="button"
					onclick={() => (agentLock = 'agy')}
					class="px-2 py-0.5 rounded border transition-colors active:scale-95
						{agentLock === 'agy'
							? 'border-purple-400/40 bg-purple-400/10 text-purple-400'
							: 'border-border bg-transparent text-muted-foreground hover:text-foreground'}"
					title="Talk to AGY (Gemini API) — fast chat-mode, no worker spawn. Use Build / Critique on a reply when you want the heavy worker."
				>
					AGY
				</button>
				<button
					type="button"
					onclick={() => (agentLock = 'hermes')}
					class="px-2 py-0.5 rounded border transition-colors active:scale-95
						{agentLock === 'hermes'
							? 'border-status-green/40 bg-status-green/10 text-status-green'
							: 'border-border bg-transparent text-muted-foreground hover:text-foreground'}"
					title="Local Hermes (Qwen via Ollama). Free, fast, no file access — sounding board only."
				>
					Hermes
				</button>
				<button
					type="button"
					onclick={() => (agentLock = 'silent')}
					class="px-2 py-0.5 rounded border transition-colors active:scale-95
						{agentLock === 'silent'
							? 'border-muted-foreground/40 bg-muted-foreground/10 text-muted-foreground'
							: 'border-border bg-transparent text-muted-foreground hover:text-foreground'}"
					title="Log this message in the chat without dispatching any worker (chat note)."
				>
					Silent
				</button>
			</div>
			<span class="text-muted-foreground/50">·</span>
			<!-- Workspace selector pill — drives target_repo on all dispatches -->
			<div class="relative">
				<button
					type="button"
					onclick={() => (repoDropdownOpen = !repoDropdownOpen)}
					class="flex items-center gap-1 rounded border border-border bg-transparent px-1.5 py-0.5 transition-colors active:scale-95 hover:text-foreground hover:border-foreground/30"
					title="Switch target repository for workflow actions"
					aria-label="Select repository"
				>
					<span>{selectedWorkspace?.emoji ?? '📁'}</span>
					<span>{selectedWorkspace?.display_name ?? selectedRepo}</span>
					<ChevronDown size={8} />
				</button>
				{#if repoDropdownOpen}
					<button
						type="button"
						class="fixed inset-0 z-40"
						onclick={() => (repoDropdownOpen = false)}
						aria-label="Close workspace dropdown"
						tabindex="-1"
					></button>
					<div class="absolute bottom-full left-0 mb-1 z-50 min-w-44 rounded border border-border bg-surface shadow-lg py-1 font-mono">
						{#each Array.from(new Set([...(data.workspaces ?? []), ...(showArchivedWorkspaces ? (data.archivedWorkspaces ?? []) : [])].map((w) => w.group))) as grp (grp)}
							<div class="px-2 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/50 mt-1 first:mt-0">{grp}</div>
							{#each [...(data.workspaces ?? []), ...(showArchivedWorkspaces ? (data.archivedWorkspaces ?? []) : [])].filter((w) => w.group === grp) as ws (ws.name)}
								<button
									type="button"
									onclick={() => selectWorkspace(ws.name)}
									class="w-full text-left flex items-center gap-1.5 px-2 py-1 text-[11px] transition-colors hover:bg-foreground/5
										{ws.is_archived ? 'opacity-60' : ''}
										{selectedRepo === ws.name ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}"
								>
									<span>{ws.emoji}</span>
									<span>{ws.display_name}</span>
									{#if selectedRepo === ws.name}
										<Check size={8} class="ml-auto shrink-0" />
									{/if}
								</button>
							{/each}
						{/each}
						{#if (data.archivedWorkspaces ?? []).length > 0 || showArchivedWorkspaces}
							<div class="border-t border-border mt-1 pt-1">
								<button
									type="button"
									onclick={() => (showArchivedWorkspaces = !showArchivedWorkspaces)}
									class="w-full text-left px-2 py-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors flex items-center gap-1"
								>
									{showArchivedWorkspaces ? '▾' : '▸'}
									<span>{showArchivedWorkspaces ? 'Hide' : 'Show'} archived</span>
									{#if (data.archivedWorkspaces ?? []).length > 0}
										<span class="ml-auto">{(data.archivedWorkspaces ?? []).length}</span>
									{/if}
								</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Tier badge: shows current conversation tier (server-driven auto-escalation).
			     Tap → override dropdown. Only visible when using AGY/direct LLM path. -->
			{#if agentLock === 'agy' || agentLock === 'auto'}
				<div class="relative">
					<button
						type="button"
						onclick={() => (tierOverrideOpen = !tierOverrideOpen)}
						class="flex items-center gap-1 rounded border border-border bg-transparent px-1.5 py-0.5 transition-colors active:scale-95 hover:text-foreground hover:border-foreground/30 text-muted-foreground"
						title="Current LLM tier. Tap to override or reset to Auto."
						aria-label="LLM tier override"
					>
						<span>{TIER_LABELS[currentTier]}</span>
					</button>
					{#if tierOverrideOpen}
						<button
							type="button"
							class="fixed inset-0 z-40"
							onclick={() => (tierOverrideOpen = false)}
							aria-label="Close tier dropdown"
							tabindex="-1"
						></button>
						<div class="absolute bottom-full left-0 mb-1 z-50 min-w-36 rounded border border-border bg-surface shadow-lg py-1 font-mono text-[11px]">
							<div class="px-2 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground/50">Lock tier</div>
							{#each (['chat', 'planning', 'deep', 'local'] as Tier[]) as t (t)}
								<button
									type="button"
									onclick={() => setTierOverride(t)}
									class="w-full text-left flex items-center gap-1.5 px-2 py-1 transition-colors hover:bg-foreground/5
										{currentTier === t ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}"
								>
									{TIER_LABELS[t]}
								</button>
							{/each}
							<div class="border-t border-border mt-1 pt-1">
								<button
									type="button"
									onclick={() => setTierOverride(null)}
									class="w-full text-left px-2 py-1 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
								>Auto (reset)</button>
							</div>
						</div>
					{/if}
				</div>
			{/if}
			<!-- Connection status dot: green=connected, amber=reconnecting, red=disconnected.
			     Wired to EventSource (SSE) streams. Debounced 1s to suppress transient blips. -->
			<span
				class="ml-auto shrink-0 h-1.5 w-1.5 rounded-full transition-colors duration-700
					{connStatus === 'green' ? 'bg-status-green' : connStatus === 'amber' ? 'bg-status-amber animate-pulse' : 'bg-status-red'}"
				title={connStatus === 'green' ? 'EventSource: connected' : connStatus === 'amber' ? 'EventSource: reconnecting...' : 'EventSource: disconnected'}
				aria-label="Connection status"
			></span>
		</div>

		<!-- Input field: attach + textarea + send in one flex row -->
		<div class="flex items-end gap-1.5">
			<input
				type="file"
				accept="image/*"
				multiple
				bind:this={attachInputEl}
				onchange={(e) => {
					const input = e.target as HTMLInputElement;
					const files = Array.from(input.files || []).filter((f) => f.type.startsWith('image/'));
					if (files.length > 0) void handleImageFiles(files);
					input.value = '';
				}}
				class="hidden"
			/>
			<button
				type="button"
				onclick={() => attachInputEl?.click()}
				disabled={uploading}
				aria-label="Attach image"
				title="Attach image (or paste / drop one)"
				class="shrink-0 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-transparent text-muted-foreground transition-colors active:scale-90 hover:text-foreground hover:border-foreground/30 disabled:opacity-40 disabled:pointer-events-none"
			>
				{#if uploading}
					<Loader2 size={16} class="animate-spin" />
				{:else}
					<Paperclip size={16} />
				{/if}
			</button>
			<!-- Image-generation toggle. When active, the next send is treated
			     as a Gemini image prompt (gemini-2.5-flash-image). Sticky —
			     stays on for back-to-back image work until the operator
			     turns it off. Indicator: filled green background when ON. -->
			<button
				type="button"
				onclick={() => (imageMode = !imageMode)}
				aria-pressed={imageMode}
				aria-label="Toggle image generation mode"
				title={imageMode
					? 'Image mode ON — next send generates an image via Gemini. Tap to turn off.'
					: 'Turn on image generation. Next send becomes an image prompt (Gemini).'}
				class="shrink-0 flex h-10 w-10 items-center justify-center rounded-md border transition-colors active:scale-90
					{imageMode
						? 'border-status-green/40 bg-status-green/15 text-status-green'
						: 'border-border bg-transparent text-muted-foreground hover:text-foreground hover:border-foreground/30'}"
			>
				<Sparkles size={16} />
			</button>
			<textarea
				bind:value={textDraft}
				bind:this={textareaEl}
				onkeypress={handleKeyPress}
				onpaste={handlePaste}
				ondrop={handleDrop}
				ondragover={(e) => e.preventDefault()}
				rows="1"
				placeholder={uploading
					? 'Uploading image...'
					: imageMode
						? 'Describe the image to generate...'
						: 'Message your agents...'}
				autocomplete="off"
				autocapitalize="none"
				spellcheck="false"
				class="flex-1 rounded-md border border-border bg-surface px-3 py-2 font-sans text-base text-white placeholder:text-muted-foreground resize-none transition-colors focus:border-cta/50 focus:outline-none overflow-y-auto custom-scrollbar"
				style="min-height: 40px; max-height: 168px;"
			></textarea>
			<button
				type="button"
				onclick={handleSendMessage}
				disabled={!textDraft.trim() || sending}
				aria-label="Send message"
				class="shrink-0 flex h-10 w-10 items-center justify-center rounded-md border border-cta/30 bg-cta/15 text-cta transition-all duration-200 active:scale-90 disabled:opacity-40 disabled:pointer-events-none hover:bg-cta/25"
			>
				{#if sending}
					<Loader2 size={16} class="animate-spin" />
				{:else}
					<Send size={16} />
				{/if}
			</button>
		</div>
	</div>
</div>

<style>
	.custom-scrollbar::-webkit-scrollbar {
		width: 4px;
		height: 4px;
	}
	.custom-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb {
		background: #30363d;
		border-radius: 10px;
	}
	.custom-scrollbar::-webkit-scrollbar-thumb:hover {
		background: #484f58;
	}

	.animate-fade-in {
		animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
	}

	/* Visual thread grouping: subtle left-border on any message that's part
	   of a dispatch thread (has a trace_id). Connects the system "dispatched"
	   row, the activity ticker, the streaming bubble, and the final worker
	   reply into one visually-connected group without nesting them in a DOM
	   wrapper. CSS-only — zero JS cost. */
	.thread-grouped {
		border-left: 2px solid rgb(255 255 255 / 0.06);
		padding-left: 0.5rem;
		margin-left: 0.25rem;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
