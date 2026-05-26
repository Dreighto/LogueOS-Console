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
		ChevronDown,
		Menu,
		X,
		Plus,
		Pin,
		MessageSquare,
		Check
	} from 'lucide-svelte';
	import { toasts } from '$lib/utils/toasts';

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
	let sidebarOpen = $state(false);
	let imageMode = $state(false);

	// Ephemeral worker-activity pill state.
	let activityPill = $state<{ worker: string; step: string; trace_id: string } | null>(null);
	let activityFadeTimer: ReturnType<typeof setTimeout> | null = null;

	// Composer states
	let composerMode = $state<'idle' | 'focused' | 'recording' | 'talkback'>('idle');
	let openChip = $state<null | 'repo' | 'thread'>(null);

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

	const TIER_LABELS: Record<Tier, string> = {
		chat: '🪶 Quick (Chat)',
		planning: '⚖️ Planning',
		deep: '🧠 Deep',
		local: '🔧 Local'
	};

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

	// ─────────────────────────────────────────────────────────────────────
	// Network & Data Actions
	// ─────────────────────────────────────────────────────────────────────
	async function loadTier(threadId: string) {
		try {
			const r = await fetch(resolve(`/api/chat/tier?thread_id=${encodeURIComponent(threadId)}`));
			if (r.ok) {
				const b = await r.json();
				if (b.current_tier) currentTier = b.current_tier as Tier;
				lastModelUsed = b.last_model_used || '';
			}
		} catch {
			/* keep last known */
		}
	}

	async function setTierOverride(tier: Tier | null) {
		showModelOverrideModal = false;
		try {
			const resp = await fetch(resolve('/api/chat/tier'), {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ thread_id: activeThread, tier })
			});
			if (resp.ok) {
				const body = await resp.json();
				if (body.current_tier) currentTier = body.current_tier as Tier;
				await loadTier(activeThread);
				toasts.add(tier ? `Locked loop tier to ${tier}` : 'Reset tier to Auto', 'success');
			}
		} catch {
			toasts.add('Failed to update tier override', 'error');
		}
	}

	async function pollMessages() {
		try {
			const r = await fetch(resolve('/api/chat') + `?thread=${encodeURIComponent(activeThread)}`);
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
		const text = textDraft.trim();
		if (!text || sending) return;
		unlockAudio();
		sending = true;

		const isGenImage = imageMode;
		imageMode = false; // toggle off image mode immediately on send

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
					target_repo: selectedRepo,
					image: isGenImage || undefined
				})
			});
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			await pollMessages();
		} catch (e) {
			toasts.add(`Send failed: ${e instanceof Error ? e.message : 'unknown'}`, 'error');
			textDraft = text; // restore
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

	async function handleUpload(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

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
				const markdownLink = `![${file.name}](${body.url})`;
				if (textareaEl) {
					const start = textareaEl.selectionStart;
					const end = textareaEl.selectionEnd;
					const before = textDraft.slice(0, start);
					const after = textDraft.slice(end);
					textDraft = before + markdownLink + after;
					textareaEl.focus();
					const newPos = start + markdownLink.length;
					queueMicrotask(() => {
						if (textareaEl) {
							textareaEl.selectionStart = textareaEl.selectionEnd = newPos;
						}
					});
				} else {
					textDraft = (textDraft + ' ' + markdownLink).trim();
				}
				toasts.add('Upload completed successfully', 'success');
			}
		} catch (err) {
			toasts.add(`Upload failed: ${err instanceof Error ? err.message : 'unknown'}`, 'error');
		} finally {
			target.value = '';
		}
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
		await pollMessages();
		await loadTier(threadId);
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

	function newThread() {
		const raw = window.prompt('New thread name (letters, numbers, dashes):');
		if (!raw) return;
		const slug = slugifyThreadName(raw);
		if (!threads.some((t) => t.thread_id === slug)) {
			threads = [{ thread_id: slug, message_count: 0, latest_ts: '' }, ...threads];
		}
		void switchThread(slug);
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

<div class="relative flex h-[100dvh] w-full overflow-hidden bg-[#050505] font-sans text-foreground">
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
		<div class="flex-1 space-y-1 overflow-y-auto p-2">
			{#if threads.length === 0}
				<div class="px-3 py-4 text-center font-mono text-[10px] text-zinc-600">
					No active threads
				</div>
			{:else}
				{#each threads as t (t.thread_id)}
					<button
						type="button"
						onclick={() => switchThread(t.thread_id)}
						class="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left font-sans text-xs transition-all hover:scale-[1.01] active:scale-[0.99]
							{activeThread === t.thread_id
							? 'border border-zinc-700/50 bg-zinc-800/40 font-medium text-white'
							: 'border border-transparent bg-transparent text-zinc-400 hover:bg-zinc-900/40 hover:text-zinc-200'}"
					>
						<div class="flex items-center gap-2.5 truncate">
							<MessageSquare
								size={13}
								class={activeThread === t.thread_id ? 'text-purple-400' : 'text-zinc-500'}
							/>
							<span class="truncate"
								>{t.thread_id === 'default' ? 'Default Space' : t.thread_id}</span
							>
						</div>
						{#if t.message_count > 0}
							<span
								class="rounded border border-zinc-900 bg-zinc-950 px-1.5 py-0.5 font-mono text-[9px] text-zinc-500"
							>
								{t.message_count}
							</span>
						{/if}
					</button>
				{/each}
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
			class="relative z-10 flex shrink-0 items-center justify-between px-4 pt-3 pb-2 select-none"
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
						onclick={() => (openChip = openChip === 'repo' ? null : 'repo')}
						class="flex items-center gap-1.5 rounded-full border border-zinc-800/80 bg-zinc-950/60 px-3 py-1.5 font-sans text-xs text-zinc-300 transition-all hover:border-zinc-700 hover:text-white"
						aria-label="Target repository"
					>
						<span>{selectedWorkspace?.emoji ?? '📁'}</span>
						<span>{selectedWorkspace?.display_name ?? selectedRepo}</span>
						<ChevronDown size={10} class="text-zinc-500" />
					</button>

					{#if openChip === 'repo'}
						<button
							type="button"
							class="fixed inset-0 z-40 cursor-default"
							onclick={() => (openChip = null)}
							aria-label="Close popover"
							tabindex="-1"
						></button>
						<div
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
						</div>
					{/if}
				</div>

				<!-- Model Picker Badge -->
				<div class="relative">
					<button
						type="button"
						onclick={() => (showModelOverrideModal = !showModelOverrideModal)}
						class="flex items-center gap-1.5 rounded-full border border-zinc-800/80 bg-zinc-950/60 px-3 py-1.5 font-sans text-xs text-zinc-300 transition-all hover:border-zinc-700 hover:text-white"
						aria-label="Model routing tier"
						title="Override default classification routing"
					>
						<span>{tierEmoji}</span>
						{#if lastModelUsed}
							<span class="max-w-[100px] truncate font-mono text-[10px] tracking-wide text-zinc-400"
								>{lastModelUsed}</span
							>
						{:else}
							<span class="font-mono text-[10px] tracking-wide text-zinc-400 capitalize"
								>{currentTier}</span
							>
						{/if}
						<ChevronDown size={10} class="text-zinc-500" />
					</button>

					{#if showModelOverrideModal}
						<button
							type="button"
							class="fixed inset-0 z-40 cursor-default"
							onclick={() => (showModelOverrideModal = false)}
							aria-label="Close popover"
							tabindex="-1"
						></button>
						<div
							class="absolute top-full right-0 z-50 mt-2 min-w-48 rounded-2xl border border-zinc-800 bg-[#0e0e0e] py-1.5 shadow-2xl"
						>
							<div
								class="px-3 py-1 font-mono text-[9px] tracking-wider text-zinc-600 uppercase select-none"
							>
								Routing Tier Lock
							</div>
							{#each ['chat', 'planning', 'deep', 'local'] as Tier[] as t}
								<button
									type="button"
									onclick={() => setTierOverride(t)}
									class="flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-zinc-900
										{currentTier === t ? 'font-medium text-purple-400' : 'text-zinc-400'}"
								>
									<span>{TIER_LABELS[t]}</span>
									{#if currentTier === t}
										<Check size={11} />
									{/if}
								</button>
							{/each}
							<div class="mt-1.5 border-t border-zinc-800/50 pt-1.5">
								<button
									type="button"
									onclick={() => setTierOverride(null)}
									class="flex w-full items-center px-3 py-2 text-left text-xs text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300"
								>
									🔄 Auto-classify (Reset)
								</button>
							</div>
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

						<!-- Text Bubble -->
						<div
							class="max-w-[85%] rounded-2xl px-4 py-2.5 font-sans text-[15px] leading-relaxed whitespace-pre-wrap selection:bg-purple-900/50 selection:text-white sm:max-w-[80%]
								{m.sender === 'operator'
								? 'border border-orange-500/30 bg-orange-500/[0.03] text-orange-50 shadow-[0_0_20px_rgba(249,115,22,0.06)]'
								: 'border border-zinc-900 bg-zinc-950/40 text-zinc-100'}"
						>
							{m.message}
						</div>

						<!-- Time footer -->
						<div class="px-1 font-mono text-[9px] text-zinc-600 select-none">
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

				<!-- Text input area + icons -->
				<div class="flex items-center gap-2">
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

					<!-- Text Area -->
					<textarea
						bind:this={textareaEl}
						bind:value={textDraft}
						onkeypress={handleKey}
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
						class="flex-1 resize-none bg-transparent px-1 py-2 font-sans text-[15px] text-white placeholder:text-zinc-600 focus:outline-none disabled:text-zinc-500"
						style="max-height: 140px;"
					></textarea>

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

					<!-- Send Button -->
					<button
						type="button"
						onclick={sendMessage}
						disabled={(!textDraft.trim() && !imageMode) ||
							sending ||
							composerMode === 'recording' ||
							composerMode === 'talkback'}
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
	</main>
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
</style>
