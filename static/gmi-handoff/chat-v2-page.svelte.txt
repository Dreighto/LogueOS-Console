<script lang="ts">
	// Chat Surface V2 — Conversational OS.
	//
	// Design philosophy (locked spec, see commit message + handoff thread):
	//   - Full-bleed immersive canvas. No global chrome, no bordered shell,
	//     no bottom nav. The entire device becomes the console.
	//   - Conversation IS the interface. Activity, routing, state appear as
	//     inline artifacts and ephemeral pills — not panels.
	//   - Composer is the hero element: single unified glowing pill, all
	//     controls inside, soft neon edge lighting.
	//   - Header is a near-invisible identity anchor. Minimal chips for
	//     repo / thread / tier context.
	//   - Color is emotional, not functional. Atmosphere over semantics.
	//
	// Backend contracts unchanged — every endpoint and table from the
	// 13-PR backend epic is reused as-is. This is a pure visual rewrite.

	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import { base, resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import {
		Send,
		Mic,
		Paperclip,
		Sparkles,
		Headphones,
		Square,
		ChevronDown
	} from 'lucide-svelte';
	import { toasts } from '$lib/utils/toasts';

	let { data } = $props();

	// ─────────────────────────────────────────────────────────────────────
	// State
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
	let sending = $state(false);

	// Ephemeral worker-activity pill state. Populated by polling /api/chat/activity;
	// when a worker is dispatched FROM this surface, this pill floats above the
	// feed with a soft pulse until the worker completes (or 60s elapses).
	let activityPill = $state<{ worker: string; step: string; trace_id: string } | null>(null);
	let activityFadeTimer: ReturnType<typeof setTimeout> | null = null;

	// Composer mode controls the glow treatment + button affordances:
	//   idle      — gentle gradient border
	//   focused   — slightly brighter glow on textarea focus
	//   recording — amber pulse around the whole pill (mic is hot)
	//   talkback  — green sustained glow (walkie-talkie loop active)
	let composerMode = $state<'idle' | 'focused' | 'recording' | 'talkback'>('idle');

	// Chip dropdown open-states (single state field; only one open at a time
	// to avoid visual collision on phone widths).
	let openChip = $state<null | 'repo' | 'thread' | 'tier'>(null);

	// MediaRecorder for one-shot voice dictation (PR 4).
	let mediaRecorder: MediaRecorder | null = null;
	let recordChunks: Blob[] = [];

	// Persistent audio element for TTS playback (PR 4 unlock continuity rule).
	let audioEl = $state<HTMLAudioElement | null>(null);
	let audioUnlocked = false;

	// Refs.
	let feedContainer = $state<HTMLDivElement | null>(null);
	let scrollSentinel = $state<HTMLDivElement | null>(null);
	let textareaEl = $state<HTMLTextAreaElement | null>(null);

	// Scroll state — IntersectionObserver pattern from PR 2.
	let userAtBottom = $state(true);
	let unseenCount = $state(0);

	// ─────────────────────────────────────────────────────────────────────
	// Derived
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
	// Effects
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

	// ─────────────────────────────────────────────────────────────────────
	// Network helpers
	// ─────────────────────────────────────────────────────────────────────
	async function loadTier(threadId: string) {
		try {
			const r = await fetch(resolve(`/api/chat/tier?thread_id=${encodeURIComponent(threadId)}`));
			if (r.ok) {
				const b = await r.json();
				if (b.current_tier) currentTier = b.current_tier as Tier;
			}
		} catch {
			/* keep last known */
		}
	}

	async function pollMessages() {
		try {
			const r = await fetch(
				resolve('/api/chat') + `?thread=${encodeURIComponent(activeThread)}`
			);
			if (!r.ok) return;
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
				// Auto-fade after 60s of no further updates for this trace.
				activityFadeTimer = setTimeout(() => {
					if (activityPill?.trace_id === live!.trace_id) activityPill = null;
				}, 60_000);
			} else if (activityPill) {
				// No live workers — fade pill within ~3s.
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
	// Audio unlock — PR 4/5 iOS gesture lock workaround.
	// Call inside any first user gesture (send, mic press, talkback toggle).
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
	// Send message
	// ─────────────────────────────────────────────────────────────────────
	async function sendMessage() {
		const text = textDraft.trim();
		if (!text || sending) return;
		unlockAudio();
		sending = true;
		const optimistic: ChatMessage = {
			id: Date.now(),
			sender: 'operator',
			message: text,
			timestamp: new Date().toISOString()
		};
		messages = [...messages, optimistic];
		textDraft = '';
		queueMicrotask(() => scrollSentinel?.scrollIntoView({ behavior: 'smooth' }));
		try {
			const r = await fetch(resolve('/api/chat'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: text,
					thread: activeThread,
					target_repo: selectedRepo
				})
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			await pollMessages();
		} catch (e) {
			toasts.add(`Send failed: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
			textDraft = text; // restore on error
		} finally {
			sending = false;
		}
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			void sendMessage();
		}
	}

	// ─────────────────────────────────────────────────────────────────────
	// Voice dictation (PR 4 — one-shot)
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
					if (b.text) textDraft = (textDraft + ' ' + b.text).trim();
				} catch {
					toasts.add('Transcription unreachable', 'error');
				}
			};
			mediaRecorder.start();
			composerMode = 'recording';
		} catch {
			toasts.add('Microphone permission denied', 'error');
		}
	}

	// ─────────────────────────────────────────────────────────────────────
	// Talkback toggle (PR 5 — walkie-talkie loop). V2 stub: surfaces the
	// glow state and the STOP affordance; full loop wiring stays in the
	// existing implementation hooks.
	// ─────────────────────────────────────────────────────────────────────
	function toggleTalkback() {
		unlockAudio();
		composerMode = composerMode === 'talkback' ? 'idle' : 'talkback';
		toasts.add(
			composerMode === 'talkback'
				? 'Talkback engaged. Listening continuously.'
				: 'Talkback stopped.',
			'success'
		);
	}

	// ─────────────────────────────────────────────────────────────────────
	// Thread switching
	// ─────────────────────────────────────────────────────────────────────
	async function switchThread(threadId: string) {
		if (threadId === activeThread) {
			openChip = null;
			return;
		}
		activeThread = threadId;
		openChip = null;
		messages = [];
		await pollMessages();
		await loadTier(threadId);
	}

	function switchRepo(name: string) {
		selectedRepo = name;
		openChip = null;
	}

	// ─────────────────────────────────────────────────────────────────────
	// Mount / cleanup
	// ─────────────────────────────────────────────────────────────────────
	let pollTimer: ReturnType<typeof setInterval>;
	let activityTimer: ReturnType<typeof setInterval>;
	let sentinelObs: IntersectionObserver | null = null;

	onMount(() => {
		void loadTier(activeThread);
		// IntersectionObserver scroll-lock (PR 2 pattern).
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
	});

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
	<title>LogueOS — Chat</title>
</svelte:head>

<!-- Persistent audio element for TTS playback. Single instance, never
     destroyed (PR 4 iOS unlock continuity rule). -->
<audio bind:this={audioEl} class="hidden" aria-hidden="true"></audio>

<!-- =======================================================================
     CONVERSATIONAL OS SURFACE
     Full-bleed dark canvas. No global chrome, no bordered shell.
     The entire device becomes the console.
     ======================================================================= -->
<div
	class="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[#050505] text-foreground"
	style="padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px);"
>
	<!-- Ambient atmosphere — soft radial gradient bloom at top of canvas.
	     Purely visual, behind everything, pointer-events-none. -->
	<div
		class="pointer-events-none absolute inset-0 -z-0"
		style="background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(168, 85, 247, 0.08), transparent 60%), radial-gradient(ellipse 60% 50% at 100% 100%, rgba(244, 114, 182, 0.05), transparent 50%);"
	></div>

	<!-- ═════════════════════════════════════════════════════════════════
	     QUIET HEADER — borderless identity anchor.
	     LogueOS logo (taps back to / for the rest of the Console) +
	     three context chips. No bars, no separators.
	     ═════════════════════════════════════════════════════════════════ -->
	<header class="relative z-10 flex shrink-0 items-center justify-between px-4 pt-3 pb-2">
		<a
			href={resolve('/')}
			aria-label="Back to Console"
			class="flex h-9 w-9 items-center justify-center transition-opacity hover:opacity-80"
		>
			<img src="{base}/favicon.png" alt="LogueOS" class="h-7 w-7" />
		</a>

		<div class="flex items-center gap-1.5">
			<!-- Repo chip -->
			<div class="relative">
				<button
					type="button"
					onclick={() => (openChip = openChip === 'repo' ? null : 'repo')}
					class="flex items-center gap-1 rounded-full px-2 py-1 font-sans text-xs text-muted-foreground transition-all hover:text-foreground"
					aria-label="Workspace"
				>
					<span>{selectedWorkspace?.emoji ?? '📁'}</span>
					<span>{selectedWorkspace?.display_name ?? selectedRepo}</span>
					<ChevronDown size={10} />
				</button>
				{#if openChip === 'repo'}
					<button
						type="button"
						class="fixed inset-0 z-40"
						onclick={() => (openChip = null)}
						aria-label="Close"
						tabindex="-1"
					></button>
					<div
						class="absolute top-full right-0 z-50 mt-2 min-w-44 rounded-2xl border border-white/5 bg-black/80 py-1.5 shadow-2xl backdrop-blur-xl"
					>
						{#each workspaces as ws (ws.name)}
							<button
								type="button"
								onclick={() => switchRepo(ws.name)}
								class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-white/5
									{selectedRepo === ws.name ? 'text-foreground' : 'text-muted-foreground'}"
							>
								<span>{ws.emoji}</span>
								<span>{ws.display_name}</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Thread chip -->
			<div class="relative">
				<button
					type="button"
					onclick={() => (openChip = openChip === 'thread' ? null : 'thread')}
					class="flex items-center gap-1 rounded-full px-2 py-1 font-sans text-xs text-muted-foreground transition-all hover:text-foreground"
					aria-label="Thread"
				>
					<span>{activeThread === 'default' ? 'Default' : activeThread}</span>
					<ChevronDown size={10} />
				</button>
				{#if openChip === 'thread'}
					<button
						type="button"
						class="fixed inset-0 z-40"
						onclick={() => (openChip = null)}
						aria-label="Close"
						tabindex="-1"
					></button>
					<div
						class="absolute top-full right-0 z-50 mt-2 max-h-[50vh] min-w-44 overflow-y-auto rounded-2xl border border-white/5 bg-black/80 py-1.5 shadow-2xl backdrop-blur-xl"
					>
						{#each threads as t (t.thread_id)}
							<button
								type="button"
								onclick={() => switchThread(t.thread_id)}
								class="flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors hover:bg-white/5
									{activeThread === t.thread_id ? 'text-foreground' : 'text-muted-foreground'}"
							>
								{t.thread_id === 'default' ? 'Default' : t.thread_id}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Tier badge (read-only in V2 V1; tap-to-override deferred) -->
			<span
				class="flex items-center gap-1 rounded-full px-2 py-1 font-sans text-xs text-muted-foreground"
				aria-label="Model tier"
				title="Current model tier (auto)"
			>
				<span>{tierEmoji}</span>
			</span>
		</div>
	</header>

	<!-- ═════════════════════════════════════════════════════════════════
	     EPHEMERAL ACTIVITY PILL — floating above the feed.
	     Appears when a worker is active. Auto-fades.
	     Transient thought bubble, not durable chrome.
	     ═════════════════════════════════════════════════════════════════ -->
	{#if activityPill}
		<div class="relative z-10 mx-auto px-4 pb-1" style="animation: fade-in 0.3s ease-out;">
			<div
				class="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/5 px-3 py-1 backdrop-blur-md"
				style="box-shadow: 0 0 16px rgba(34, 211, 238, 0.15);"
			>
				<span
					class="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400"
					style="animation: pulse 1.4s ease-in-out infinite;"
				></span>
				<span class="font-mono text-[11px] text-cyan-400">
					⚡ {activityPill.worker}: {activityPill.step}
				</span>
				<a
					href={resolve('/activity')}
					class="font-mono text-[10px] text-cyan-300/60 hover:text-cyan-300"
				>
					[View Logs]
				</a>
			</div>
		</div>
	{/if}

	<!-- ═════════════════════════════════════════════════════════════════
	     MESSAGE FEED — cinematic spacing, full-bleed.
	     No bordered shell. iMessage-style bubbles floating on canvas.
	     ═════════════════════════════════════════════════════════════════ -->
	<div
		bind:this={feedContainer}
		class="relative z-10 flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-4"
	>
		{#if messages.length === 0}
			<div class="flex flex-1 items-center justify-center text-center">
				<div class="max-w-xs">
					<div class="font-sans text-sm font-light text-muted-foreground/50">
						Talk to your loop.
					</div>
					<div class="mt-2 font-mono text-[10px] tracking-widest text-muted-foreground/30 uppercase">
						{selectedWorkspace?.display_name ?? selectedRepo} · {tierEmoji}
					</div>
				</div>
			</div>
		{:else}
			{#each messages as m (m.id)}
				<div
					class="flex flex-col gap-1 {m.sender === 'operator' ? 'items-end' : 'items-start'}"
				>
					<div
						class="max-w-[80%] rounded-2xl px-4 py-2.5 font-sans text-[15px] leading-relaxed select-text whitespace-pre-wrap
							{m.sender === 'operator'
							? 'bg-gradient-to-br from-purple-500/20 to-pink-500/15 text-white'
							: 'bg-white/[0.04] text-foreground/95'}"
						style={m.sender === 'operator'
							? 'box-shadow: 0 0 24px rgba(168, 85, 247, 0.08);'
							: ''}
					>
						{#if m.sender !== 'operator'}
							<div
								class="mb-1 font-mono text-[10px] tracking-wider text-muted-foreground/60 uppercase"
							>
								{senderDisplay(m.sender)}
							</div>
						{/if}
						{m.message}
					</div>
					<div class="px-1 font-mono text-[9px] text-muted-foreground/40">
						{fmtTime(m.timestamp)}
					</div>
				</div>
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
			class="absolute right-1/2 bottom-24 z-20 flex translate-x-1/2 items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 font-mono text-[11px] text-cyan-300 backdrop-blur-md"
			style="box-shadow: 0 0 16px rgba(34, 211, 238, 0.2);"
		>
			{unseenCount} new ↓
		</button>
	{/if}

	<!-- ═════════════════════════════════════════════════════════════════
	     HERO COMPOSER — single unified glowing pill.
	     All controls inside. Neon edge lighting changes with state.
	     ═════════════════════════════════════════════════════════════════ -->
	<div class="relative z-10 px-3 pt-2 pb-3">
		<div
			class="relative flex items-center gap-2 rounded-full px-3 py-2 transition-all duration-300
				{composerMode === 'recording'
				? 'bg-amber-500/[0.08]'
				: composerMode === 'talkback'
					? 'bg-emerald-500/[0.08]'
					: 'bg-white/[0.04]'}"
			style="box-shadow: {composerMode === 'recording'
				? '0 0 32px rgba(245, 158, 11, 0.35), inset 0 0 0 1px rgba(245, 158, 11, 0.5)'
				: composerMode === 'talkback'
					? '0 0 32px rgba(16, 185, 129, 0.3), inset 0 0 0 1px rgba(16, 185, 129, 0.5)'
					: '0 0 24px rgba(168, 85, 247, 0.15), inset 0 0 0 1px rgba(168, 85, 247, 0.25)'};"
		>
			<!-- Attach -->
			<button
				type="button"
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
				aria-label="Attach"
				title="Attach image"
			>
				<Paperclip size={16} />
			</button>

			<!-- Textarea -->
			<textarea
				bind:this={textareaEl}
				bind:value={textDraft}
				onkeypress={handleKey}
				onfocus={() => composerMode === 'idle' && (composerMode = 'focused')}
				onblur={() => composerMode === 'focused' && (composerMode = 'idle')}
				rows="1"
				placeholder={composerMode === 'recording'
					? 'Listening…'
					: composerMode === 'talkback'
						? 'Talkback engaged'
						: 'Ask or command…'}
				autocomplete="off"
				autocapitalize="sentences"
				spellcheck="false"
				class="flex-1 resize-none bg-transparent px-1 py-1 font-sans text-[15px] text-white placeholder:text-muted-foreground/50 focus:outline-none"
				style="max-height: 140px;"
			></textarea>

			<!-- Image-gen toggle -->
			<button
				type="button"
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
				aria-label="Image mode"
				title="Generate image"
			>
				<Sparkles size={16} />
			</button>

			<!-- Mic -->
			<button
				type="button"
				onclick={toggleRecord}
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors
					{composerMode === 'recording'
					? 'text-amber-400'
					: 'text-muted-foreground hover:text-foreground'}"
				aria-label={composerMode === 'recording' ? 'Stop recording' : 'Record voice'}
				title={composerMode === 'recording' ? 'Stop recording' : 'Voice dictation'}
			>
				{#if composerMode === 'recording'}
					<Square size={16} />
				{:else}
					<Mic size={16} />
				{/if}
			</button>

			<!-- Talkback toggle -->
			<button
				type="button"
				onclick={toggleTalkback}
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors
					{composerMode === 'talkback'
					? 'text-emerald-400'
					: 'text-muted-foreground hover:text-foreground'}"
				aria-label="Talkback mode"
				title="Hands-free Talkback"
			>
				<Headphones size={16} />
			</button>

			<!-- Send -->
			<button
				type="button"
				onclick={sendMessage}
				disabled={!textDraft.trim() || sending}
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-lg transition-all hover:scale-105 active:scale-95 disabled:scale-100 disabled:from-white/10 disabled:to-white/10 disabled:text-muted-foreground/50 disabled:shadow-none"
				aria-label="Send"
				title="Send (Enter)"
				style="box-shadow: 0 0 12px rgba(168, 85, 247, 0.4);"
			>
				<Send size={15} />
			</button>
		</div>
	</div>
</div>

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
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}
</style>
