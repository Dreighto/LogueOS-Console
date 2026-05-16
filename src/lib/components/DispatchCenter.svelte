<script lang="ts">
	import { resolve } from '$app/paths';
	import { Terminal, Send, Loader2, AlertCircle, CheckCircle2 } from 'lucide-svelte';

	let worker = $state('claude-code');
	let targetRepo = $state('project-miru');
	let ticketId = $state('');
	let prompt = $state('');
	let thinkingLevel = $state('none');

	let status = $state<'idle' | 'submitting' | 'success' | 'error'>('idle');
	let message = $state('');
	let lastTraceId = $state('');

	async function handleSubmit() {
		if (!prompt.trim()) return;

		status = 'submitting';
		message = '';

		try {
			const response = await fetch(resolve('/api/dispatch'), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					worker,
					target_repo: targetRepo,
					ticket_id: ticketId || null,
					prompt,
					thinking_level: thinkingLevel === 'none' ? null : thinkingLevel
				})
			});

			const data = await response.json();

			if (!response.ok) {
				status = 'error';
				message = data.error || 'Something went wrong — please try again';
			} else {
				status = 'success';
				message = 'Job sent!';
				lastTraceId = data.trace_id;
				// Reset prompt but keep other settings
				prompt = '';
			}
		} catch (err) {
			status = 'error';
			message = String(err);
		}
	}
</script>

<div class="flex flex-col h-full bg-slate-950 border border-slate-800 rounded-lg overflow-hidden shadow-2xl">
	<!-- Header -->
	<div class="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800">
		<div class="flex items-center gap-2 text-slate-300 font-mono text-sm uppercase tracking-wider">
			<Terminal size={16} />
			<span>Job Center</span>
		</div>
		<div class="flex items-center gap-4 text-[10px] font-mono">
			<div class="flex items-center gap-1.5 text-slate-500">
				<span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
				GATEWAY ONLINE
			</div>
		</div>
	</div>

	<!-- Main Body -->
	<div class="flex-1 p-4 flex flex-col gap-4 overflow-y-auto text-slate-100">
		<!-- Config Row -->
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<div class="flex flex-col gap-1.5">
				<label for="worker" class="text-[10px] font-mono text-slate-500 uppercase">Who should handle this?</label>
				<select
					id="worker"
					bind:value={worker}
					class="bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono p-1.5 rounded focus:outline-none focus:border-blue-500 transition-colors"
				>
					<option value="claude-code">Claude (backend & code)</option>
					<option value="gemini">Gemini (UI & frontend)</option>
				</select>
			</div>

			<div class="flex flex-col gap-1.5">
				<label for="repo" class="text-[10px] font-mono text-slate-500 uppercase">Which project?</label>
				<select
					id="repo"
					bind:value={targetRepo}
					class="bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono p-1.5 rounded focus:outline-none focus:border-blue-500 transition-colors"
				>
					<option value="project-miru">project-miru</option>
					<option value="LogueOS-Console">LogueOS-Console</option>
					<option value="LogueOS-Orchestrator">LogueOS-Orchestrator</option>
				</select>
			</div>

			<div class="flex flex-col gap-1.5">
				<label for="ticket" class="text-[10px] font-mono text-slate-500 uppercase">Ticket ID (Optional)</label>
				<input
					id="ticket"
					type="text"
					bind:value={ticketId}
					placeholder="e.g. LOS-65"
					class="bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono p-1.5 rounded focus:outline-none focus:border-blue-500 placeholder:text-slate-700"
				/>
			</div>
		</div>

		<!-- Advanced Row -->
		<div class="grid grid-cols-1 md:grid-cols-3 gap-4">
			<div class="flex flex-col gap-1.5">
				<label for="thinking" class="text-[10px] font-mono text-slate-500 uppercase">Thinking Level</label>
				<select
					id="thinking"
					bind:value={thinkingLevel}
					class="bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono p-1.5 rounded focus:outline-none focus:border-blue-500 transition-colors"
				>
					<option value="none">Standard</option>
					<option value="extended">Extended Thinking</option>
				</select>
			</div>
		</div>

		<!-- Prompt Area -->
		<div class="flex-1 flex flex-col gap-1.5 min-h-[150px]">
			<label for="prompt" class="text-[10px] font-mono text-slate-500 uppercase">Describe what needs to be done</label>
			<textarea
				id="prompt"
				bind:value={prompt}
				placeholder="What needs to be done?"
				class="flex-1 bg-slate-900 border border-slate-800 text-slate-200 text-xs font-mono p-3 rounded focus:outline-none focus:border-blue-500 placeholder:text-slate-700 resize-none leading-relaxed"
			></textarea>
		</div>

		<!-- Status Bar -->
		{#if status !== 'idle'}
			<div
				class="flex items-center gap-3 px-3 py-2 rounded text-xs font-mono border {
					status === 'submitting' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
					status === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
					'bg-red-500/10 border-red-500/20 text-red-400'
				}"
			>
				{#if status === 'submitting'}
					<Loader2 size={14} class="animate-spin" />
					<span>Sending...</span>
				{:else if status === 'success'}
					<CheckCircle2 size={14} />
					<div class="flex flex-col">
						<span>{message}</span>
						<span class="text-[10px] opacity-70">Ref: {lastTraceId}</span>
					</div>
				{:else if status === 'error'}
					<AlertCircle size={14} />
					<span>{message}</span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Footer / Action -->
	<div class="px-4 py-3 bg-slate-900/50 border-t border-slate-800 flex justify-end">
		<button
			onclick={handleSubmit}
			disabled={status === 'submitting' || !prompt.trim()}
			class="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white text-xs font-mono font-bold px-6 py-2 rounded transition-all active:scale-95 shadow-lg shadow-blue-900/20"
		>
			{#if status === 'submitting'}
				<Loader2 size={14} class="animate-spin" />
				Sending...
			{:else}
				<Send size={14} />
				Send this job
			{/if}
		</button>
	</div>
</div>

<style>
	select {
		appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23475569'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.5rem center;
		background-size: 1rem;
		padding-right: 2rem;
	}
</style>
