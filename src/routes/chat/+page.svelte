<script lang="ts">
	import type { PageData } from './$types';
	import type { ChatMessage } from '$lib/types/chat';
	import { onMount, tick } from 'svelte';
	import { resolve } from '$app/paths';
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
		RefreshCw
	} from 'lucide-svelte';
	import { toasts } from '$lib/utils/toasts';
	import { formatShortTime } from '$lib/utils/format';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Markdown from '$lib/components/Markdown.svelte';

	let { data }: { data: PageData } = $props();

	// Active chat state seeded from SSR to ensure zero flicker on load.
	let messages = $state<ChatMessage[]>(data.messages || []);
	let textDraft = $state('');
	let sending = $state(false);
	// Agent selector pill state. 'auto' falls back to the @-mention heuristic;
	// 'claude-code' / 'agy' locks every subsequent send to that worker until
	// the operator picks something else. Persists for the page-load session.
	let agentLock = $state<'auto' | 'claude-code' | 'agy'>('auto');
	let actionSubmitting = $state<number | null>(null); // messageId of active action being updated
	let feedContainer = $state<HTMLDivElement | null>(null);
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	let attachInputEl = $state<HTMLInputElement | null>(null);
	let examplesOpen = $state(false);

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

	// Stick-to-bottom scroll: chat threads should behave like iMessage/Slack —
	// land at the bottom on first paint, auto-scroll on new messages ONLY if
	// the operator is already near the bottom. If they've scrolled up to read
	// history, show a "X new ↓" pill instead of yanking the viewport.
	const SCROLL_NEAR_BOTTOM_PX = 80; // tolerance for "user is at bottom"
	let userAtBottom = $state(true);
	let unseenCount = $state(0);
	let lastSeenMessageId = $state<number | null>(null);

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

	function recomputeAtBottom() {
		if (!feedContainer) return;
		const remaining = feedContainer.scrollHeight - feedContainer.scrollTop - feedContainer.clientHeight;
		userAtBottom = remaining <= SCROLL_NEAR_BOTTOM_PX;
		if (userAtBottom) {
			unseenCount = 0;
			if (messages.length > 0) {
				lastSeenMessageId = messages[messages.length - 1].id;
			}
		}
	}

	function handleFeedScroll() {
		recomputeAtBottom();
	}

	async function jumpToLatest() {
		userAtBottom = true;
		unseenCount = 0;
		if (messages.length > 0) lastSeenMessageId = messages[messages.length - 1].id;
		await scrollToBottom('smooth');
	}

	// Poll the API for new messages stateless and snappy
	async function pollMessages() {
		try {
			const resp = await fetch(resolve('/api/chat'));
			if (!resp.ok) return;
			const body = await resp.json();
			const newMessages: ChatMessage[] = body.messages || [];

			if (newMessages.length === messages.length && JSON.stringify(newMessages) === JSON.stringify(messages)) {
				return;
			}

			const prevLastId = messages.length > 0 ? messages[messages.length - 1].id : null;
			messages = newMessages;

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
				const added = newMessages.filter((m) => prevLastId === null || m.id > prevLastId).length;
				if (added > 0) unseenCount += added;
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
				const url = resolve('/api/chat/stream/' + encodeURIComponent(traceId));
				const es = new EventSource(url);
				es.addEventListener('chunk', (ev) => {
					const data = (ev as MessageEvent).data as string;
					// Server formatted as one data: line per source line; the
					// EventSource API rejoins them with \n. Append + clamp.
					const prev = streamByTrace[traceId] || '';
					let next = prev + (prev.endsWith('\n') || prev.length === 0 ? '' : '\n') + data;
					if (next.length > STREAM_BUFFER_MAX) {
						next = '...[truncated]...\n' + next.slice(next.length - STREAM_BUFFER_MAX);
					}
					streamByTrace = { ...streamByTrace, [traceId]: next };
				});
				es.addEventListener('end', () => {
					streamEnded = { ...streamEnded, [traceId]: true };
					es.close();
					streamSources.delete(traceId);
				});
				es.addEventListener('error', () => {
					// EventSource will auto-retry on transient errors. If the
					// connection ultimately closes, the 'end' handler does the
					// cleanup. Nothing to do here for transient drops.
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
	}

	onMount(() => {
		// First paint may not have measured the feed yet — defer to the next
		// frame so scrollHeight reflects the rendered messages, then jump
		// without animation. Snap-to-bottom feel like iMessage.
		requestAnimationFrame(() => {
			scrollToBottom('auto');
			recomputeAtBottom();
			if (messages.length > 0) {
				lastSeenMessageId = messages[messages.length - 1].id;
			}
		});
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
					agent: agentLock
				})
			});

			if (!resp.ok) {
				const err = await resp.json().catch(() => ({}));
				throw new Error(err.error || `HTTP ${resp.status}`);
			}

			const body = await resp.json();
			// Snappy local append. The operator just sent — always pin them
			// to the bottom so they see their own message + the incoming
			// "Agent dispatched" follow-up.
			messages = [...messages, body.message];
			userAtBottom = true;
			unseenCount = 0;
			lastSeenMessageId = body.message?.id ?? lastSeenMessageId;
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
				body: JSON.stringify({})
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
					target_repo: 'LogueOS-Console'
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
		<PageHeader
			title="Co-Working Chat"
			subtitle="Converse with CC or Antigravity and approve commands on the go."
		/>
		<button
			type="button"
			onclick={handleNewConversation}
			disabled={resetting}
			class="shrink-0 mt-1 flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground hover:bg-surface/80 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
			title="Start a new conversation. Older messages stay visible but won't be replayed as worker context."
		>
			{#if resetting}
				<Loader2 size={10} class="animate-spin" />
			{:else}
				<Plus size={10} />
			{/if}
			<span>New conversation</span>
		</button>
	</div>

	<!-- Main Chat Area (Scrollable Feed) -->
	<div
		bind:this={feedContainer}
		onscroll={handleFeedScroll}
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
							<Cpu size={10} class={m.sender === 'agy' ? 'text-purple-400' : 'text-orange-400'} />
							<span class={m.sender === 'agy' ? 'text-purple-400' : 'text-orange-400'}>{m.sender}</span>
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
							<div
								class="max-w-[85%] rounded-lg rounded-tl-none border border-border bg-surface px-3.5 py-2 font-sans text-sm leading-relaxed select-text text-foreground"
							>
								<Markdown content={buf} />
							</div>
						</div>
					{/if}
				{/if}
				{/each}
			{/if}
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
					title="Lock all sends to Antigravity (Gemini-class)."
				>
					AGY
				</button>
			</div>
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
			<textarea
				bind:value={textDraft}
				bind:this={textareaEl}
				onkeypress={handleKeyPress}
				onpaste={handlePaste}
				ondrop={handleDrop}
				ondragover={(e) => e.preventDefault()}
				rows="1"
				placeholder={uploading ? 'Uploading image...' : "Message your agents..."}
				autocomplete="off"
				autocorrect="off"
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
