<script lang="ts">
	// Token-entry page. Lets the operator paste their LOGUEOS_OPERATOR_TOKEN
	// directly into the PWA (which has an isolated cookie jar from Safari on
	// iOS, so a one-time Safari visit doesn't help the PWA). The form POSTs
	// back to the same path; server validates, sets the `cc_operator` cookie,
	// redirects to /console/chat.
	import { base } from '$app/paths';

	let token = $state('');
	let error = $state<string | null>(null);
	let busy = $state(false);

	async function submit(e: Event) {
		e.preventDefault();
		if (!token.trim()) return;
		busy = true;
		error = null;
		try {
			const r = await fetch(`${base}/operator-auth?token=${encodeURIComponent(token.trim())}`, {
				method: 'GET',
				redirect: 'manual'
			});
			// 302 with Location header → success (cookie set on the response)
			// Or 200 if the redirect was opaque-rewritten by some intermediate
			if (r.type === 'opaqueredirect' || r.status === 302 || r.ok) {
				// Reload to /chat so the page picks up the new cookie
				window.location.href = `${base}/chat`;
				return;
			}
			if (r.status === 401) {
				error = 'Token rejected. Double-check the value.';
			} else {
				error = `Unexpected response: ${r.status}`;
			}
		} catch (e) {
			error = `Network error: ${e instanceof Error ? e.message : 'unknown'}`;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head>
	<title>Operator Auth · LogueOS Console</title>
</svelte:head>

<div class="auth-shell">
	<form class="auth-card" onsubmit={submit}>
		<div class="title">Operator authentication</div>
		<p class="hint">
			Paste your <code>LOGUEOS_OPERATOR_TOKEN</code> to unlock the chat APIs on this
			device. The token comes from the canonical .env on the host. The cookie persists
			for 1 year and survives PWA reinstall on the same Safari profile.
		</p>
		<input
			type="password"
			bind:value={token}
			placeholder="Token (URL-safe string)"
			autocomplete="off"
			autocapitalize="off"
			autocorrect="off"
			spellcheck="false"
			class="input"
			disabled={busy}
		/>
		{#if error}
			<div class="error">{error}</div>
		{/if}
		<button type="submit" disabled={busy || !token.trim()} class="submit">
			{busy ? 'Setting cookie…' : 'Authenticate'}
		</button>
	</form>
</div>

<style>
	.auth-shell {
		display: flex;
		min-height: 100dvh;
		align-items: center;
		justify-content: center;
		background: #050505;
		color: white;
		padding: 1rem;
		padding-top: max(1rem, env(safe-area-inset-top));
		padding-bottom: max(1rem, env(safe-area-inset-bottom));
		font-family: 'Inter', system-ui, -apple-system, sans-serif;
	}
	.auth-card {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 100%;
		max-width: 360px;
		padding: 1.25rem;
		border: 1px solid rgb(255 255 255 / 0.08);
		border-radius: 1rem;
		background: #0e0e0e;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}
	.title {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: rgb(216 180 254);
	}
	.hint {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.45;
		color: rgb(255 255 255 / 0.6);
	}
	.hint code {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: 0.72rem;
		background: rgb(255 255 255 / 0.05);
		padding: 0.05rem 0.3rem;
		border-radius: 0.25rem;
	}
	.input {
		font-size: 16px; /* iOS zoom-prevention */
		padding: 0.7rem 0.8rem;
		border: 1px solid rgb(255 255 255 / 0.1);
		border-radius: 0.6rem;
		background: #050505;
		color: white;
		outline: none;
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
	}
	.input:focus {
		border-color: rgb(168 85 247 / 0.5);
	}
	.error {
		font-size: 0.78rem;
		color: rgb(252 165 165);
		padding: 0.4rem 0.6rem;
		border: 1px solid rgb(220 38 38 / 0.3);
		border-radius: 0.4rem;
		background: rgb(220 38 38 / 0.08);
	}
	.submit {
		padding: 0.7rem 1rem;
		border: none;
		border-radius: 0.6rem;
		background: linear-gradient(135deg, rgb(168 85 247), rgb(236 72 153));
		color: white;
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: 0.78rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		cursor: pointer;
		transition: all 0.12s;
		min-height: 44px;
	}
	.submit:hover:not(:disabled) {
		transform: scale(1.02);
	}
	.submit:active:not(:disabled) {
		transform: scale(0.98);
	}
	.submit:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
