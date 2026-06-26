<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	// Compatibility shim for iOS PWAs that were "Added to Home Screen" back when
	// /chat existed. iOS hard-caches the install-time URL and ignores manifest
	// start_url changes; without this stub every PWA launch from those old
	// shortcuts otherwise lands on a 404.
	//
	// CRITICAL — DO NOT replace this with a server-side `throw redirect(307, '/')`
	// (LOS-247). iOS treats an HTTP 3xx that lands outside the manifest scope as
	// an out-of-scope navigation and PERMANENTLY demotes the home-screen shortcut
	// to a Safari bookmark — the standalone PWA shell disappears and the
	// operator's home indicator + Safari toolbar return. Recovery is manual
	// (remove + re-add the home-screen shortcut). Client-side `goto()` keeps the
	// navigation entirely inside the PWA shell, so iOS doesn't demote.
	onMount(() => {
		goto(resolve('/'), { replaceState: true });
	});
</script>

<svelte:head>
	<title>Returning to home…</title>
</svelte:head>

<div class="flex min-h-[50dvh] flex-col items-center justify-center gap-3 px-4 py-12 text-center">
	<div class="text-sm text-zinc-400">The chat surface moved to Sully.</div>
	<a
		href={resolve('/')}
		class="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700"
	>
		Return to Console home
	</a>
</div>
