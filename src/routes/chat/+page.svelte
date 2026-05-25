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
		Plus
	} from 'lucide-svelte';
	import { toasts } from '$lib/utils/toasts';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Markdown from '$lib/components/Markdown.svelte';

	let { data }: { data: PageData } = $props();

	// Active chat state seeded from SSR to ensure zero flicker on load.
	let messages = $state<ChatMessage[]>(data.messages || []);
	let textDraft = $state('');
	let sending = $state(false);
	let actionSubmitting = $state<number | null>(null); // messageId of active action being updated
	let feedContainer = $state<HTMLDivElement | null>(null);

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

	const POLL_INTERVAL_MS = 3000;
	// Faster cadence while at least one trace is in flight (worker is doing
	// something we want to render quickly). Falls back to baseline when idle.
	const ACTIVITY_POLL_FAST_MS = 1000;
	const ACTIVITY_POLL_IDLE_MS = 3000;

	// A trace is "active" if it has been mentioned by a system message but
	// hasn't emitted a terminal action yet (completed/failed). The UI uses
	// this to decide whether to keep polling activity for it.
	function isTraceActive(traceId: string): boolean {
		const rows = activityByTrace[traceId] || [];
		if (rows.length === 0) return true; // mentioned but no activity yet
		const last = rows[rows.length - 1]?.action || '';
		return !(last === 'completed' || last === 'failed');
	}

	function tracesFromMessages(msgs: ChatMessage[]): string[] {
		const set = new Set<string>();
		for (const m of msgs) {
			if (m.trace_id) set.add(m.trace_id);
		}
		return Array.from(set);
	}

	// Scroll the chat container to the absolute bottom.
	async function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
		await tick();
		if (feedContainer) {
			feedContainer.scrollTo({
				top: feedContainer.scrollHeight,
				behavior
			});
		}
	}

	// Poll the API for new messages stateless and snappy
	async function pollMessages() {
		try {
			const resp = await fetch(resolve('/api/chat'));
			if (!resp.ok) return;
			const body = await resp.json();
			const newMessages: ChatMessage[] = body.messages || [];

			// Only update state and scroll if there is a real difference in counts or content
			if (newMessages.length !== messages.length || JSON.stringify(newMessages) !== JSON.stringify(messages)) {
				messages = newMessages;
				scrollToBottom('smooth');
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
		scrollToBottom('auto');
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
					message: draft
				})
			});

			if (!resp.ok) {
				const err = await resp.json().catch(() => ({}));
				throw new Error(err.error || `HTTP ${resp.status}`);
			}

			const body = await resp.json();
			// Snappy local append
			messages = [...messages, body.message];
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
</script>

<svelte:head>
	<title>Co-Working Chat — LogueOS</title>
</svelte:head>

<div class="flex flex-col h-[calc(100dvh-100px)] max-w-5xl mx-auto overflow-hidden">
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
		class="flex-1 overflow-y-auto px-2 py-4 flex flex-col gap-4 custom-scrollbar"
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
							<span>New conversation · {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
						</div>
						<div class="h-px flex-1 bg-border"></div>
					</div>
				{:else}
				<!-- Message Container -->
				<div class="flex flex-col gap-1 {m.sender === 'operator' ? 'items-end' : 'items-start'} animate-fade-in">
					
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
						<span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
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
				{/if}
				{/each}
			{/if}
		</div>

	<!-- Typing Input Area -->
	<div class="shrink-0 border-t border-border bg-background/95 p-3 flex flex-col gap-2">
		
		<!-- Quick Suggestion Pill strip -->
		<div class="flex items-center gap-1.5 overflow-x-auto py-0.5 select-none custom-scrollbar">
			<button
				type="button"
				onclick={() => { textDraft = '@agy audit our code config'; }}
				class="shrink-0 px-2.5 py-1 rounded bg-surface/50 border border-border text-[11px] font-mono text-muted-foreground hover:text-white transition-colors active:scale-95"
			>
				@agy audit
			</button>
			<button
				type="button"
				onclick={() => { textDraft = '@cc run vitest'; }}
				class="shrink-0 px-2.5 py-1 rounded bg-surface/50 border border-border text-[11px] font-mono text-muted-foreground hover:text-white transition-colors active:scale-95"
			>
				@cc run vitest
			</button>
			<button
				type="button"
				onclick={() => { textDraft = '@agy check theme vars'; }}
				class="shrink-0 px-2.5 py-1 rounded bg-surface/50 border border-border text-[11px] font-mono text-muted-foreground hover:text-white transition-colors active:scale-95"
			>
				@agy theme
			</button>
		</div>

		<!-- Input field -->
		<div class="relative flex items-center">
			<textarea
				bind:value={textDraft}
				onkeypress={handleKeyPress}
				onpaste={handlePaste}
				ondrop={handleDrop}
				ondragover={(e) => e.preventDefault()}
				rows="1"
				placeholder={uploading ? 'Uploading image...' : "Message your agents (paste an image or '@agy run a check')..."}
				autocomplete="off"
				autocorrect="off"
				autocapitalize="none"
				spellcheck="false"
				class="w-full rounded-md border border-border bg-surface px-4 py-3 pr-12 font-sans text-base text-white placeholder:text-muted-foreground resize-none transition-colors focus:border-cta/50 focus:outline-none max-h-32"
				style="min-height: 44px;"
			></textarea>

			<button
				type="button"
				onclick={handleSendMessage}
				disabled={!textDraft.trim() || sending}
				aria-label="Send message"
				class="absolute right-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-md border border-cta/20 bg-cta/10 text-cta transition-all duration-200 active:scale-90 disabled:opacity-40 disabled:pointer-events-none hover:bg-cta/20"
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
