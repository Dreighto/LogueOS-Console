<script lang="ts">
	// xterm.js is a browser-only library — top-level import references `document`
	// which breaks SSR. Lazy-load inside onMount via dynamic import.
	import type { Terminal as XTermTerminal } from '@xterm/xterm';
	import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit';
	import { onMount, onDestroy } from 'svelte';

	// Native xterm.js mounted directly, speaking ttyd's WebSocket protocol.
	// Replaces the prior ttyd-in-iframe approach because iOS Safari can't
	// reliably summon the soft keyboard on a cross-iframe terminal — xterm.js
	// in the host page handles focus itself and works on iOS.
	//
	// ttyd WS protocol (per tsl0922/ttyd source):
	//   subprotocol: 'tty'
	//   client → server:
	//     '0' + bytes  = stdin
	//     '1' + JSON   = resize {columns, rows}
	//     '{}'         = initial auth handshake (text frame)
	//   server → client:
	//     '0' + bytes  = stdout
	//     '1' + bytes  = set window title (ignored here)
	//     '2' + JSON   = preferences (ignored here)
	//
	// The iOS / mobile patterns the Perplexity research called out:
	//   - Reconnect WebSocket on visibilitychange (iOS kills WS on background)
	//   - No client-side heartbeat (iOS suspends timers anyway)
	//   - tmux on the server side IS the persistence — losing the WS just
	//     drops the view, the tmux session keeps running
	//   - call term.focus() after WS open so soft keyboard surfaces on tap

	let { wsUrl }: { wsUrl: string } = $props();

	let containerEl: HTMLDivElement;
	let term: XTermTerminal | null = null;
	let fit: XTermFitAddon | null = null;
	let ws: WebSocket | null = null;
	let resizeObs: ResizeObserver | null = null;
	let connected = $state(false);
	let reconnectAttempts = $state(0);

	function send(text: string) {
		if (ws && ws.readyState === WebSocket.OPEN) ws.send(text);
	}

	function sendBinary(prefix: string, payload: string) {
		send(prefix + payload);
	}

	function sendResize() {
		if (!term) return;
		sendBinary('1', JSON.stringify({ columns: term.cols, rows: term.rows }));
	}

	function connect() {
		if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

		ws = new WebSocket(wsUrl, ['tty']);
		ws.binaryType = 'arraybuffer';

		ws.onopen = () => {
			connected = true;
			reconnectAttempts = 0;
			// Send empty auth handshake — ttyd expects this as the first text frame.
			send(JSON.stringify({ AuthToken: '' }));
			// Tell ttyd the current terminal size.
			sendResize();
			// Focus so the soft keyboard summons on iOS.
			term?.focus();
		};

		ws.onmessage = (ev) => {
			if (!term) return;
			if (typeof ev.data === 'string') {
				// ttyd doesn't send much text after handshake; ignore unknown text frames.
				return;
			}
			const arr = new Uint8Array(ev.data as ArrayBuffer);
			if (arr.length === 0) return;
			const cmd = String.fromCharCode(arr[0]);
			const payload = arr.subarray(1);
			if (cmd === '0') {
				term.write(payload);
			}
			// '1' (set_title) and '2' (preferences) ignored.
		};

		ws.onclose = () => {
			connected = false;
		};

		ws.onerror = () => {
			connected = false;
		};
	}

	// Reconnect when the tab comes back to the foreground (iOS aggressively
	// kills background WebSockets). tmux on the server is the persistence
	// layer — reconnecting just re-attaches the view, the shell state is
	// preserved.
	function onVisible() {
		if (document.visibilityState === 'visible' && (!ws || ws.readyState !== WebSocket.OPEN)) {
			reconnectAttempts++;
			connect();
		}
	}

	onMount(async () => {
		// Dynamic imports — these libs touch `document` at module top-level so
		// they can't be SSR-loaded.
		const [{ Terminal }, { FitAddon }] = await Promise.all([
			import('@xterm/xterm'),
			import('@xterm/addon-fit'),
			import('@xterm/xterm/css/xterm.css')
		]);

		term = new Terminal({
			cursorBlink: true,
			fontSize: 14,
			fontFamily: '"IBM Plex Mono", "Cascadia Mono", monospace',
			theme: { background: '#0d1117', foreground: '#c9d1d9' },
			scrollback: 5000,
			allowProposedApi: true,
			convertEol: false
		});
		fit = new FitAddon();
		term.loadAddon(fit);
		term.open(containerEl);
		// First fit AFTER the element is in the layout.
		queueMicrotask(() => fit?.fit());

		// Forward typed input to ttyd as '0' frames.
		term.onData((d) => sendBinary('0', d));

		// Debounce resize → server.
		let resizeTimer: ReturnType<typeof setTimeout> | null = null;
		const onLayoutChange = () => {
			if (resizeTimer) clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				fit?.fit();
				sendResize();
			}, 100);
		};
		resizeObs = new ResizeObserver(onLayoutChange);
		resizeObs.observe(containerEl);

		document.addEventListener('visibilitychange', onVisible);

		connect();
	});

	onDestroy(() => {
		resizeObs?.disconnect();
		document.removeEventListener('visibilitychange', onVisible);
		ws?.close();
		ws = null;
		term?.dispose();
		term = null;
	});
</script>

<div class="relative h-full w-full">
	<div
		bind:this={containerEl}
		role="application"
		aria-label="terminal"
		tabindex="0"
		class="h-full w-full focus:outline-none"
		onclick={() => term?.focus()}
		onkeydown={() => term?.focus()}
	></div>
	{#if !connected}
		<div
			class="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center bg-amber-500/10 px-3 py-1 font-mono text-[10px] text-amber-300"
		>
			reconnecting{reconnectAttempts > 0 ? ` · attempt ${reconnectAttempts}` : ''}...
		</div>
	{/if}
</div>

<style>
	/* Force xterm to fill the container — by default it sets explicit width
	   on the .xterm element which prevents proper resize fits. */
	:global(.xterm) {
		height: 100%;
		width: 100%;
		padding: 4px 6px;
	}
	:global(.xterm-viewport) {
		overflow-y: auto;
	}
</style>
