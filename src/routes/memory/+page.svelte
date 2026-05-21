<script lang="ts">
	import type { PageProps } from './$types';
	import { Brain, Clock, Globe, ShieldCheck, Microscope, Info, Terminal } from 'lucide-svelte';

	let { data }: PageProps = $props();

	let selectedTag = $state<string | null>(null);
	let activeTab = $state<'canon' | 'drafts' | 'stream'>('canon');
	let expandedIds = $state<Record<string, boolean>>({});

	const filteredLessons = $derived(
		selectedTag
			? data.lessons.filter((l) => l.task_shape?.includes(selectedTag!))
			: data.lessons
	);

	const filteredProvisional = $derived(
		selectedTag
			? data.provisional.filter((l) => l.task_shape_tags?.includes(selectedTag!))
			: data.provisional
	);

	const filteredRaw = $derived(
		selectedTag
			? data.raw.filter((o) => o.task_shape?.includes(selectedTag!))
			: data.raw
	);

	const isEmpty = $derived(
		data.lessons.length === 0 &&
		data.provisional.length === 0 &&
		data.raw.length === 0
	);

	const isFilteredEmpty = $derived(
		selectedTag &&
		filteredLessons.length === 0 &&
		filteredProvisional.length === 0 &&
		filteredRaw.length === 0
	);

	function toggleExpand(id: string) {
		expandedIds[id] = !expandedIds[id];
	}

	function formatDate(iso: string) {
		if (!iso) return 'Unknown';
		try {
			return new Date(iso).toLocaleString();
		} catch {
			return iso;
		}
	}

	function formatRelativeTime(ts: string): string {
		const diffMs = Date.now() - new Date(ts).getTime();
		const diffSec = Math.floor(diffMs / 1000);
		const diffMin = Math.floor(diffSec / 60);
		const diffHr = Math.floor(diffMin / 60);
		const diffDay = Math.floor(diffHr / 24);
		if (diffSec < 60) return 'just now';
		if (diffMin < 60) return `${diffMin}m ago`;
		if (diffHr < 24) return `${diffHr}h ago`;
		if (diffDay === 1) {
			const time = new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
			return `yesterday at ${time}`;
		}
		return `${diffDay} days ago`;
	}

	function mapObservationKind(kind: string): string {
		const map: Record<string, string> = {
			'what-worked': 'What worked',
			'what-didnt-work': "What didn't work",
			'surprise': 'Surprise',
			'routing-correction': 'Routing correction',
			'insight': 'Insight',
			'blocker': 'Blocker'
		};
		return map[kind] ?? kind.replace(/-/g, ' ');
	}

	function getPlainEnglish(text: string, title?: string): string {
		const t = (title || '').toLowerCase();
		const tx = text.toLowerCase();

		if (t.includes('600 seconds') || t.includes('timeout at 600') || tx.includes('600-second')) {
			return "Dispatched tasks are automatically killed after 10 minutes. If a task needs more time, split it into smaller tasks or run it manually.";
		}
		if (t.includes('do interactively') || tx.includes('do it interactively')) {
			return "Simple documentation or markdown updates should be done directly instead of sending them to background workers. This saves time and resources.";
		}
		if (t.includes('clean worktrees') || tx.includes('clean the worktree')) {
			return "Your working directory must be completely clean (no uncommitted edits) before launching a worker, or the pre-flight gate will refuse to run it.";
		}
		if (tx.includes('prettier') && tx.includes('drift')) {
			return "Automatic formatting tools can sometimes shift lines or alignments in configuration or baseline files, causing minor mismatches. Inspect baseline files closely.";
		}
		if (tx.includes('allowedhosts') || tx.includes('allowed hosts')) {
			return "Vite has allowedHosts protection turned on. Accessing it via LAN or Tailscale requires setting server.allowedHosts to true.";
		}
		if (tx.includes('governance gate') || tx.includes('governance change')) {
			return "Editing critical documentation, references, or baseline files triggers a strict governance review that requires an approved sign-off token.";
		}
		if (tx.includes('sycophancy') || tx.includes('sycophantic')) {
			return "Avoid automatic AI agreement. If the operator makes an assertion that contradicts verified files or command output, respectfully present the evidence and object.";
		}
		if (tx.includes('escalation ladder') || tx.includes('escalate')) {
			return "A structured triage flow handles problem resolution: first attempting self-correction, then requesting supervisor assistance, and finally notifying the operator.";
		}

		// Dynamic fallback: extract the first sentence, capped at 120 chars
		const firstSentence = text.split(/[.!?]\s+/)[0] || text;
		return firstSentence.length > 120 ? firstSentence.slice(0, 117) + '...' : firstSentence;
	}
</script>

<svelte:head>
	<title>LogueOS | Memory</title>
</svelte:head>

<div class="flex flex-col gap-5 font-mono text-slate-200">
	<header class="flex items-center justify-between border-b border-slate-800 pb-3">
		<div class="flex items-center gap-2">
			<Brain class="text-blue-400" size={18} />
			<h1 class="text-sm font-bold tracking-widest text-[#F0F6FC] uppercase">Memory</h1>
		</div>
		<div class="text-[10px] text-[#8B949E] uppercase tracking-widest bg-[#161B22] px-2 py-0.5 rounded border border-[#30363D]">
			v2.1.0-PRO
		</div>
	</header>

	{#if selectedTag}
		<div class="flex items-center gap-2 px-3 py-1.5 rounded border border-blue-500/20 bg-blue-500/5 text-xs text-blue-300 font-mono">
			<span>Active Filter: <span class="font-bold text-blue-400">#{selectedTag}</span></span>
			<button
				onclick={() => selectedTag = null}
				class="ml-auto text-[10px] uppercase font-bold tracking-widest text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
			>
				Clear [x]
			</button>
		</div>
	{/if}

	{#if isEmpty}
		<div class="flex flex-col items-center justify-center py-24 text-slate-500 border border-dashed border-slate-800 rounded-lg bg-slate-900/20">
			<Brain size={48} class="mb-4 opacity-10" />
			<h2 class="text-lg font-semibold text-slate-400 mb-1">Amnesia Detected</h2>
			<p class="text-sm italic text-center px-4">The team hasn't logged any lessons yet. Insights appear here as the system learns from completed jobs.</p>
		</div>
	{:else if isFilteredEmpty}
		<div class="flex flex-col items-center justify-center py-16 text-slate-500 border border-dashed border-slate-800 rounded-lg bg-slate-900/10">
			<Brain size={36} class="mb-2 opacity-10 text-blue-400" />
			<h2 class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">No Matches Found</h2>
			<p class="text-[11px] text-center px-4 text-slate-500">
				No lessons or observations match the tag <span class="text-blue-400 font-bold">#{selectedTag}</span>.
			</p>
			<button
				onclick={() => selectedTag = null}
				class="mt-4 px-3 py-1 rounded border border-slate-800 bg-slate-900/50 text-[10px] uppercase font-bold tracking-widest text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors cursor-pointer"
			>
				Clear Filter
			</button>
		</div>
	{:else}
		<!-- Condensed Tabbed Control Surface -->
		<div class="flex border-b border-[#30363D] gap-1 p-0.5 bg-[#161B22]/40 rounded-t-md">
			<button
				onclick={() => activeTab = 'canon'}
				class="flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-all border-b-2 rounded-t-sm {
					activeTab === 'canon'
						? 'border-blue-500 text-blue-400 bg-blue-500/5'
						: 'border-transparent text-slate-500 hover:text-slate-300'
				}"
			>
				Canon ({filteredLessons.length})
			</button>
			<button
				onclick={() => activeTab = 'drafts'}
				class="flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-all border-b-2 rounded-t-sm {
					activeTab === 'drafts'
						? 'border-amber-500 text-amber-400 bg-amber-500/5'
						: 'border-transparent text-slate-500 hover:text-slate-300'
				}"
			>
				Drafts ({filteredProvisional.length})
			</button>
			<button
				onclick={() => activeTab = 'stream'}
				class="flex-1 py-2 text-[10px] font-bold uppercase tracking-wider transition-all border-b-2 rounded-t-sm {
					activeTab === 'stream'
						? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
						: 'border-transparent text-slate-500 hover:text-slate-300'
				}"
			>
				Stream ({filteredRaw.length})
			</button>
		</div>

		<div class="min-h-[250px]">
			<!-- TIER 2: CANON (PROMOTED LESSONS) -->
			{#if activeTab === 'canon'}
				{#if filteredLessons.length > 0}
					<div class="flex flex-col gap-4">
						{#each filteredLessons as lesson (`${lesson.adopted_date}:${lesson.title ?? lesson.text.slice(0, 40)}`)}
							{@const lessonId = `canon-${lesson.adopted_date}-${lesson.title || 'untitled'}`}
							<div class="bg-[#161B22]/30 border border-[#30363D] rounded-lg p-4 transition-all hover:border-[#8B949E]/40">
								<div class="flex items-start justify-between gap-3 mb-3">
									<h3 class="text-xs font-bold text-blue-400 leading-tight flex-1">
										{lesson.title || 'Untitled Lesson'}
									</h3>
									<span class="text-[8px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold uppercase tracking-tighter shrink-0">
										High confidence
									</span>
								</div>

								<!-- Two-Part Summary Layout -->
								<div class="flex flex-col gap-2">
									<!-- Part 1: Plain English Summary -->
									<div class="bg-[#0D1117] border border-blue-500/10 rounded p-3">
										<p class="text-[11px] text-slate-300 leading-relaxed font-sans font-medium">
											{getPlainEnglish(lesson.text, lesson.title)}
										</p>
									</div>

									<!-- Part 2: Expandable Raw Tech Details -->
									<div>
										<button
											onclick={() => toggleExpand(lessonId)}
											class="text-[9px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1.5 focus:outline-none cursor-pointer py-1"
										>
											<Terminal size={10} />
											{#if expandedIds[lessonId]}
												Hide technical details ▴
											{:else}
												View technical details ▾
											{/if}
										</button>

										{#if expandedIds[lessonId]}
											<div class="mt-2 p-3 bg-[#0d1117] rounded border border-[#30363D] font-mono text-[10px] text-slate-400 leading-relaxed whitespace-pre-wrap select-all">
												{lesson.text}
											</div>
										{/if}
									</div>
								</div>

								<div class="flex flex-wrap items-center gap-3 pt-3 mt-3 border-t border-[#30363D]/50">
									<div class="flex items-center gap-1.5 text-[9px] text-slate-500 uppercase">
										<Clock size={10} />
										{formatDate(lesson.adopted_date)}
									</div>
									<div class="flex items-center gap-1.5 text-[9px] text-slate-500 uppercase">
										<Globe size={10} />
										{lesson.applies_to?.join(', ') || 'Universal'}
									</div>
									{#if lesson.task_shape && lesson.task_shape.length > 0}
										<div class="flex flex-wrap gap-1 ml-auto">
											{#each lesson.task_shape as tag, i (`${tag}:${i}`)}
												<button
													onclick={() => selectedTag = selectedTag === tag ? null : tag}
													class="text-[8px] px-1 rounded border uppercase tracking-tighter cursor-pointer transition-colors {
														selectedTag === tag
															? 'bg-blue-500/20 text-blue-300 border-blue-500/40 font-bold'
															: 'bg-[#161B22] text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-slate-200'
													}"
												>
													{tag}
												</button>
											{/each}
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="text-center py-12 text-[10px] text-slate-600 italic border border-dashed border-[#30363D] rounded-lg">
						No promoted lessons match current filter.
					</div>
				{/if}
			{/if}

			<!-- TIER 1: DRAFTS (PROVISIONAL LESSONS) -->
			{#if activeTab === 'drafts'}
				{#if filteredProvisional.length > 0}
					<div class="flex flex-col gap-4">
						{#each filteredProvisional as lesson (lesson.id)}
							{@const lessonId = `provisional-${lesson.id}`}
							<div class="bg-[#161B22]/30 border border-[#30363D] rounded-lg p-4 relative overflow-hidden transition-all hover:border-[#8B949E]/40">
								{#if lesson.proposed_promotion}
									<div class="absolute top-0 right-0">
										<div class="bg-amber-500 text-slate-900 text-[8px] font-bold px-2 py-0.5 uppercase tracking-tighter">
											Promotion Pending
										</div>
									</div>
								{/if}

								<div class="flex items-center gap-3 mb-3 {lesson.proposed_promotion ? 'pr-24' : ''}">
									<div class="text-[9px] text-slate-400 uppercase font-bold bg-[#0d1117] px-2 py-0.5 rounded border border-[#30363D]">
										{lesson.project_id}
									</div>
									<div class="text-[9px] text-slate-500 uppercase tracking-tight truncate">
										Synthesized by {lesson.synthesized_by}
									</div>
								</div>

								<!-- Two-Part Summary Layout -->
								<div class="flex flex-col gap-2">
									<!-- Part 1: Plain English Summary -->
									<div class="bg-[#0D1117] border border-amber-500/10 rounded p-3">
										<p class="text-[11px] text-slate-300 leading-relaxed font-sans font-medium">
											{getPlainEnglish(lesson.lesson_text)}
										</p>
									</div>

									<!-- Part 2: Expandable Raw Tech Details -->
									<div>
										<button
											onclick={() => toggleExpand(lessonId)}
											class="text-[9px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1.5 focus:outline-none cursor-pointer py-1"
										>
											<Terminal size={10} />
											{#if expandedIds[lessonId]}
												Hide technical details ▴
											{:else}
												View technical details ▾
											{/if}
										</button>

										{#if expandedIds[lessonId]}
											<div class="mt-2 p-3 bg-[#0d1117] rounded border border-[#30363D] font-mono text-[10px] text-slate-400 leading-relaxed whitespace-pre-wrap select-all">
												{lesson.lesson_text}
											</div>
										{/if}
									</div>
								</div>

								<div class="flex items-center justify-between mt-3 pt-3 border-t border-[#30363D]/50">
									<div class="flex flex-wrap gap-1">
										{#each lesson.task_shape_tags as tag, i (`${tag}:${i}`)}
											<button
												onclick={() => selectedTag = selectedTag === tag ? null : tag}
												class="text-[8px] px-1.5 py-0.5 rounded uppercase tracking-tighter cursor-pointer transition-colors {
													selectedTag === tag
														? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold'
														: 'bg-[#161B22]/50 text-slate-500 border border-transparent hover:bg-slate-700/50 hover:text-slate-300'
												}"
											>
												{tag}
											</button>
										{/each}
									</div>
									<span class="text-[9px] text-slate-600 uppercase shrink-0 ml-2">
										{formatDate(lesson.created_at)}
									</span>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="text-center py-12 text-[10px] text-slate-600 italic border border-dashed border-[#30363D] rounded-lg">
						No draft lessons match current filter.
					</div>
				{/if}
			{/if}

			<!-- TIER 0: STREAM (RECENT OBSERVATIONS) -->
			{#if activeTab === 'stream'}
				{#if filteredRaw.length > 0}
					<div class="space-y-2">
						{#each filteredRaw as obs (obs.observation_id)}
							{@const lessonId = `stream-${obs.observation_id}`}
							<div class="bg-[#161B22]/30 border border-[#30363D] rounded-lg p-3.5 transition-all hover:border-[#8B949E]/40">
								<div class="flex items-center gap-3 mb-2">
									<span class="text-[9px] font-bold uppercase tracking-wider shrink-0 {
										obs.observation_kind === 'what-didnt-work' ? 'text-red-400' :
										obs.observation_kind === 'what-worked' ? 'text-emerald-400' :
										obs.observation_kind === 'surprise' ? 'text-amber-400' :
										'text-blue-400'
									}">
										{mapObservationKind(obs.observation_kind)}
									</span>
									{#if obs.ticket_id}
										<span class="text-[9px] text-slate-500 font-mono shrink-0">{obs.ticket_id}</span>
									{/if}
									<span class="text-[9px] text-slate-600 ml-auto shrink-0 font-mono">
										{formatRelativeTime(obs.ts)}
									</span>
								</div>

								<!-- Two-Part Summary Layout -->
								<div class="flex flex-col gap-1.5">
									<!-- Part 1: Plain English Summary -->
									<div class="bg-[#0D1117] border border-emerald-500/10 rounded p-2.5">
										<p class="text-[11px] text-slate-300 leading-relaxed font-sans font-medium">
											{getPlainEnglish(obs.text)}
										</p>
									</div>

									<!-- Part 2: Expandable Raw Tech Details -->
									<div>
										<button
											onclick={() => toggleExpand(lessonId)}
											class="text-[8px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1 focus:outline-none cursor-pointer py-0.5"
										>
											<Terminal size={8} />
											{#if expandedIds[lessonId]}
												Hide technical details ▴
											{:else}
												View technical details ▾
											{/if}
										</button>

										{#if expandedIds[lessonId]}
											<div class="mt-2 p-2.5 bg-[#0d1117] rounded border border-[#30363D] font-mono text-[10px] text-slate-400 leading-relaxed whitespace-pre-wrap select-all">
												{obs.text}
											</div>
										{/if}
									</div>
								</div>

								{#if obs.task_shape && obs.task_shape.length > 0}
									<div class="flex flex-wrap gap-1 mt-3.5 pt-2 border-t border-[#30363D]/30">
										{#each obs.task_shape as tag, i (`${tag}:${i}`)}
											<button
												onclick={() => selectedTag = selectedTag === tag ? null : tag}
												class="text-[8px] px-1 border rounded lowercase cursor-pointer transition-colors {
													selectedTag === tag
														? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold'
														: 'text-slate-500 border-[#30363D] hover:border-slate-600 hover:text-slate-400'
												}"
											>
												#{tag}
											</button>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div class="text-center py-12 text-[10px] text-slate-600 italic border border-dashed border-[#30363D] rounded-lg">
						No stream observations match current filter.
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<footer class="mt-6 pt-4 border-t border-slate-800/50 text-center">
		<div class="inline-flex items-center gap-2 text-[9px] text-slate-600 uppercase tracking-[0.2em] bg-slate-900/30 px-4 py-2 rounded-full border border-slate-800/50">
			<Info size={10} />
			Lessons are promoted from drafts after successful cross-repo validation
		</div>
	</footer>
</div>
