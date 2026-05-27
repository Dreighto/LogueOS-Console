<script lang="ts">
	// Chat Surface V2 — Conversational OS (AGY Redo).
	//
	// Design philosophy:
	//   - Full-bleed immersive canvas. No global chrome.
	//   - Conversation IS the interface.
	//   - Composer is the hero: glowing pill, color-shifting states.
	//   - Solid, readable menus (no transparent text overlays on gradients).
	//   - Glowing orange operator outlines & cyan agent labels.
	//   - Dedicated collapsible left sidebar for threads & pinned sessions.
	//   - 100% wired controls (Mic dictation, Paperclip uploads, Sparkles image mode, Talkback loop).

	import { onMount, onDestroy, untrack } from 'svelte';
	import { base, resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { Chat } from '@ai-sdk/svelte';
	import { DefaultChatTransport } from 'ai';
	import {
		Send,
		Mic,
		Paperclip,
		Sparkles,
		Headphones,
		Square,
		ChevronDown,
		Menu,
		X,
		Plus,
		Pin,
		MessageSquare,
		Check,
		Copy,
		RefreshCw,
		MoreVertical,
		Edit3,
		Archive,
		ArchiveRestore,
		Trash2,
		Eraser,
		Loader2
	} from 'lucide-svelte';
	import { toasts } from '$lib/utils/toasts';
	import Markdown from '$lib/components/Markdown.svelte';
	import Canvas from '$lib/components/Canvas.svelte';

	let { data } = $props();

	// ─────────────────────────────────────────────────────────────────────
	// State Declarations
	// ─────────────────────────────────────────────────────────────────────
	type Tier = 'chat' | 'planning' | 'deep' | 'local';
	type ChatMessage = {
		id: number;
		sender: string;
		message: string;
		timestamp: string;
		image_path?: string | null;
	};

	let messages = $state<ChatMessage[]>(data.messages || []);
	let activeThread = $state(data.activeThread || 'default');
	let workspaces = $state(data.workspaces || []);
	let threads = $state(data.threads || []);

	let textDraft = $state('');
	let selectedRepo = $state('LogueOS-Console');
	let currentTier = $state<Tier>('chat');
	let lastModelUsed = $state('');
	let sending = $state(false);

	let showModelOverrideModal = $state(false);

	// Workspace-context editor (task #22 — Projects-light borrow).
	let workspaceContextOpen = $state(false);
	let workspaceContextDraft = $state('');
	let workspaceContextSaving = $state(false);
	const WORKSPACE_CONTEXT_MAX = 4000;
	let sidebarOpen = $state(false);
	let imageMode = $state(false);

	// Ephemeral worker-activity pill state.
	let activityPill = $state<{ worker: string; step: string; trace_id: string } | null>(null);
	let activityFadeTimer: ReturnType<typeof setTimeout> | null = null;

	// Composer states
	let composerMode = $state<'idle' | 'focused' | 'recording' | 'talkback'>('idle');
	let openChip = $state<null | 'repo' | 'thread'>(null);

	// Sidebar / thread-management state — declared up here (not next to the
	// rest of thread-management code lower in the file) so the global popover
	// handler can reference it without forward-declaration issues.
	let threadMenuOpenFor = $state<string | null>(null);

	// Close every open popover. Used by the global Escape + click-outside
	// handler below. Replaces the per-popover `fixed inset-0 z-40` backdrop
	// `<button>` pattern that was trapping clicks on other chrome — see audit
	// 2026-05-27 and [[reference_chat_app_competitive_borrows]] for the bug
	// shape.
	function closeAllPopovers() {
		openChip = null;
		showModelOverrideModal = false;
		threadMenuOpenFor = null;
	}

	// Global popover dismiss — keyboard Escape + click outside any popover
	// content closes everything open. Each popover content `<div>` carries
	// `data-popover` (clicks inside the open popover are left alone), each
	// opener `<button>` carries `data-popover-trigger`.
	//
	// Trigger clicks DO close all popovers via this handler; the trigger's
	// own onclick fires after (capture vs bubble) and re-opens just its own
	// popover. Net result: clicking one trigger while another popover is
	// open swaps the popovers in a single tap.
	$effect(() => {
		const anyOpen =
			openChip !== null || showModelOverrideModal || threadMenuOpenFor !== null;
		if (!anyOpen) return;
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') {
				e.preventDefault();
				closeAllPopovers();
			}
		}
		function onPointerDown(e: PointerEvent) {
			const target = e.target as HTMLElement | null;
			if (!target) return;
			// Clicks INSIDE an open popover are left alone (let the popover's
			// own onclick fire — choose a model, switch repo, etc.).
			if (target.closest('[data-popover]')) return;
			closeAllPopovers();
		}
		window.addEventListener('keydown', onKey);
		window.addEventListener('pointerdown', onPointerDown, true);
		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('pointerdown', onPointerDown, true);
		};
	});

	// MediaRecorder for dictation
	let mediaRecorder: MediaRecorder | null = null;
	let recordChunks: Blob[] = [];

	// Persistent audio for TTS
	let audioEl = $state<HTMLAudioElement | null>(null);
	let audioUnlocked = false;

	// Talkback state machine variables (PR 5)
	let talkbackActive = $state(false);
	type TalkbackPhase = 'capture' | 'transcribe' | 'dispatch' | 'speak' | 'loop';
	let talkbackPhase = $state<TalkbackPhase | null>(null);

	let talkbackStream: MediaStream | null = null;
	let talkbackAudioCtx: AudioContext | null = null;
	let talkbackProcessor: ScriptProcessorNode | null = null;
	let talkbackWakeLock: WakeLockSentinel | null = null;
	let talkbackWs: WebSocket | null = null;
	let talkbackTranscriptBuffer = '';
	let talkbackTtsAbortController: AbortController | null = null;
	let talkbackDispatchMsgId: number | null = null;
	let talkbackConsecutiveFailures = 0;
	let continuousSilenceMs = 0;

	// Talkback constants
	const TALKBACK_SILENCE_AUTOSTOP_MS = 3 * 60 * 1000;
	const TALKBACK_SILENCE_THRESHOLD = 0.01;
	const TALKBACK_SILENCE_GATE_MS = 2500;
	const TALKBACK_MAX_CAPTURE_MS = 30_000;

	// Element refs
	let feedContainer = $state<HTMLDivElement | null>(null);
	let scrollSentinel = $state<HTMLDivElement | null>(null);
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	// SDK chat instance — handles streaming sends through /api/chat/sdk-stream.
	// PR 2b.2 (this commit) uses it for the conversational happy path only.
	// Dispatch (@cc/@agy), image-gen, and slash commands still go through the
	// legacy non-streaming /api/chat. PR 2b.3 deletes the legacy stream path.
	// Server assembles context from chat_messages DB on each request, so the
	// SDK chat.messages is just a streaming pipe — reset between sends.
	//
	// IMPORTANT: SDK 6's Chat class does NOT accept `api`/`body` shorthand at
	// the top level (those are ignored silently — caused PR 2b.2 first-run
	// bug where sends went to the default `/api/chat`, not `/console/api/chat/
	// sdk-stream`). Use `DefaultChatTransport` instead.
	const sdkChat = new Chat({
		transport: new DefaultChatTransport({
			api: resolve('/api/chat/sdk-stream'),
			body: () => ({
				thread: activeThread,
				target_repo: selectedRepo,
				provider:
					providerOverride === 'gemini' ? 'google' : providerOverride ?? undefined
			})
		})
	});
	// While an SDK stream is active, this carries the placeholder bubble's
	// id AND the owning thread's id. Tracking the thread is critical: if the
	// operator switches threads mid-stream, pollMessages for the NEW thread
	// must NOT be suppressed — only the old thread's poll race needs gating.
	// Per CR review on PR #129.
	let streamState = $state<{ placeholderId: number; threadId: string } | null>(null);

	// Pending attachments — uploads stage here as removable chips above the
	// composer rather than getting injected as markdown into the textarea.
	// On send, each attachment's markdown link is appended to the outgoing
	// message body so the server-side rendering stays unchanged. A `text`
	// field on an Attachment marks it as a paste-to-attachment chip — the
	// content lives in memory, no upload, folded into the message body as
	// a fenced code block on send. See [[reference_chat_app_competitive_borrows]]
	// for the ChatGPT-borrow rationale (long pastes auto-convert to keep
	// composer clean + prevent context-window blowout).
	type Attachment = {
		id: string;
		filename: string;
		url: string;
		mime: string;
		size: number;
		uploading?: boolean;
		text?: string;
	};
	let attachments = $state<Attachment[]>([]);

	// Canvas (Artifacts) side panel — PR A of #20 epic. View-only for now;
	// multi-tab + persistence land in follow-up PRs.
	let canvasArtifact = $state<{ code: string; language: string } | null>(null);
	function openCanvas(code: string, language: string) {
		canvasArtifact = { code, language };
	}
	function closeCanvas() {
		canvasArtifact = null;
	}
	const PASTE_TO_ATTACHMENT_THRESHOLD = 5000;

	// Scroll state
	let userAtBottom = $state(true);
	let unseenCount = $state(0);

	// ─────────────────────────────────────────────────────────────────────
	// Derived properties
	// ─────────────────────────────────────────────────────────────────────
	const selectedWorkspace = $derived(workspaces.find((w) => w.name === selectedRepo));
	const tierEmoji = $derived(
		currentTier === 'planning'
			? '⚖️'
			: currentTier === 'deep'
				? '🧠'
				: currentTier === 'local'
					? '🔧'
					: '🪶'
	);

	// ─────────────────────────────────────────────────────────────────────
	// Draft Persist Effect
	// ─────────────────────────────────────────────────────────────────────
	let draftDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const text = textDraft;
		if (draftDebounceTimer) clearTimeout(draftDebounceTimer);
		draftDebounceTimer = setTimeout(() => {
			const tid = activeThread;
			void fetch(resolve(`/api/chat/drafts?thread_id=${encodeURIComponent(tid)}`), {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ body: text })
			}).catch(() => {});
		}, 400);
	});

	// Auto-grow the composer textarea with the draft. Resting state is one
	// line (~40px — feels like a real input, not an essay block). Grows
	// smoothly past one line up to roughly half the viewport (capped 480px)
	// then scrolls internally. Audit 2026-05-27 + operator feedback flagged
	// the previous 80px floor as too tall for the empty state.
	const COMPOSER_MIN_PX = 40;
	function composerMaxHeight(): number {
		if (typeof window === 'undefined') return 360;
		return Math.min(Math.round(window.innerHeight * 0.5), 480);
	}
	$effect(() => {
		const _ = textDraft; // dep — re-run whenever the draft changes
		void _;
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		const max = composerMaxHeight();
		const target = Math.min(Math.max(textareaEl.scrollHeight, COMPOSER_MIN_PX), max);
		textareaEl.style.height = `${target}px`;
	});

	// ─────────────────────────────────────────────────────────────────────
	// Network & Data Actions
	// ─────────────────────────────────────────────────────────────────────
	async function loadTier(threadId: string) {
		try {
			const r = await fetch(resolve(`/api/chat/tier?thread_id=${encodeURIComponent(threadId)}`));
			if (r.ok) {
				const b = await r.json();
				if (b.current_tier) currentTier = b.current_tier as Tier;
				providerOverride = (b.provider_override ?? null) as ProviderPref;
				lastModelUsed = b.last_model_used || '';
			}
		} catch {
			/* keep last known */
		}
	}

	type ProviderPref = 'anthropic' | 'gemini' | 'local' | null;
	let providerOverride = $state<ProviderPref>(null);

	// Concrete model picker — operator picks a specific model and we
	// translate it to a (tier, provider) pair that the router will pin.
	// 'auto' = no overrides (smart routing).
	type ModelChoice = {
		id: string;
		label: string;
		sublabel: string;
		tier: Tier | null;
		provider: ProviderPref;
	};
	const MODEL_CHOICES: ModelChoice[] = [
		{ id: 'auto', label: 'Auto', sublabel: 'smart tier routing', tier: null, provider: null },
		{
			id: 'claude-haiku',
			label: 'Claude Haiku 4.5',
			sublabel: 'fast · chat tier',
			tier: 'chat',
			provider: 'anthropic'
		},
		{
			id: 'claude-sonnet',
			label: 'Claude Sonnet 4.6',
			sublabel: 'planning',
			tier: 'planning',
			provider: 'anthropic'
		},
		{
			id: 'claude-opus',
			label: 'Claude Opus 4.7',
			sublabel: 'deep',
			tier: 'deep',
			provider: 'anthropic'
		},
		{
			id: 'gemini-flash-lite',
			label: 'Gemini 2.5 Flash-lite',
			sublabel: 'fast · chat tier',
			tier: 'chat',
			provider: 'gemini'
		},
		{
			id: 'gemini-flash',
			label: 'Gemini 2.5 Flash',
			sublabel: 'planning',
			tier: 'planning',
			provider: 'gemini'
		},
		{
			id: 'gemini-pro',
			label: 'Gemini 2.5 Pro',
			sublabel: 'deep',
			tier: 'deep',
			provider: 'gemini'
		},
		{ id: 'local', label: 'Local (Ollama)', sublabel: 'offline', tier: 'local', provider: 'local' }
	];

	const selectedModelChoice = $derived(
		MODEL_CHOICES.find(
			(c) =>
				(c.tier ?? null) === (currentTier === 'chat' && !providerOverride ? null : currentTier) &&
				c.provider === providerOverride
		) ?? MODEL_CHOICES[0]
	);

	async function openWorkspaceContextEditor() {
		closeAllPopovers();
		workspaceContextOpen = true;
		workspaceContextDraft = '';
		try {
			const r = await fetch(
				resolve('/api/chat/workspaces/' + encodeURIComponent(selectedRepo) + '/context')
			);
			if (r.ok) {
				const body = (await r.json()) as { addendum?: string };
				workspaceContextDraft = body.addendum ?? '';
			}
		} catch {
			/* network error — operator sees empty editor */
		}
	}

	async function saveWorkspaceContext() {
		if (workspaceContextSaving) return;
		workspaceContextSaving = true;
		try {
			const r = await fetch(
				resolve('/api/chat/workspaces/' + encodeURIComponent(selectedRepo) + '/context'),
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ addendum: workspaceContextDraft })
				}
			);
			if (r.ok) {
				toasts.add(`Context saved for ${selectedRepo}`, 'success');
				workspaceContextOpen = false;
			} else {
				toasts.add('Save failed', 'error');
			}
		} catch {
			toasts.add('Save failed — network error', 'error');
		} finally {
			workspaceContextSaving = false;
		}
	}

	async function setModelChoice(choice: ModelChoice) {
		showModelOverrideModal = false;
		try {
			const resp = await fetch(resolve('/api/chat/tier'), {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					thread_id: activeThread,
					tier: choice.tier,
					provider: choice.provider
				})
			});
			if (resp.ok) {
				const body = await resp.json();
				if (body.current_tier) currentTier = body.current_tier as Tier;
				providerOverride = (body.provider_override ?? null) as ProviderPref;
				await loadTier(activeThread);
				toasts.add(`Model set to ${choice.label}`, 'success');
			}
		} catch {
			toasts.add('Failed to update model preference', 'error');
		}
	}

	async function pollMessages(forThread?: string) {
		// Capture the thread the caller intended at the moment of the request.
		// Without this guard a slow in-flight poll for the previous thread can
		// land after switchThread() has flipped activeThread and clobber the
		// new thread's (empty) messages with the previous thread's content —
		// exact symptom the operator reported: "old thread shows up instead
		// of a clean slate."
		const requestedThread = forThread ?? activeThread;
		// Skip the reconciliation while an SDK stream is in flight — the
		// placeholder bubble's partial text would get wiped by the DB-driven
		// replacement (which doesn't yet contain the streaming reply). The
		// stream's own finally{} block calls pollMessages once after the
		// stream completes, so the canonical row lands then. Audit 2026-05-27
		// caught this race live as "operator's send disappears from the UI".
		// Only suppress when the in-flight stream is for THIS same thread.
		// Switching threads mid-stream must allow the new thread's poll to land.
		if (streamState && streamState.threadId === requestedThread) return;
		try {
			const r = await fetch(
				resolve('/api/chat') + `?thread=${encodeURIComponent(requestedThread)}`
			);
			if (!r.ok) return;
			// Drop the response if the operator switched threads while the
			// fetch was in flight. The 3s poll will re-fire with the new thread.
			if (requestedThread !== activeThread) return;
			const b = await r.json();
			const newMessages: ChatMessage[] = b.messages || [];
			if (
				newMessages.length !== messages.length ||
				JSON.stringify(newMessages) !== JSON.stringify(messages)
			) {
				if (!userAtBottom) {
					const added = newMessages.length - messages.length;
					if (added > 0) unseenCount += added;
				}
				messages = newMessages;
				if (userAtBottom) {
					queueMicrotask(() => scrollSentinel?.scrollIntoView({ behavior: 'smooth' }));
				}
			}
		} catch {
			/* offline */
		}
	}

	async function pollActivity() {
		try {
			const r = await fetch(resolve('/api/chat/activity?limit=8'));
			if (!r.ok) return;
			const b = await r.json();
			const rows = (b.activity || []) as Array<{
				trace_id: string;
				action: string;
				target: string | null;
				timestamp: string;
			}>;
			const cutoff = Date.now() - 5 * 60 * 1000;
			let live: typeof activityPill = null;
			for (const row of rows) {
				if (new Date(row.timestamp).getTime() < cutoff) continue;
				if (row.action === 'completed' || row.action === 'failed') continue;
				const worker = row.trace_id.startsWith('agy-') ? 'AGY' : 'CC';
				const step = row.target ? `${row.action} '${row.target}'` : row.action;
				live = { worker, step, trace_id: row.trace_id };
				break;
			}
			if (live) {
				activityPill = live;
				if (activityFadeTimer) clearTimeout(activityFadeTimer);
				activityFadeTimer = setTimeout(() => {
					if (activityPill?.trace_id === live!.trace_id) activityPill = null;
				}, 60_000);
			} else if (activityPill) {
				if (activityFadeTimer) clearTimeout(activityFadeTimer);
				activityFadeTimer = setTimeout(() => {
					activityPill = null;
				}, 3000);
			}
		} catch {
			/* silent */
		}
	}

	// ─────────────────────────────────────────────────────────────────────
	// Audio iOS workaround
	// ─────────────────────────────────────────────────────────────────────
	function unlockAudio() {
		if (audioUnlocked || !audioEl) return;
		try {
			audioEl.src =
				'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
			void audioEl.play().catch(() => {});
			audioUnlocked = true;
		} catch {
			/* best effort */
		}
	}

	// ─────────────────────────────────────────────────────────────────────
	// Send text message
	// ─────────────────────────────────────────────────────────────────────
	async function sendMessage() {
		// Slash command takes precedence — if the draft is /<known-command>
		// we run it locally instead of dispatching to /api/chat.
		if (await runSlashFromDraft()) return;

		const text = textDraft.trim();
		// Allow sending an attachment-only message (no text body), but require
		// at least one of the two so we don't post empty rows.
		if (!text && attachments.length === 0) return;
		if (sending) return;
		if (attachments.some(a => a.uploading)) {
			toasts.add('Wait for image upload to finish', 'info');
			return;
		}
		unlockAudio();
		sending = true;

		const isGenImage = imageMode;
		imageMode = false; // toggle off image mode immediately on send

		// Fold staged attachments into the outgoing message body as markdown
		// image links. The server is unchanged — the message field is a string;
		// the chat renderer already handles ![alt](url) markdown. Chips just
		// stage them visually until send.
		const attachmentMd = attachments
			.map((a) =>
				a.text
					? `\n\`\`\`\n${a.text}\n\`\`\`\n`
					: `![${a.filename}](${a.url})`
			)
			.join('\n');
		const messageBody = [text, attachmentMd].filter(Boolean).join('\n\n');

		const optimistic: ChatMessage = {
			id: Date.now(),
			sender: 'operator',
			message: messageBody,
			timestamp: new Date().toISOString()
		};
		messages = [...messages, optimistic];
		textDraft = '';
		attachments = [];
		queueMicrotask(() => scrollSentinel?.scrollIntoView({ behavior: 'smooth' }));

		// Routing decision: if the message looks like an explicit worker
		// dispatch or it's an image-gen request, use the non-streaming
		// /api/chat endpoint. Otherwise stream tokens via the SDK (which
		// hits /api/chat/sdk-stream — see runStreamingSend below).
		const lower = messageBody.toLowerCase();
		const isDispatch = lower.includes('@cc') || lower.includes('@agy') || lower.includes('@gemini');
		const useStream = !isDispatch && !isGenImage;

		try {
			if (useStream) {
				await runStreamingSend(messageBody);
			} else {
				const r = await fetch(resolve('/api/chat'), {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						message: messageBody,
						thread: activeThread,
						target_repo: selectedRepo,
						image: isGenImage || undefined
					})
				});
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				await pollMessages();
			}
		} catch (e) {
			toasts.add(`Send failed: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
			textDraft = text; // restore
		} finally {
			sending = false;
		}
	}

	function handlePaste(e: ClipboardEvent) {
		const items = Array.from(e.clipboardData?.items ?? []);
		const imageFiles = items
			.filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
			.map((it) => it.getAsFile())
			.filter((f): f is File => f !== null);
		if (imageFiles.length > 0) {
			e.preventDefault();
			for (const f of imageFiles) {
				void uploadOneFile(f);
			}
			return;
		}
		// Long-paste auto-attach (ChatGPT-borrow #19): pastes over the
		// threshold get converted to an attachment chip rather than dumped
		// into the textarea. Keeps the composer clean and prevents huge
		// context-window blowout when pasting logs / docs / JSON. The text
		// is folded back into the message body as a fenced code block on send.
		const pastedText = e.clipboardData?.getData('text/plain') ?? '';
		if (pastedText.length > PASTE_TO_ATTACHMENT_THRESHOLD) {
			e.preventDefault();
			const id =
				typeof crypto !== 'undefined' && 'randomUUID' in crypto
					? crypto.randomUUID()
					: `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const ts = new Date().toISOString().slice(11, 19);
			attachments = [
				...attachments,
				{
					id,
					filename: `paste-${ts}.txt`,
					url: '',
					mime: 'text/plain',
					size: pastedText.length,
					text: pastedText
				}
			];
			toasts.add(`Pasted ${pastedText.length.toLocaleString()} chars as attachment`, 'info');
		}
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void sendMessage();
		}
	}

	// Set of message ids currently showing the "Copied" check on their copy
	// button. Cleared 1500ms after copy fires.
	// Regenerate flow — operator clicks "Regenerate" on an AGY reply. We
	// find the prior operator message in the same thread, delete the
	// existing reply, then re-stream a new one. Old reply gets replaced
	// rather than stacking up.
	let regeneratingIds = $state(new Set<number>());
	async function regenerateReply(m: ChatMessage) {
		if (sending || regeneratingIds.has(m.id)) return;
		// Find the most recent operator message before this reply.
		const idx = messages.findIndex((x) => x.id === m.id);
		if (idx < 0) return;
		let priorOperator: ChatMessage | null = null;
		for (let i = idx - 1; i >= 0; i--) {
			if (messages[i].sender === 'operator') {
				priorOperator = messages[i];
				break;
			}
		}
		if (!priorOperator) {
			toasts.add('No prior message to regenerate from', 'error');
			return;
		}
		regeneratingIds = new Set([...regeneratingIds, m.id]);
		sending = true;
		try {
			// Drop the old reply server-side + optimistically from the feed so
			// the streamed replacement lands in the right place.
			await fetch(resolve(`/api/chat?id=${m.id}`), { method: 'DELETE' }).catch(() => null);
			messages = messages.filter((x) => x.id !== m.id);
			await runStreamingSend(priorOperator.message);
		} catch (e) {
			toasts.add(`Regenerate failed: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
		} finally {
			sending = false;
			regeneratingIds = new Set([...regeneratingIds].filter((i) => i !== m.id));
		}
	}

	let copiedIds = $state(new Set<number>());
	async function copyMessage(m: ChatMessage) {
		try {
			await navigator.clipboard.writeText(m.message);
			copiedIds = new Set([...copiedIds, m.id]);
			setTimeout(() => {
				copiedIds = new Set([...copiedIds].filter((i) => i !== m.id));
			}, 1500);
		} catch {
			toasts.add('Clipboard unavailable — long-press to copy manually', 'error');
		}
	}

	// Streaming send via @ai-sdk/svelte's Chat against /api/chat/sdk-stream.
	// Inserts a placeholder assistant bubble (sender derived from active
	// provider), the SDK transport handles the token stream, and the server's
	// onFinish callback persists the canonical row. pollMessages() at the
	// end reconciles the placeholder against the canonical numeric-id row.
	// Mirror SDK chat's streaming text into the placeholder bubble so the rest
	// of the chat surface keeps a single render path off `messages`. While a
	// stream is active, the last assistant message in chat.messages carries
	// the in-progress reply — copy its text into the local placeholder row.
	//
	// Wrap the messages-write in untrack(): reading `messages` inside the
	// effect would self-trigger every time we write, blowing up Svelte's
	// effect_update_depth_exceeded guard. We only want the effect to re-run
	// when sdkChat.messages changes, not when our own write lands.
	$effect(() => {
		if (streamState === null) return;
		const list = sdkChat.messages;
		const lastIdx = list.length - 1;
		if (lastIdx < 0) return;
		const last = list[lastIdx];
		if (last.role !== 'assistant') return;
		const txt = (last.parts || [])
			.filter((p) => p.type === 'text')
			.map((p) => (p as { type: 'text'; text: string }).text)
			.join('');
		if (!txt) return;
		const id = streamState.placeholderId;
		untrack(() => {
			messages = messages.map((m) => (m.id === id ? { ...m, message: txt } : m));
		});
		if (userAtBottom) {
			queueMicrotask(() => scrollSentinel?.scrollIntoView({ behavior: 'smooth' }));
		}
	});

	async function runStreamingSend(messageBody: string) {
		const STREAM_ID = Date.now() + 1; // distinct from the operator optimistic id
		// Insert an empty placeholder; tokens will append. With this bubble
		// present, the thinking-dots indicator suppresses (last msg !== operator).
		// Sender derived from active provider so the bubble label (AGY / CC)
		// matches what the SDK endpoint will persist. pollMessages reconciles
		// to the canonical DB row after the stream completes.
		const placeholderSender: ChatMessage['sender'] =
			providerOverride === 'anthropic'
				? 'cc'
				: providerOverride === 'local'
					? 'local'
					: 'agy';
		messages = [
			...messages,
			{
				id: STREAM_ID,
				sender: placeholderSender,
				message: '',
				timestamp: new Date().toISOString()
			} as ChatMessage
		];
		streamState = { placeholderId: STREAM_ID, threadId: activeThread };

		// Reset SDK chat history before each send — the server assembles the
		// real context from chat_messages DB. We use sdkChat strictly as a
		// streaming transport, not a context store. Without the reset, each
		// send would carry the previous SDK turns as duplicate body.messages.
		// (@ai-sdk/svelte exposes `messages` as a direct setter, not a
		// setMessages() method — that's react-only.)
		sdkChat.messages = [];

		let errored = false;
		try {
			await sdkChat.sendMessage({ text: messageBody });
		} catch (err) {
			errored = true;
			const msg = err instanceof Error ? err.message : 'unknown';
			toasts.add(`LLM stream failed: ${msg}`, 'error');
			messages = messages.map((m) =>
				m.id === STREAM_ID ? { ...m, message: `⚠️ ${msg}` } : m
			);
		} finally {
			streamState = null;
			if (errored) {
				messages = messages.filter((m) => m.id !== STREAM_ID);
			}
		}

		// Reconcile against the persisted DB state — the SDK endpoint's
		// onFinish callback wrote the assistant row before closing the stream,
		// so pollMessages picks up the canonical numeric-id row and the
		// optimistic STREAM_ID placeholder gets replaced. CRITICAL: without
		// this call, the placeholder's sender label (set from client-side
		// providerOverride above) stays stale — DB has the right sender but
		// the UI never refreshes to show it.
		if (!errored) {
			await pollMessages();
		}
	}

	// Tiny local-only setter for the model label badge — avoids hitting the
	// /api/chat/tier roundtrip just to display the model used.
	function upsertThreadTier_local(modelUsed: string) {
		if (modelUsed) lastModelUsed = modelUsed;
	}

	// ─────────────────────────────────────────────────────────────────────
	// Voice dictation (Mic button - One-shot)
	// ─────────────────────────────────────────────────────────────────────
	async function toggleRecord() {
		unlockAudio();
		if (composerMode === 'recording') {
			mediaRecorder?.stop();
			return;
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true }
			});
			recordChunks = [];
			mediaRecorder = new MediaRecorder(stream);
			mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) recordChunks.push(e.data);
			};
			mediaRecorder.onstop = async () => {
				composerMode = 'idle';
				stream.getTracks().forEach((t) => t.stop());
				const blob = new Blob(recordChunks, { type: 'audio/webm' });
				const fd = new FormData();
				fd.append('file', blob, 'rec.webm');
				try {
					const r = await fetch(resolve('/api/chat/transcribe'), { method: 'POST', body: fd });
					if (!r.ok) {
						toasts.add('Transcription failed', 'error');
						return;
					}
					const b = await r.json();
					if (b.text) {
						textDraft = (textDraft + ' ' + b.text).trim();
						// Re-focus composer
						textareaEl?.focus();
					}
				} catch {
					toasts.add('Transcription service unreachable', 'error');
				}
			};
			mediaRecorder.start();
			composerMode = 'recording';
		} catch {
			toasts.add('Microphone permission denied', 'error');
		}
	}

	// ─────────────────────────────────────────────────────────────────────
	// Hands-free continuous Talkback Loop (PR 5)
	// ─────────────────────────────────────────────────────────────────────
	function pSleep(ms: number): Promise<void> {
		return new Promise((r) => setTimeout(r, ms));
	}

	function playChime(): Promise<void> {
		return new Promise((resolve) => {
			try {
				const ctx = new AudioContext();
				const osc = ctx.createOscillator();
				const gain = ctx.createGain();
				osc.connect(gain);
				gain.connect(ctx.destination);
				osc.type = 'sine';
				osc.frequency.value = 880;
				gain.gain.setValueAtTime(0.2, ctx.currentTime);
				gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
				osc.start(ctx.currentTime);
				osc.stop(ctx.currentTime + 0.25);
				osc.onended = () => {
					ctx.close().catch(() => {});
					resolve();
				};
			} catch {
				resolve();
			}
		});
	}

	function talkbackStopCapture() {
		talkbackStream?.getTracks().forEach((t) => t.stop());
		talkbackStream = null;
		talkbackProcessor?.disconnect();
		talkbackProcessor = null;
		talkbackAudioCtx?.close().catch(() => {});
		talkbackAudioCtx = null;
		if (talkbackWs && talkbackWs.readyState === WebSocket.OPEN) {
			try {
				talkbackWs.send(JSON.stringify({ terminate_session: true }));
			} catch {}
			talkbackWs.close();
		}
		talkbackWs = null;
	}

	async function stopTalkback(reason?: string) {
		talkbackActive = false;
		composerMode = 'idle';
		talkbackPhase = null;
		talkbackDispatchMsgId = null;
		talkbackStopCapture();
		talkbackTtsAbortController?.abort();
		talkbackTtsAbortController = null;
		if (audioEl && !audioEl.paused) {
			audioEl.pause();
			audioEl.currentTime = 0;
		}
		if (talkbackWakeLock) {
			await talkbackWakeLock.release().catch(() => {});
			talkbackWakeLock = null;
		}
		if (reason) toasts.add(reason, 'info');
	}

	async function toggleTalkback() {
		if (talkbackActive) {
			// No toast on manual stop — the pill returns to idle, which is signal enough.
			// Auto-stop paths (cap hit, mic disconnected, error streak) still toast
			// because their reason carries information the operator needs.
			await stopTalkback();
			return;
		}
		unlockAudio();
		try {
			if ('wakeLock' in navigator) {
				talkbackWakeLock = await (
					navigator as Navigator & {
						wakeLock: { request(type: string): Promise<WakeLockSentinel> };
					}
				).wakeLock.request('screen');
			}
		} catch {
			/* continuous without lock */
		}
		talkbackActive = true;
		composerMode = 'talkback';
		talkbackConsecutiveFailures = 0;
		continuousSilenceMs = 0;
		void beginTalkbackCapture();
	}

	async function beginTalkbackCapture() {
		if (!talkbackActive) return;
		talkbackPhase = 'capture';
		talkbackTranscriptBuffer = '';

		try {
			talkbackStream = await navigator.mediaDevices.getUserMedia({
				audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 }
			});

			talkbackStream.getTracks().forEach((track) => {
				track.onended = () => {
					if (talkbackActive) {
						void stopTalkback('Microphone disconnected — Talkback stopped');
					}
				};
			});

			const tokenResp = await fetch(resolve('/api/chat/transcribe/stream'));
			if (!tokenResp.ok) {
				if (tokenResp.status === 429) {
					await stopTalkback('STT daily cap reached — Talkback stopped');
					return;
				}
				throw new Error(`Token fetch ${tokenResp.status}`);
			}
			const { ws_url } = (await tokenResp.json()) as { token: string; ws_url: string };

			talkbackAudioCtx = new AudioContext({ sampleRate: 16000 });
			const source = talkbackAudioCtx.createMediaStreamSource(talkbackStream);

			const bufferSize = 4096;
			talkbackProcessor = talkbackAudioCtx.createScriptProcessor(bufferSize, 1, 1);
			source.connect(talkbackProcessor);
			talkbackProcessor.connect(talkbackAudioCtx.destination);

			talkbackWs = new WebSocket(ws_url);
			talkbackWs.binaryType = 'arraybuffer';

			let captureEndResolve: (() => void) | null = null;
			const capturePromise = new Promise<void>((res) => {
				captureEndResolve = res;
			});
			let captureTimeout: ReturnType<typeof setTimeout> | null = null;
			let localSilenceStart: number | null = null;
			let wsReady = false;

			talkbackWs.onopen = () => {
				wsReady = true;
				captureTimeout = setTimeout(() => {
					captureEndResolve?.();
				}, TALKBACK_MAX_CAPTURE_MS);
			};

			talkbackWs.onmessage = (event) => {
				try {
					const msg = JSON.parse(event.data as string) as {
						message_type: string;
						text?: string;
					};
					if (msg.message_type === 'FinalTranscript' && msg.text?.trim()) {
						talkbackTranscriptBuffer += (talkbackTranscriptBuffer ? ' ' : '') + msg.text.trim();
						const lower = msg.text.toLowerCase();
						if (lower.includes('stop talkback') || lower.includes('cancel talkback')) {
							void stopTalkback('Stop word detected — Talkback stopped');
							captureEndResolve?.();
						}
					}
				} catch {}
			};

			talkbackWs.onerror = () => captureEndResolve?.();
			talkbackWs.onclose = () => captureEndResolve?.();

			talkbackProcessor.onaudioprocess = (e) => {
				if (!talkbackActive) return;
				const inputData = e.inputBuffer.getChannelData(0);

				let sum = 0;
				for (let i = 0; i < inputData.length; i++) {
					sum += inputData[i] * inputData[i];
				}
				const rms = Math.sqrt(sum / inputData.length);
				const now = Date.now();

				if (rms < TALKBACK_SILENCE_THRESHOLD) {
					if (localSilenceStart === null) localSilenceStart = now;
					const silenceDur = now - localSilenceStart;
					continuousSilenceMs += (inputData.length / 16000) * 1000;

					if (continuousSilenceMs >= TALKBACK_SILENCE_AUTOSTOP_MS) {
						void stopTalkback('3 minutes of silence — Talkback auto-stopped');
						captureEndResolve?.();
						return;
					}
					if (silenceDur >= TALKBACK_SILENCE_GATE_MS && talkbackTranscriptBuffer.trim()) {
						captureEndResolve?.();
					}
				} else {
					localSilenceStart = null;
					continuousSilenceMs = 0;
				}

				if (wsReady && talkbackWs?.readyState === WebSocket.OPEN) {
					const pcm16 = new Int16Array(inputData.length);
					for (let i = 0; i < inputData.length; i++) {
						pcm16[i] = Math.max(-32768, Math.min(32767, Math.floor(inputData[i] * 32768)));
					}
					talkbackWs.send(pcm16.buffer);
				}
			};

			await capturePromise;
			if (captureTimeout) clearTimeout(captureTimeout);

			talkbackStopCapture();
			if (!talkbackActive) return;

			const text = talkbackTranscriptBuffer.trim();
			if (!text) {
				void beginTalkbackCapture();
				return;
			}

			await dispatchTalkback(text);
		} catch (e) {
			console.error('Talkback capture error:', e);
			talkbackStopCapture();
			talkbackConsecutiveFailures++;
			if (talkbackConsecutiveFailures >= 3) {
				await stopTalkback('3 consecutive errors — Talkback stopped');
				return;
			}
			toasts.add('Talkback error — retrying', 'error');
			if (talkbackActive) await pSleep(500).then(() => beginTalkbackCapture());
		}
	}

	async function dispatchTalkback(text: string) {
		if (!talkbackActive) return;
		talkbackPhase = 'transcribe'; // visual bump to transcribing

		try {
			talkbackPhase = 'dispatch';
			const resp = await fetch(resolve('/api/chat'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: text,
					thread: activeThread,
					target_repo: selectedRepo,
					talkback: true // server overrides tier to Flash-lite
				})
			});
			if (!resp.ok) throw new Error(`Dispatch ${resp.status}`);

			const body = await resp.json();
			if (body.current_tier) currentTier = body.current_tier as Tier;
			const sentMsg = body.message;
			messages = [...messages, sentMsg];
			userAtBottom = true;
			talkbackDispatchMsgId = sentMsg?.id ?? null;

			talkbackPhase = 'speak';
			await waitForTalkbackReply();
		} catch (e) {
			console.error('Talkback dispatch error:', e);
			talkbackConsecutiveFailures++;
			if (talkbackConsecutiveFailures >= 3) {
				await stopTalkback('3 consecutive errors — Talkback stopped');
				return;
			}
			toasts.add('Talkback dispatch failed — retrying', 'error');
			if (talkbackActive) void beginTalkbackCapture();
		}
	}

	async function waitForTalkbackReply() {
		if (!talkbackActive || talkbackDispatchMsgId === null) return;
		const dispatchId = talkbackDispatchMsgId;
		const deadline = Date.now() + 90_000;

		while (Date.now() < deadline && talkbackActive) {
			await pollMessages();
			const reply = messages.find(
				(m) => m.id > dispatchId && m.sender !== 'operator' && m.sender !== 'system'
			);
			if (reply?.message) {
				talkbackDispatchMsgId = null;
				talkbackConsecutiveFailures = 0;
				await speakTalkbackReply(reply.message);
				return;
			}
			await pSleep(1200);
		}

		talkbackDispatchMsgId = null;
		if (!talkbackActive) return;
		talkbackConsecutiveFailures++;
		if (talkbackConsecutiveFailures >= 3) {
			await stopTalkback('3 consecutive errors — Talkback stopped');
			return;
		}
		void beginTalkbackCapture();
	}

	async function speakTalkbackReply(text: string) {
		if (!talkbackActive || !audioEl) return;
		talkbackTtsAbortController = new AbortController();

		try {
			const resp = await fetch(resolve('/api/chat/speak'), {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text }),
				signal: talkbackTtsAbortController.signal
			});
			if (resp.status === 429) {
				await stopTalkback('TTS cap hit — Talkback stopped');
				return;
			}
			if (!resp.ok) throw new Error(`TTS ${resp.status}`);

			const audioBlob = await resp.blob();
			const url = URL.createObjectURL(audioBlob);
			audioEl.src = url;

			audioEl.onended = () => {
				URL.revokeObjectURL(url);
				if (talkbackActive) {
					talkbackPhase = 'loop';
					void playChime().then(() => {
						if (talkbackActive) void beginTalkbackCapture();
					});
				}
			};

			await audioEl.play();
		} catch (e) {
			if ((e as Error).name === 'AbortError') return;
			console.error('Talkback speak error:', e);
			talkbackTtsAbortController = null;
			talkbackConsecutiveFailures++;
			if (talkbackConsecutiveFailures >= 3) {
				await stopTalkback('3 consecutive errors — Talkback stopped');
				return;
			}
			if (talkbackActive) void beginTalkbackCapture();
		} finally {
			talkbackTtsAbortController = null;
		}
	}

	const TALKBACK_PHASE_LABELS = {
		capture: '🔴 Capture',
		transcribe: '🔄 Transcribe',
		dispatch: '📤 Sending',
		speak: '🔈 Reply',
		loop: '↩ Ready'
	};

	// ─────────────────────────────────────────────────────────────────────
	// Paperclip Upload Wiring
	// ─────────────────────────────────────────────────────────────────────
	function triggerUpload() {
		fileInputEl?.click();
	}

	// Uploads a single File via /api/chat/uploads and stages it as a chip.
	// Shared between the paperclip-triggered <input type=file> and the
	// drag-and-drop handler. Errors surface via toast; success is silent
	// because the chip itself is the success indicator.
	async function uploadOneFile(file: File): Promise<void> {
		const tempId = crypto.randomUUID();
		attachments = [
			...attachments,
			{
				id: tempId,
				filename: file.name,
				url: '',
				mime: file.type,
				size: file.size,
				uploading: true
			}
		];
		const fd = new FormData();
		fd.append('file', file);
		fd.append('target_repo', selectedRepo);
		try {
			toasts.add(`Uploading ${file.name}...`, 'info');
			const r = await fetch(resolve('/api/chat/uploads'), {
				method: 'POST',
				body: fd
			});
			if (!r.ok) {
				const err = await r.json().catch(() => ({}));
				throw new Error(err.message || `HTTP ${r.status}`);
			}
			const body = await r.json();
			if (body.url) {
				attachments = attachments.map((a) =>
					a.id === tempId
						? {
								...a,
								id: body.filename || tempId,
								url: body.url,
								mime: body.mime || file.type,
								size: body.size || file.size,
								uploading: false
							}
						: a
				);
			}
		} catch (err) {
			attachments = attachments.filter((a) => a.id !== tempId);
			toasts.add(`Upload failed: ${err instanceof Error ? err.message : 'unknown'}`, 'error');
		}
	}

	async function handleUpload(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		try {
			await uploadOneFile(file);
			textareaEl?.focus();
		} finally {
			target.value = '';
		}
	}

	// Drag-and-drop wiring. dragover MUST preventDefault for drop to fire.
	// Use a counter for dragenter/leave because they bubble across child
	// elements — naive boolean would flicker as the cursor crosses child
	// boundaries inside the drop zone.
	let isDragging = $state(false);
	let dragCounter = 0;
	function handleDragEnter(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		dragCounter++;
		isDragging = true;
	}
	function handleDragOver(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
	}
	function handleDragLeave(e: DragEvent) {
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		dragCounter = Math.max(0, dragCounter - 1);
		if (dragCounter === 0) isDragging = false;
	}
	async function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragCounter = 0;
		isDragging = false;
		const files = Array.from(e.dataTransfer?.files ?? []);
		if (files.length === 0) return;
		for (const file of files) {
			await uploadOneFile(file);
		}
		textareaEl?.focus();
	}

	function removeAttachment(id: string) {
		attachments = attachments.filter((a) => a.id !== id);
	}

	function humanSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	// ─────────────────────────────────────────────────────────────────────
	// Sidebar / Thread Management
	// ─────────────────────────────────────────────────────────────────────
	async function switchThread(threadId: string) {
		if (threadId === activeThread) {
			sidebarOpen = false;
			return;
		}
		activeThread = threadId;
		sidebarOpen = false;
		messages = [];
		// Pass the target thread explicitly so pollMessages can drop the
		// response if another switch happens before this fetch returns.
		await pollMessages(threadId);
		await loadTier(threadId);
		// Sync the URL's ?thread= query param to the newly-active thread.
		// Without this, the +page.server.ts load() reads the OLD thread on
		// reload (it falls back to the query param, then getActiveThread()),
		// bouncing the operator back to the wrong thread. Audit task #23.
		// replaceState avoids polluting browser history with every switch;
		// noScroll keeps the current scroll position.
		try {
			await goto(resolve('/chat') + '?thread=' + encodeURIComponent(threadId), {
				replaceState: true,
				noScroll: true,
				keepFocus: true
			});
		} catch {
			/* navigation failure shouldn't break the in-page switch */
		}
	}

	function switchRepo(name: string) {
		selectedRepo = name;
		openChip = null;
	}

	function slugifyThreadName(name: string): string {
		return (
			name
				.trim()
				.toLowerCase()
				.replace(/[^a-z0-9-]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 40) || 'thread'
		);
	}

	// Resolve a guaranteed-clean slug for a new thread. Checks both the local
	// sidebar list AND the DB for residual messages — covers three cases the
	// operator hit:
	//   (1) name collides with an active thread → suffix -2, -3, ...
	//   (2) name collides with an archived-and-hidden thread → suffix
	//   (3) name collides with orphan chat_messages rows left behind by a
	//       Clear-All / Delete that didn't fully cascade → suffix
	// Without this, switchThread() would re-open the existing/orphan thread
	// and pollMessages() would surface the old content — which is exactly
	// what the operator described as "the old thread shows up instead of a
	// clean slate."
	async function findUniqueSlug(baseSlug: string): Promise<string> {
		const localUsed = new Set(threads.map((t) => t.thread_id));
		let slug = baseSlug;
		let i = 1;
		while (i < 200) {
			if (!localUsed.has(slug)) {
				// Probe the DB — orphan rows survive a failed delete.
				try {
					const r = await fetch(
						resolve('/api/chat') + `?thread=${encodeURIComponent(slug)}&limit=1`
					);
					if (r.ok) {
						const b = await r.json();
						if (!Array.isArray(b.messages) || b.messages.length === 0) return slug;
					} else {
						return slug; // assume free if probe failed
					}
				} catch {
					return slug; // offline → assume free
				}
			}
			i++;
			slug = `${baseSlug}-${i}`;
		}
		return `${baseSlug}-${Date.now()}`; // safety net — shouldn't reach here
	}

	async function newThread() {
		const raw = window.prompt('New thread name (letters, numbers, dashes):');
		if (!raw) return;
		const baseSlug = slugifyThreadName(raw);
		const slug = await findUniqueSlug(baseSlug);
		// When the slug got suffixed (collision), the sidebar title needs to
		// reflect the unique slug too — otherwise the operator sees two rows
		// with the same visible name and can't tell which is which.
		const title = slug === baseSlug ? raw.trim() || slug : slug;
		if (slug !== baseSlug) {
			toasts.add(`"${baseSlug}" was taken — created "${slug}" for a clean slate.`, 'info');
		}
		threads = [
			{
				thread_id: slug,
				title,
				archived: false,
				pinned: false,
				message_count: 0,
				latest_ts: ''
			},
			...threads
		];
		void switchThread(slug);
	}

	// ─────────────────────────────────────────────────────────────────────
	// Thread management — rename / archive / delete / clear-all. Backend is
	// /api/chat/threads/[id] PATCH (title/archived) + DELETE (archived only).
	// `threadMenuOpenFor` is declared up near the other popover-state vars so
	// the global Escape / click-outside handler can reference it.
	// ─────────────────────────────────────────────────────────────────────
	let renamingFor = $state<string | null>(null);
	let renameDraft = $state('');
	let showArchived = $state(false);

	function openRename(t: { thread_id: string; title: string }) {
		threadMenuOpenFor = null;
		renamingFor = t.thread_id;
		renameDraft = t.title || t.thread_id;
	}
	async function commitRename(threadId: string) {
		const title = renameDraft.trim();
		renamingFor = null;
		if (!title) return;
		// Optimistic update.
		threads = threads.map((t) => (t.thread_id === threadId ? { ...t, title } : t));
		try {
			await fetch(resolve(`/api/chat/threads/${encodeURIComponent(threadId)}`), {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title })
			});
		} catch {
			toasts.add('Rename failed — try again', 'error');
		}
	}
	function cancelRename() {
		renamingFor = null;
		renameDraft = '';
	}

	async function toggleArchive(t: { thread_id: string; archived: boolean }) {
		threadMenuOpenFor = null;
		const archived = !t.archived;
		threads = threads.map((x) => (x.thread_id === t.thread_id ? { ...x, archived } : x));
		try {
			await fetch(resolve(`/api/chat/threads/${encodeURIComponent(t.thread_id)}`), {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ archived })
			});
			toasts.add(archived ? `Archived "${t.thread_id}"` : `Restored "${t.thread_id}"`, 'success');
		} catch {
			toasts.add('Archive failed', 'error');
		}
	}

	async function togglePin(t: { thread_id: string; pinned: boolean }) {
		threadMenuOpenFor = null;
		const pinned = !t.pinned;
		threads = threads.map((x) => (x.thread_id === t.thread_id ? { ...x, pinned } : x));
		try {
			await fetch(resolve(`/api/chat/threads/${encodeURIComponent(t.thread_id)}`), {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pinned })
			});
			toasts.add(pinned ? `Pinned "${t.thread_id}"` : `Unpinned "${t.thread_id}"`, 'success');
		} catch {
			toasts.add('Pin update failed', 'error');
		}
	}

	async function deleteThreadById(t: { thread_id: string; archived: boolean }) {
		threadMenuOpenFor = null;
		if (t.thread_id === 'default') {
			toasts.add('Cannot delete the Default Space', 'error');
			return;
		}
		// Backend requires archived=true before delete. Auto-archive if needed.
		if (!t.archived) {
			await fetch(resolve(`/api/chat/threads/${encodeURIComponent(t.thread_id)}`), {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ archived: true })
			}).catch(() => null);
		}
		const ok = window.confirm(
			`Delete thread "${t.thread_id}"? This permanently removes all messages, drafts, and metadata for it.`
		);
		if (!ok) return;
		try {
			const r = await fetch(resolve(`/api/chat/threads/${encodeURIComponent(t.thread_id)}`), {
				method: 'DELETE'
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			threads = threads.filter((x) => x.thread_id !== t.thread_id);
			if (activeThread === t.thread_id) {
				await switchThread('default');
			}
			toasts.add(`Deleted "${t.thread_id}"`, 'success');
		} catch (e) {
			toasts.add(`Delete failed: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
		}
	}

	async function clearAllSessions() {
		const ok = window.confirm(
			'Archive and delete every thread except Default Space? This cannot be undone.'
		);
		if (!ok) return;
		const targets = threads.filter((t) => t.thread_id !== 'default');
		let removed = 0;
		for (const t of targets) {
			try {
				await fetch(resolve(`/api/chat/threads/${encodeURIComponent(t.thread_id)}`), {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ archived: true })
				});
				const r = await fetch(resolve(`/api/chat/threads/${encodeURIComponent(t.thread_id)}`), {
					method: 'DELETE'
				});
				if (r.ok) removed++;
			} catch {
				/* skip */
			}
		}
		threads = threads.filter((t) => t.thread_id === 'default');
		if (activeThread !== 'default') await switchThread('default');
		toasts.add(`Cleared ${removed} thread${removed === 1 ? '' : 's'}`, 'success');
	}

	// ─────────────────────────────────────────────────────────────────────
	// Slash commands. Operator types `/` at the start of the composer →
	// autocomplete popup lists matching commands. Submit (Enter / Send /
	// click on row) runs the command's handler instead of sending the
	// literal text to the LLM.
	// ─────────────────────────────────────────────────────────────────────
	type SlashCmd = {
		key: string; // text after the slash, e.g. 'clear'
		usage: string; // display form: '/clear' or '/new <name>'
		description: string;
		run: (rest: string) => Promise<void> | void;
	};

	function addLocalSystemMessage(text: string) {
		messages = [
			...messages,
			{
				id: Date.now(),
				sender: 'system',
				message: text,
				timestamp: new Date().toISOString()
			}
		];
	}

	const SLASH_COMMANDS: SlashCmd[] = [
		{
			key: 'clear',
			usage: '/clear',
			description: 'Reset conversation context (server slices history at this marker)',
			run: async () => {
				// Persist a system marker — /api/chat and /api/chat/sdk-stream
				// slice thread history at the latest `--- NEW CONVERSATION ---`
				// line, so this drops the LLM's working memory without deleting
				// prior messages from the operator's view.
				await fetch(resolve('/api/chat'), {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						sender: 'system',
						message: '--- NEW CONVERSATION ---',
						thread: activeThread,
						agent: 'silent'
					})
				}).catch(() => null);
				await pollMessages();
				toasts.add('Conversation context reset', 'success');
			}
		},
		{
			key: 'new',
			usage: '/new <name>',
			description: 'Create + switch to a new thread',
			run: async (rest) => {
				const baseSlug = slugifyThreadName(rest);
				if (!baseSlug || baseSlug === 'thread') {
					toasts.add('Thread name required: /new my-feature', 'error');
					return;
				}
				const slug = await findUniqueSlug(baseSlug);
				const title = slug === baseSlug ? rest.trim() || slug : slug;
				if (slug !== baseSlug) {
					toasts.add(`"${baseSlug}" was taken — created "${slug}" for a clean slate.`, 'info');
				}
				threads = [
					{
						thread_id: slug,
						title,
						archived: false,
						pinned: false,
						message_count: 0,
						latest_ts: ''
					},
					...threads
				];
				await switchThread(slug);
				toasts.add(`Switched to thread "${slug}"`, 'success');
			}
		},
		{
			key: 'regen',
			usage: '/regen',
			description: 'Regenerate the most recent assistant reply',
			run: async () => {
				// Walk backwards for the last non-operator, non-system reply
				for (let i = messages.length - 1; i >= 0; i--) {
					if (messages[i].sender !== 'operator' && messages[i].sender !== 'system') {
						await regenerateReply(messages[i]);
						return;
					}
				}
				toasts.add('No assistant reply to regenerate', 'error');
			}
		},
		{
			key: 'help',
			usage: '/help',
			description: 'Show available slash commands',
			run: () => {
				const body = SLASH_COMMANDS.map((c) => `- \`${c.usage}\` — ${c.description}`).join('\n');
				addLocalSystemMessage(`**Slash commands**\n\n${body}`);
			}
		}
	];

	const slashQuery = $derived(
		textDraft.startsWith('/') ? textDraft.slice(1).split(/\s/)[0].toLowerCase() : null
	);
	const slashMatches = $derived(
		slashQuery === null ? [] : SLASH_COMMANDS.filter((c) => c.key.startsWith(slashQuery))
	);
	const slashMode = $derived(
		textDraft.startsWith('/') && !textDraft.includes('\n') && slashMatches.length > 0
	);

	async function runSlashFromDraft(): Promise<boolean> {
		if (!textDraft.startsWith('/')) return false;
		const trimmed = textDraft.trim();
		const spaceIdx = trimmed.indexOf(' ');
		const key = (spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx)).toLowerCase();
		const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
		const cmd = SLASH_COMMANDS.find((c) => c.key === key);
		if (!cmd) return false;
		textDraft = '';
		attachments = [];
		try {
			await cmd.run(rest);
		} catch (e) {
			toasts.add(`Command failed: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
		}
		return true;
	}

	async function pickSlash(cmd: SlashCmd) {
		// If the command takes args (usage has < >), prefill the composer
		// instead of running immediately so the operator can type the arg.
		if (cmd.usage.includes('<')) {
			textDraft = `/${cmd.key} `;
			textareaEl?.focus();
			return;
		}
		textDraft = `/${cmd.key}`;
		await runSlashFromDraft();
	}

	// ─────────────────────────────────────────────────────────────────────
	// Lifecycle
	// ─────────────────────────────────────────────────────────────────────
	let pollTimer: ReturnType<typeof setInterval>;
	let activityTimer: ReturnType<typeof setInterval>;
	let sentinelObs: IntersectionObserver | null = null;

	onMount(() => {
		void loadTier(activeThread);
		if (feedContainer && scrollSentinel) {
			sentinelObs = new IntersectionObserver(
				(entries) => {
					const ent = entries[0];
					if (ent?.isIntersecting) {
						userAtBottom = true;
						unseenCount = 0;
					} else {
						userAtBottom = false;
					}
				},
				{ root: feedContainer, threshold: 0 }
			);
			sentinelObs.observe(scrollSentinel);
		}
		queueMicrotask(() => scrollSentinel?.scrollIntoView({ behavior: 'auto' }));
		pollTimer = setInterval(pollMessages, 3000);
		activityTimer = setInterval(pollActivity, 5000);
	});

	onDestroy(() => {
		clearInterval(pollTimer);
		clearInterval(activityTimer);
		sentinelObs?.disconnect();
		if (draftDebounceTimer) clearTimeout(draftDebounceTimer);
		if (activityFadeTimer) clearTimeout(activityFadeTimer);
		void stopTalkback();
	});

	// Utilities
	function fmtTime(iso: string): string {
		try {
			return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
		} catch {
			return '';
		}
	}

	function senderDisplay(s: string): string {
		if (s === 'operator') return 'You';
		return s.toUpperCase();
	}
</script>

<svelte:head>
	<title>LogueOS — Conversational Kernel</title>
</svelte:head>

<!-- Persistent audio element for ElevenLabs speech -->
<audio bind:this={audioEl} class="hidden" aria-hidden="true"></audio>
<input
	type="file"
	accept="image/*"
	bind:this={fileInputEl}
	class="hidden"
	onchange={handleUpload}
/>

<div
	class="relative flex h-[100dvh] w-full overflow-hidden bg-[#050505] font-sans text-foreground"
	ondragenter={handleDragEnter}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
	role="region"
	aria-label="Chat surface (drop images to attach)"
>
	<!-- Drag-and-drop overlay — appears when the operator drags a file over
	     the surface from desktop / Files app. pointer-events-none keeps it
	     from intercepting the drop event itself. -->
	{#if isDragging}
		<div
			class="pointer-events-none absolute inset-3 z-[60] flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-cyan-400/60 bg-cyan-500/10 backdrop-blur-md"
			aria-hidden="true"
		>
			<Paperclip size={32} class="text-cyan-300" />
			<span class="font-mono text-xs tracking-wider text-cyan-200 uppercase">Drop to attach</span>
			<span class="px-4 text-center font-sans text-xs text-cyan-300/70"
				>Images stage as chips above the composer</span
			>
		</div>
	{/if}
	<!-- Radial Gradient Atmosphere Background -->
	<div
		class="pointer-events-none absolute inset-0 -z-0"
		style="background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(168, 85, 247, 0.07), transparent 60%), radial-gradient(ellipse 60% 50% at 100% 100%, rgba(244, 114, 182, 0.04), transparent 50%);"
	></div>

	<!-- ═════════════════════════════════════════════════════════════════
	     COLLAPSIBLE THREADS SIDEBAR (PR 7 redone for Conversational OS)
	     ═════════════════════════════════════════════════════════════════ -->
	{#if sidebarOpen}
		<!-- Back-drop overlay for mobile -->
		<button
			type="button"
			onclick={() => (sidebarOpen = false)}
			class="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
			aria-label="Close sidebar"
		></button>
	{/if}

	<aside
		class="fixed top-0 bottom-0 left-0 z-40 flex w-72 flex-col border-r border-zinc-800/60 bg-[#090909]/98 shadow-2xl backdrop-blur-2xl transition-all duration-300 ease-in-out lg:static lg:translate-x-0
			{sidebarOpen
			? 'translate-x-0 lg:w-72 lg:opacity-100'
			: '-translate-x-full lg:pointer-events-none lg:w-0 lg:opacity-0'}"
	>
		<!-- Sidebar Header -->
		<div class="flex shrink-0 items-center justify-between border-b border-zinc-800/50 px-4 py-4">
			<div class="flex items-center gap-2">
				<img src="{base}/favicon.png" alt="LogueOS" class="h-6 w-6" />
				<span class="font-mono text-xs font-semibold tracking-wider text-zinc-300 uppercase"
					>Sessions</span
				>
			</div>
			<div class="flex items-center gap-1.5">
				<button
					type="button"
					onclick={newThread}
					class="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 transition-all hover:scale-105 hover:text-white active:scale-95"
					title="Create new session"
				>
					<Plus size={14} />
				</button>
				<button
					type="button"
					onclick={() => (sidebarOpen = false)}
					class="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 transition-all hover:text-white lg:hidden"
					aria-label="Close sidebar"
				>
					<X size={14} />
				</button>
			</div>
		</div>

		<!-- Threads Scroll Area -->
		<div class="flex flex-1 flex-col overflow-y-auto p-2">
			<!-- Toolbar — Show archived toggle + Clear All -->
			<div class="mb-1 flex items-center justify-between px-2 py-1">
				<button
					type="button"
					onclick={() => (showArchived = !showArchived)}
					class="flex items-center gap-1 font-mono text-[9px] tracking-wider text-zinc-500 uppercase transition-colors hover:text-zinc-300"
					title={showArchived ? 'Hide archived sessions' : 'Show archived sessions'}
				>
					<Archive size={10} />
					<span>{showArchived ? 'Hide archived' : 'Show archived'}</span>
				</button>
				<button
					type="button"
					onclick={clearAllSessions}
					class="flex items-center gap-1 rounded font-mono text-[9px] tracking-wider text-zinc-600 uppercase transition-colors hover:text-red-400"
					title="Archive and delete every non-default thread"
				>
					<Eraser size={10} />
					<span>Clear all</span>
				</button>
			</div>

			{#if threads.length === 0}
				<div class="px-3 py-4 text-center font-mono text-[10px] text-zinc-600">No sessions yet</div>
			{:else}
				<div class="space-y-1">
					{#each threads
						.filter((t) => showArchived || !t.archived)
						.slice()
						.sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)) as t (t.thread_id)}
						<div class="relative">
							{#if renamingFor === t.thread_id}
								<!-- Rename input replaces the row in-place. -->
								<form
									class="flex items-center gap-1 rounded-xl border border-purple-500/40 bg-zinc-900 px-2 py-1.5"
									onsubmit={(e) => {
										e.preventDefault();
										void commitRename(t.thread_id);
									}}
								>
									<input
										type="text"
										bind:value={renameDraft}
										class="flex-1 bg-transparent text-xs text-white focus:outline-none"
										autofocus
										onkeydown={(e) => {
											if (e.key === 'Escape') cancelRename();
										}}
									/>
									<button
										type="submit"
										class="rounded px-1.5 py-0.5 text-[10px] text-purple-300 hover:bg-purple-500/10"
										>Save</button
									>
									<button
										type="button"
										onclick={cancelRename}
										class="rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800"
										>Cancel</button
									>
								</form>
							{:else}
								<div
									class="group flex w-full items-center gap-1 rounded-xl pr-1 transition-all
										{activeThread === t.thread_id
										? 'border border-zinc-700/50 bg-zinc-800/40'
										: 'border border-transparent hover:bg-zinc-900/40'}
										{t.archived ? 'opacity-60' : ''}"
								>
									<button
										type="button"
										onclick={() => switchThread(t.thread_id)}
										class="flex flex-1 items-center justify-between truncate px-3 py-2 text-left font-sans text-xs
											{activeThread === t.thread_id ? 'font-medium text-white' : 'text-zinc-300'}"
									>
										<div class="flex min-w-0 items-center gap-2.5 truncate">
											<MessageSquare
												size={13}
												class={activeThread === t.thread_id ? 'text-purple-400' : 'text-zinc-500'}
											/>
											<span class="truncate"
												>{t.thread_id === 'default' && t.title === 'default'
													? 'Default Space'
													: t.title || t.thread_id}</span
											>
											{#if t.archived}
												<Archive size={10} class="shrink-0 text-zinc-600" />
											{/if}
										</div>
										{#if t.message_count > 0}
											<span
												class="ml-2 shrink-0 rounded border border-zinc-900 bg-zinc-950 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500"
												>{t.message_count}</span
											>
										{/if}
									</button>
									<button
										type="button"
										data-popover-trigger
										onclick={(e) => {
											e.stopPropagation();
											threadMenuOpenFor = threadMenuOpenFor === t.thread_id ? null : t.thread_id;
										}}
										class="flex h-7 w-6 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
										aria-label="Session options"
									>
										<MoreVertical size={13} />
									</button>
								</div>
							{/if}

							{#if threadMenuOpenFor === t.thread_id}
								<div
									data-popover
									class="absolute top-full right-0 z-50 mt-1 min-w-40 overflow-hidden rounded-xl border border-zinc-800 bg-[#0e0e0e] py-1 shadow-2xl"
								>
									<button
										type="button"
										onclick={() => togglePin(t)}
										class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900"
									>
										<Pin size={11} class="text-zinc-500" />
										<span>{t.pinned ? 'Unpin' : 'Pin to top'}</span>
									</button>
									<button
										type="button"
										onclick={() => openRename(t)}
										disabled={t.thread_id === 'default'}
										class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900 disabled:opacity-40"
									>
										<Edit3 size={11} class="text-zinc-500" />
										<span>Rename</span>
									</button>
									<button
										type="button"
										onclick={() => toggleArchive(t)}
										disabled={t.thread_id === 'default'}
										class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-zinc-300 transition-colors hover:bg-zinc-900 disabled:opacity-40"
									>
										{#if t.archived}
											<ArchiveRestore size={11} class="text-zinc-500" />
											<span>Restore</span>
										{:else}
											<Archive size={11} class="text-zinc-500" />
											<span>Archive</span>
										{/if}
									</button>
									<button
										type="button"
										onclick={() => deleteThreadById(t)}
										disabled={t.thread_id === 'default'}
										class="flex w-full items-center gap-2 border-t border-zinc-800/50 px-3 py-1.5 text-left text-xs text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
									>
										<Trash2 size={11} />
										<span>Delete</span>
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Sidebar Footer info -->
		<div
			class="shrink-0 space-y-0.5 border-t border-zinc-800/50 bg-black/25 p-3 font-mono text-[9px] text-zinc-600 select-none"
		>
			<div>CORE: LogueOS-Console</div>
			<div>HOST: 127.0.0.1:18080</div>
		</div>
	</aside>

	<!-- ═════════════════════════════════════════════════════════════════
	     MAIN CONVERSATIONAL CANVAS
	     ═════════════════════════════════════════════════════════════════ -->
	<main class="relative flex h-full flex-1 flex-col overflow-hidden select-text">
		<!-- ═════════════════════════════════════════════════════════════════
		     QUIET HEADER
		     ═════════════════════════════════════════════════════════════════ -->
		<header
			class="relative z-50 flex shrink-0 items-center justify-between px-4 pt-3 pb-2 select-none"
		>
			<div class="flex items-center gap-1.5">
				<!-- Sidebar toggle button -->
				<button
					type="button"
					onclick={() => (sidebarOpen = !sidebarOpen)}
					class="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-800/80 bg-zinc-950/60 text-zinc-400 transition-all hover:text-white active:scale-90"
					aria-label="Toggle Sessions Sidebar"
					title="Toggle Sessions Sidebar"
				>
					<Menu size={16} />
				</button>

				<!-- Logo home anchor -->
				<a
					href={resolve('/')}
					aria-label="Return to Dashboard"
					class="ml-0.5 flex h-9 w-9 items-center justify-center transition-opacity hover:opacity-80"
				>
					<img src="{base}/favicon.png" alt="LogueOS" class="h-6 w-6" />
				</a>
			</div>

			<!-- Context badges dropdown container -->
			<div class="flex items-center gap-1.5">
				<!-- Repository selection chip -->
				<div class="relative">
					<button
						type="button"
						data-popover-trigger
						onclick={() => {
							const next = openChip === 'repo' ? null : 'repo';
							closeAllPopovers();
							openChip = next;
						}}
						class="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-[#0e0e0e] px-3 py-1.5 font-sans text-xs text-zinc-300 shadow-sm transition-all hover:border-zinc-700 hover:bg-[#161616] hover:text-white"
						aria-label="Target repository"
					>
						<span>{selectedWorkspace?.emoji ?? '📁'}</span>
						<span>{selectedWorkspace?.display_name ?? selectedRepo}</span>
						<ChevronDown size={10} class="text-zinc-500" />
					</button>

					{#if openChip === 'repo'}
						<div
							data-popover
							class="absolute top-full right-0 z-50 mt-2 min-w-48 rounded-2xl border border-zinc-800 bg-[#0e0e0e] py-1.5 shadow-2xl"
						>
							<div
								class="px-3 py-1 font-mono text-[9px] tracking-wider text-zinc-600 uppercase select-none"
							>
								Target Directory
							</div>
							{#each workspaces as ws (ws.name)}
								<button
									type="button"
									onclick={() => switchRepo(ws.name)}
									class="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-zinc-900
										{selectedRepo === ws.name ? 'font-medium text-cyan-400' : 'text-zinc-400'}"
								>
									<span class="flex items-center gap-2">
										<span>{ws.emoji}</span>
										<span>{ws.display_name}</span>
									</span>
									{#if selectedRepo === ws.name}
										<Check size={11} />
									{/if}
								</button>
							{/each}
							<!-- Projects-light: edit per-workspace system-prompt addendum.
							     Auto-injects into every chat send for this workspace.
							     Task #22. -->
							<button
								type="button"
								onclick={() => openWorkspaceContextEditor()}
								class="mt-1 flex w-full items-center gap-2 border-t border-zinc-800/50 px-3 py-2 text-left text-[11px] text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
							>
								<Edit3 size={11} aria-hidden="true" />
								<span>Edit context for {selectedWorkspace?.display_name ?? selectedRepo}</span>
							</button>
						</div>
					{/if}
				</div>

				<!-- Model Picker Badge -->
				<div class="relative">
					<button
						type="button"
						data-popover-trigger
						onclick={() => {
							const next = !showModelOverrideModal;
							closeAllPopovers();
							showModelOverrideModal = next;
						}}
						class="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-[#0e0e0e] px-3 py-1.5 font-sans text-xs text-zinc-300 shadow-sm transition-all hover:border-zinc-700 hover:bg-[#161616] hover:text-white"
						aria-label="Model picker"
						title="Pick a specific model or leave on Auto"
					>
						<span>{tierEmoji}</span>
						<span class="max-w-[120px] truncate font-mono text-[10px] tracking-wide text-zinc-400"
							>{selectedModelChoice.id === 'auto'
								? lastModelUsed || 'Auto'
								: selectedModelChoice.label}</span
						>
						<ChevronDown size={10} class="text-zinc-500" />
					</button>

					{#if showModelOverrideModal}
						<div
							data-popover
							class="absolute top-full right-0 z-50 mt-2 min-w-56 rounded-2xl border border-zinc-800 bg-[#0e0e0e] py-1.5 shadow-2xl"
						>
							<div
								class="px-3 py-1 font-mono text-[9px] tracking-wider text-zinc-600 uppercase select-none"
							>
								Model
							</div>
							{#each MODEL_CHOICES as choice (choice.id)}
								<button
									type="button"
									onclick={() => setModelChoice(choice)}
									class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-zinc-900
										{selectedModelChoice.id === choice.id ? 'font-medium text-purple-400' : 'text-zinc-300'}"
								>
									<span class="flex flex-col leading-tight">
										<span class="text-xs">{choice.label}</span>
										<span class="font-mono text-[9px] text-zinc-500">{choice.sublabel}</span>
									</span>
									{#if selectedModelChoice.id === choice.id}
										<Check size={11} class="shrink-0" />
									{/if}
								</button>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</header>

		<!-- ═════════════════════════════════════════════════════════════════
		     EPHEMERAL ACTIVITY PILL
		     ═════════════════════════════════════════════════════════════════ -->
		{#if activityPill}
			<div
				class="relative z-10 mx-auto shrink-0 px-4 pb-1 select-none"
				style="animation: fade-in 0.3s ease-out;"
			>
				<div
					class="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-950/20 px-3.5 py-1.5 backdrop-blur-md"
					style="box-shadow: 0 0 16px rgba(34, 211, 238, 0.1);"
				>
					<span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400"></span>
					<span class="font-mono text-[11px] tracking-wide text-cyan-400">
						⚡ {activityPill.worker}: {activityPill.step}
					</span>
					<a
						href={resolve('/activity')}
						class="ml-1.5 font-mono text-[10px] text-cyan-300/60 transition-colors hover:text-cyan-300"
					>
						[View Logs]
					</a>
				</div>
			</div>
		{/if}

		<!-- ═════════════════════════════════════════════════════════════════
		     CINEMATIC MESSAGE FEED
		     ═════════════════════════════════════════════════════════════════ -->
		<div
			bind:this={feedContainer}
			class="relative z-10 flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-4 md:px-6"
		>
			{#if messages.length === 0}
				<div class="flex flex-1 items-center justify-center text-center select-none">
					<div class="max-w-xs space-y-2">
						<div class="font-sans text-sm font-light text-zinc-500/60">
							Active terminal partner loop established.
						</div>
						<div class="font-mono text-[10px] tracking-widest text-zinc-700 uppercase">
							{selectedWorkspace?.display_name ?? selectedRepo} · {currentTier}
						</div>
					</div>
				</div>
			{:else}
				{#each messages as m (m.id)}
					<!-- Skip rendering the empty stream-placeholder bubble while the
					     thinking-dots block represents it. Once any token text
					     arrives, m.message is non-empty and the bubble re-renders. -->
					{#if !(streamState?.placeholderId === m.id && m.message === '')}
					<div class="flex flex-col gap-1 {m.sender === 'operator' ? 'items-end' : 'items-start'}">
						<!-- Custom Labeling / Bubble Headers -->
						{#if m.sender !== 'operator'}
							<div
								class="mb-1.5 flex w-fit items-center gap-1 rounded-full border border-cyan-500/20 bg-cyan-950/20 px-2 py-0.5 font-mono text-[10px] font-medium tracking-wider text-cyan-400 uppercase select-none"
							>
								<Sparkles size={10} class="shrink-0 text-cyan-400" />
								<span>{m.sender === 'system' ? 'LOGUEOS' : senderDisplay(m.sender)}</span>
							</div>
						{/if}

						<!-- Text Bubble. Operator bubbles render raw (whitespace-pre)
						     since they're literally what was typed. Assistant
						     bubbles render through the Markdown component for
						     code-block highlighting, inline code, lists, etc. -->
						<div
							class="max-w-[85%] rounded-2xl px-3.5 py-2 font-sans text-[13.5px] leading-snug tracking-[-0.005em] antialiased selection:bg-purple-900/50 selection:text-white sm:max-w-[80%]
								{m.sender === 'operator'
								? 'border border-orange-500/30 bg-orange-500/[0.03] text-orange-50 shadow-[0_0_20px_rgba(249,115,22,0.06)]'
								: 'border border-zinc-900 bg-zinc-950/40 text-zinc-100'}"
						>
							{#if m.sender === 'operator'}
								<span class="whitespace-pre-wrap">{m.message}</span>
							{:else}
								<Markdown content={m.message} oncanvas={openCanvas} />
							{/if}
						</div>

						<!-- Time + actions footer. Copy + Regenerate on assistant
						     replies only — operator's own bubbles already echo
						     their input and can't be re-rolled. -->
						<div class="flex items-center gap-2 px-1 select-none">
							{#if m.sender !== 'operator' && m.message}
								<button
									type="button"
									onclick={() => copyMessage(m)}
									class="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-zinc-600 uppercase transition-colors hover:bg-zinc-900 hover:text-zinc-300"
									aria-label="Copy reply"
									title={copiedIds.has(m.id) ? 'Copied' : 'Copy reply'}
								>
									{#if copiedIds.has(m.id)}
										<Check size={10} class="text-emerald-400" />
										<span class="text-emerald-400">Copied</span>
									{:else}
										<Copy size={10} />
										<span>Copy</span>
									{/if}
								</button>
								<button
									type="button"
									onclick={() => regenerateReply(m)}
									disabled={sending || regeneratingIds.has(m.id)}
									class="flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[9px] tracking-wider text-zinc-600 uppercase transition-colors hover:bg-zinc-900 hover:text-zinc-300 disabled:cursor-not-allowed disabled:opacity-50"
									aria-label="Regenerate reply"
									title={regeneratingIds.has(m.id) ? 'Regenerating…' : 'Regenerate reply'}
								>
									<RefreshCw size={10} class={regeneratingIds.has(m.id) ? 'animate-spin' : ''} />
									<span>{regeneratingIds.has(m.id) ? 'Regen…' : 'Regen'}</span>
								</button>
							{/if}
							<div class="font-mono text-[9px] text-zinc-600">
								{fmtTime(m.timestamp)}
							</div>
						</div>
					</div>
					{/if}
				{/each}

				<!-- Thinking indicator — renders an AGY-style bubble with three
				     staggered bouncing dots while we're waiting on a reply.
				     Conditions: a send is in flight AND the most recent message
				     in the feed is from the operator (i.e. we're between their
				     send and the LLM's response landing). -->
				<!-- Thinking dots indicator. Renders during the gap between operator
				     send and first LLM token arriving — that is, when there's a
				     stream placeholder bubble whose text is still empty. Pre-2b.2
				     the trigger was "last message is operator", but the SDK
				     cutover now inserts an optimistic assistant placeholder
				     immediately on send so the old check never fires. We instead
				     gate on streamState (set when a stream starts) AND the
				     placeholder message text being empty (no tokens yet). -->
				{#if streamState && messages.find((m) => m.id === streamState!.placeholderId)?.message === ''}
					<div class="flex flex-col items-start gap-1">
						<div
							class="mb-1.5 flex w-fit items-center gap-1 rounded-full border border-cyan-500/20 bg-cyan-950/20 px-2 py-0.5 font-mono text-[10px] font-medium tracking-wider text-cyan-400 uppercase select-none"
						>
							<Sparkles size={10} class="shrink-0 text-cyan-400" />
							<span>{providerOverride === 'anthropic' ? 'CC' : providerOverride === 'local' ? 'LOCAL' : 'AGY'}</span>
						</div>
						<div
							class="flex items-center gap-1.5 rounded-2xl border border-zinc-900 bg-zinc-950/40 px-4 py-3.5"
							aria-label="Assistant is thinking"
							role="status"
						>
							<span
								class="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400/70"
								style="animation-delay: 0ms"
							></span>
							<span
								class="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400/70"
								style="animation-delay: 150ms"
							></span>
							<span
								class="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-400/70"
								style="animation-delay: 300ms"
							></span>
						</div>
					</div>
				{/if}
			{/if}

			<!-- Tool-call chips for the currently-streaming reply.
			     Rendered from sdkChat.messages's tool-* parts so the operator
			     can see what the LLM is doing on their behalf while waiting.
			     Only visible during an active stream; after the stream
			     completes, sdkChat.messages resets and these disappear.
			     History-mode tool-call display lives in a future PR (would
			     require tool-call persistence into chat_messages). -->
			{#if streamState}
				{#each sdkChat.messages as sdkMsg (sdkMsg.id)}
					{#if sdkMsg.role === 'assistant' && (sdkMsg.parts || []).some((p) => p.type?.startsWith('tool-'))}
						<div class="flex flex-col items-start gap-1" data-testid="sdk-tool-row">
							{#each sdkMsg.parts as part, i (i)}
								{#if part.type?.startsWith('tool-')}
									<div
										class="my-1 flex flex-col gap-0.5 rounded-lg border border-purple-500/30 bg-purple-500/[0.04] px-2.5 py-1.5 font-mono text-[11px]"
									>
										<div class="flex items-center gap-1.5 text-purple-300">
											<Sparkles size={11} aria-hidden="true" />
											<span class="font-semibold tracking-wide">
												{part.type.replace(/^tool-/, '')}
											</span>
											<span
												class="ml-auto text-[9px] tracking-wider text-purple-400/70 uppercase"
											>
												{(part as { state?: string }).state ?? 'pending'}
											</span>
										</div>
										{#if (part as { state?: string }).state === 'output-error'}
											<div class="text-[10px] text-red-400">
												{(part as { errorText?: string }).errorText ?? 'tool error'}
											</div>
										{/if}
									</div>
								{/if}
							{/each}
						</div>
					{/if}
				{/each}
			{/if}

			<div bind:this={scrollSentinel} class="h-px shrink-0" aria-hidden="true"></div>
		</div>

		{#if unseenCount > 0 && !userAtBottom}
			<button
				type="button"
				onclick={() => {
					userAtBottom = true;
					unseenCount = 0;
					scrollSentinel?.scrollIntoView({ behavior: 'smooth' });
				}}
				class="absolute right-1/2 bottom-24 z-20 flex translate-x-1/2 items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3.5 py-1.5 font-mono text-[11px] text-cyan-300 backdrop-blur-md transition-all select-none hover:scale-105 active:scale-95"
				style="box-shadow: 0 0 16px rgba(34, 211, 238, 0.2);"
			>
				{unseenCount} new messages ↓
			</button>
		{/if}

		<!-- ═════════════════════════════════════════════════════════════════
		     HERO COMPOSER PILL
		     ═════════════════════════════════════════════════════════════════ -->
		<div class="relative z-10 shrink-0 px-4 pt-2 pb-4 select-none">
			<!-- Outer border shifting glow container -->
			<div
				class="relative flex flex-col gap-2 rounded-3xl border p-2 transition-all duration-300
					{composerMode === 'recording'
					? 'border-amber-500/40 bg-amber-500/[0.04] shadow-[0_0_30px_rgba(245,158,11,0.15)]'
					: composerMode === 'talkback'
						? 'border-emerald-500/40 bg-emerald-500/[0.04] shadow-[0_0_30px_rgba(16,185,129,0.15)]'
						: imageMode
							? 'border-cyan-500/40 bg-cyan-500/[0.04] shadow-[0_0_30px_rgba(6,182,212,0.15)]'
							: sending
								? 'animate-pulse border-purple-500/40 bg-purple-500/[0.04] shadow-[0_0_30px_rgba(168,85,247,0.15)]'
								: 'border-zinc-800/80 bg-zinc-950/80 shadow-[0_0_24px_rgba(168,85,247,0.06)] focus-within:border-zinc-600/80 hover:border-zinc-700/80'}"
			>
				<!-- Dictation / Talkback Status indicators inside composer -->
				{#if composerMode === 'recording' || composerMode === 'talkback'}
					<div
						class="flex items-center justify-between border-b border-white/5 px-2 pt-0.5 pb-1 font-mono text-[10px] select-none"
					>
						<div class="flex items-center gap-1.5">
							<span
								class="h-2 w-2 animate-ping rounded-full
								{composerMode === 'recording' ? 'bg-amber-400' : 'bg-emerald-400'}"
							></span>
							<span
								class={composerMode === 'recording'
									? 'text-amber-400'
									: 'font-semibold text-emerald-400'}
							>
								{composerMode === 'recording'
									? '🔴 Voice Dictation Hot'
									: '🔊 Walkie-Talkie Engaged'}
							</span>
							{#if composerMode === 'talkback' && talkbackPhase}
								<span class="rounded border border-zinc-800 bg-black/40 px-1 text-zinc-500">
									{TALKBACK_PHASE_LABELS[talkbackPhase]}
								</span>
							{/if}
						</div>
						<button
							type="button"
							onclick={composerMode === 'recording' ? toggleRecord : () => stopTalkback()}
							class="rounded-full border border-red-500/30 bg-red-950/20 px-2 py-0.5 text-[9px] tracking-wider text-red-400 uppercase transition-all hover:bg-red-900/30"
						>
							Disconnect
						</button>
					</div>
				{:else if imageMode}
					<div
						class="flex items-center justify-between border-b border-white/5 px-2 pt-0.5 pb-1 font-mono text-[10px] text-cyan-400 select-none"
					>
						<div class="flex items-center gap-1.5">
							<Sparkles size={11} class="shrink-0 text-cyan-400" />
							<span>✨ Prompt will route to Image Generation</span>
						</div>
						<button
							type="button"
							onclick={() => (imageMode = false)}
							class="rounded-full border border-zinc-800 bg-zinc-950 px-2 py-0.5 text-[9px] tracking-wider text-zinc-400 uppercase transition-all hover:text-white"
						>
							Cancel
						</button>
					</div>
				{/if}

				<!-- Slash-command autocomplete. Appears when the draft starts with
				     `/` and matches at least one known command. Submit/Send
				     intercepts the literal text and runs the command handler. -->
				{#if slashMode}
					<div
						class="mb-1 flex flex-col gap-1 rounded-2xl border border-cyan-500/20 bg-[#0a1416] p-1.5"
						role="listbox"
						aria-label="Slash commands"
					>
						{#each slashMatches as cmd (cmd.key)}
							<button
								type="button"
								onclick={() => pickSlash(cmd)}
								class="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-cyan-500/10"
								role="option"
								aria-selected="false"
							>
								<span class="flex flex-col leading-tight">
									<span class="font-mono text-xs text-cyan-300">{cmd.usage}</span>
									<span class="text-[10px] text-zinc-400">{cmd.description}</span>
								</span>
							</button>
						{/each}
					</div>
				{/if}

				<!-- Staged attachments — appear as removable chips with a thumbnail
				     preview, above the text input row. On send, each chip's
				     markdown link is folded into the outgoing message body. -->
				{#if attachments.length > 0}
					<div class="flex flex-wrap gap-2 border-b border-white/5 px-1 pb-2">
						{#each attachments as att (att.id)}
							<div
								class="group relative flex items-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 py-1 pr-1 pl-2 text-xs text-zinc-200 shadow-sm"
							>
								<div class="relative h-8 w-8 shrink-0">
									{#if att.mime?.startsWith('image/') && att.url}
										<img
											src={att.url.startsWith('./') ? resolve('/' + att.url.slice(2)) : att.url}
											alt={att.filename}
											class="h-full w-full rounded-md object-cover"
										/>
									{:else}
										<div
											class="flex h-full w-full items-center justify-center rounded-md bg-zinc-800 text-zinc-500"
										>
											<Paperclip size={14} />
										</div>
									{/if}
									{#if att.uploading}
										<div class="absolute inset-0 flex items-center justify-center rounded-md bg-zinc-950/60 backdrop-blur-sm">
											<Loader2 class="animate-spin text-white" size={14} />
										</div>
									{/if}
								</div>
								<div class="flex flex-col leading-tight">
									<span class="max-w-[160px] truncate font-medium text-zinc-200"
										>{att.filename}</span
									>
									<span class="font-mono text-[10px] text-zinc-500">{humanSize(att.size)}</span>
								</div>
								<button
									type="button"
									onclick={() => removeAttachment(att.id)}
									class="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-white"
									aria-label="Remove attachment"
									title="Remove"
								>
									<X size={12} />
								</button>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Text input area + icons. items-end so buttons sit at the bottom
				     as the textarea grows; min-h on the wrapper preserves the
				     hero-pill height even when the textarea collapses to 1 row. -->
				<div class="flex flex-col gap-2">
					<!-- Row 1: Textarea only (full width) -->
					<div class="w-full">
						<textarea
							bind:this={textareaEl}
							bind:value={textDraft}
							onkeypress={handleKey}
							onpaste={handlePaste}
							onfocus={() => composerMode === 'idle' && (composerMode = 'focused')}
							onblur={() => composerMode === 'focused' && (composerMode = 'idle')}
							rows="1"
							placeholder={composerMode === 'recording'
								? 'Listening dictation… press stop when done.'
								: composerMode === 'talkback'
									? 'Continuously monitoring stream… hands free.'
									: imageMode
										? 'Describe the image you want to generate…'
										: 'Ask or command loops…'}
							autocomplete="off"
							autocapitalize="sentences"
							spellcheck="false"
							disabled={composerMode === 'recording' || composerMode === 'talkback'}
							class="w-full resize-none bg-transparent px-1 py-1 font-sans text-[14px] leading-snug tracking-[-0.005em] text-white placeholder:text-zinc-600 focus:outline-none disabled:text-zinc-500"
							style="min-height: 40px; max-height: 480px;"
						></textarea>
					</div>

					<!-- Row 2: Utility buttons left, Send button right -->
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-1.5">
							<!-- Attach File -->
							<button
								type="button"
								onclick={triggerUpload}
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-800/80 bg-zinc-900 text-zinc-400 transition-colors hover:text-white active:scale-90"
								aria-label="Attach File"
								title="Attach image"
							>
								<Paperclip size={15} />
							</button>

							<!-- Sparkles Image Toggle -->
							<button
								type="button"
								onclick={() => (imageMode = !imageMode)}
								disabled={composerMode === 'recording' || composerMode === 'talkback'}
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all active:scale-90 disabled:opacity-40
									{imageMode
									? 'border border-cyan-500/50 bg-cyan-950 text-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
									: 'border border-zinc-800/80 bg-zinc-900 text-zinc-400 hover:text-white'}"
								aria-label="Toggle Image Gen Mode"
								title="Image Generation Mode"
							>
								<Sparkles size={15} />
							</button>

							<!-- Voice Dictation Mic -->
							<button
								type="button"
								onclick={toggleRecord}
								disabled={composerMode === 'talkback'}
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all active:scale-90 disabled:opacity-40
									{composerMode === 'recording'
									? 'animate-pulse border border-amber-500/50 bg-amber-950 text-amber-400 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
									: 'border border-zinc-800/80 bg-zinc-900 text-zinc-400 hover:text-white'}"
								aria-label={composerMode === 'recording' ? 'Stop Recording' : 'Voice Dictation'}
								title={composerMode === 'recording' ? 'Stop Recording' : 'Voice Dictation'}
							>
								{#if composerMode === 'recording'}
									<Square size={14} />
								{:else}
									<Mic size={15} />
								{/if}
							</button>

							<!-- Talkback Continuous -->
							<button
								type="button"
								onclick={toggleTalkback}
								disabled={composerMode === 'recording'}
								class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all active:scale-90 disabled:opacity-40
									{composerMode === 'talkback'
									? 'animate-pulse border border-emerald-500/50 bg-emerald-950 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
									: 'border border-zinc-800/80 bg-zinc-900 text-zinc-400 hover:text-white'}"
								aria-label="Hands-free continuous Talkback"
								title="Hands-free continuous Talkback"
							>
								{#if composerMode === 'talkback'}
									<Square size={14} />
								{:else}
									<Headphones size={15} />
								{/if}
							</button>
						</div>

						<!-- Send Button -->
						<button
							type="button"
							onclick={sendMessage}
							disabled={(!textDraft.trim() && !imageMode && attachments.length === 0) ||
								sending ||
								composerMode === 'recording' ||
								composerMode === 'talkback' ||
								attachments.some((a) => a.uploading)}
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-lg transition-all hover:scale-105 active:scale-95 disabled:scale-100 disabled:border disabled:border-zinc-800 disabled:from-zinc-900 disabled:to-zinc-900 disabled:text-zinc-600 disabled:shadow-none"
							aria-label="Send Message"
							title="Send (Enter)"
							style={textDraft.trim() && !sending && composerMode === 'idle'
								? 'box-shadow: 0 0 12px rgba(168, 85, 247, 0.35);'
								: ''}
						>
							<Send size={14} />
						</button>
					</div>
				</div>
			</div>
		</div>
	</main>
</div>

{#if workspaceContextOpen}
	<div
		class="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
		onclick={(e) => {
			if (e.target === e.currentTarget) workspaceContextOpen = false;
		}}
		role="presentation"
	>
		<div
			class="flex w-full max-w-[520px] flex-col gap-3 rounded-t-2xl border border-zinc-800 bg-[#0e0e0e] p-4 shadow-2xl sm:rounded-2xl"
			style="padding-bottom: max(1rem, env(safe-area-inset-bottom));"
		>
			<div class="flex items-center gap-2">
				<Edit3 size={14} class="text-purple-400" aria-hidden="true" />
				<div class="flex-1 font-mono text-[11px] tracking-wider text-zinc-400 uppercase">
					Workspace context · {selectedWorkspace?.display_name ?? selectedRepo}
				</div>
				<button
					type="button"
					onclick={() => (workspaceContextOpen = false)}
					class="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-white"
					aria-label="Close"
				>
					<X size={14} aria-hidden="true" />
				</button>
			</div>
			<p class="text-[12px] text-zinc-500">
				Auto-injects into every chat send within
				<span class="font-mono text-zinc-300">{selectedRepo}</span>. Keep it focused —
				project intent, key files, gotchas. Saves retyping every new thread.
			</p>
			<textarea
				bind:value={workspaceContextDraft}
				maxlength={WORKSPACE_CONTEXT_MAX}
				rows="8"
				placeholder="e.g. Chat surface at src/routes/chat/+page.svelte. SDK endpoint /api/chat/sdk-stream. Test framework Playwright."
				class="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 font-sans text-[13px] leading-snug text-white placeholder:text-zinc-600 focus:border-zinc-700 focus:outline-none"
				style="min-height: 160px;"
			></textarea>
			<div class="flex items-center justify-between gap-2">
				<div class="font-mono text-[10px] text-zinc-600">
					{workspaceContextDraft.length} / {WORKSPACE_CONTEXT_MAX}
				</div>
				<div class="flex items-center gap-1.5">
					<button
						type="button"
						onclick={() => (workspaceContextOpen = false)}
						class="rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 font-mono text-[10px] tracking-wider text-zinc-400 uppercase transition-colors hover:bg-zinc-900 hover:text-white"
					>
						Cancel
					</button>
					<button
						type="button"
						onclick={saveWorkspaceContext}
						disabled={workspaceContextSaving}
						class="rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 px-3 py-1.5 font-mono text-[10px] tracking-wider text-white uppercase shadow-lg transition-all hover:scale-105 active:scale-95 disabled:scale-100 disabled:opacity-50"
					>
						{workspaceContextSaving ? 'Saving…' : 'Save'}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}

{#if canvasArtifact}
	<Canvas
		code={canvasArtifact.code}
		language={canvasArtifact.language}
		onclose={closeCanvas}
	/>
{/if}

<style>
	@keyframes fade-in {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
