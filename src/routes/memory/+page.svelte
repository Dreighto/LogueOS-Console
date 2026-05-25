<script lang="ts">
	import type { PageProps } from './$types';
	import { Brain, Clock, Globe, ShieldCheck, Microscope, Info, Terminal } from 'lucide-svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';

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

<div class="flex flex-col gap-5 font-mono text-foreground">
	<PageHeader
		title="Memory"
		subtitle="What the team has learned from past work."
	/>

	{#if selectedTag}
		<div class="flex items-center gap-2 px-3 py-1.5 rounded border border-status-blue/20 bg-status-blue/5 text-xs text-status-blue font-mono">
			<span>Active Filter: <span class="font-bold text-status-blue">#{selectedTag}</span></span>
			<button
				onclick={() => selectedTag = null}
				class="ml-auto text-xs uppercase font-bold tracking-widest text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
			>
				Clear [x]
			</button>
		</div>
	{/if}

	{#if isEmpty}
		<div class="flex flex-col items-center justify-center py-24 text-muted-foreground border border-dashed border-border rounded-lg bg-background/20">
			<Brain size={48} class="mb-4 opacity-10" />
			<h2 class="text-lg font-semibold text-muted-foreground mb-1">Amnesia Detected</h2>
			<p class="text-sm italic text-center px-4">The team hasn't logged any lessons yet. Insights appear here as the system learns from completed jobs.</p>
		</div>
	{:else if isFilteredEmpty}
		<div class="flex flex-col items-center justify-center py-16 text-muted-foreground border border-dashed border-border rounded-lg bg-background/10">
			<Brain size={36} class="mb-2 opacity-10 text-status-blue" />
			<h2 class="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">No Matches Found</h2>
			<p class="text-xs text-center px-4 text-muted-foreground">
				No lessons or observations match the tag <span class="text-status-blue font-bold">#{selectedTag}</span>.
			</p>
			<button
				onclick={() => selectedTag = null}
				class="mt-4 px-3 py-1 rounded border border-border bg-background/50 text-xs uppercase font-bold tracking-widest text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
			>
				Clear Filter
			</button>
		</div>
	{:else}
		<!-- Condensed Tabbed Control Surface -->
		<div class="flex border-b border-border gap-1 p-0.5 bg-surface/40 rounded-t-md">
			<button
				onclick={() => activeTab = 'canon'}
				class="flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 rounded-t-sm {
					activeTab === 'canon'
						? 'border-status-blue text-status-blue bg-status-blue/5'
						: 'border-transparent text-muted-foreground hover:text-foreground'
				}"
			>
				Canon ({filteredLessons.length})
			</button>
			<button
				onclick={() => activeTab = 'drafts'}
				class="flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 rounded-t-sm {
					activeTab === 'drafts'
						? 'border-status-amber text-status-amber bg-status-amber/5'
						: 'border-transparent text-muted-foreground hover:text-foreground'
				}"
			>
				Drafts ({filteredProvisional.length})
			</button>
			<button
				onclick={() => activeTab = 'stream'}
				class="flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-all border-b-2 rounded-t-sm {
					activeTab === 'stream'
						? 'border-status-green text-status-green bg-status-green/5'
						: 'border-transparent text-muted-foreground hover:text-foreground'
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
							<div class="bg-surface/30 border border-border rounded-lg p-4 transition-all hover:border-muted-foreground/40">
								<div class="flex items-start justify-between gap-3 mb-3">
									<h3 class="text-xs font-bold text-status-blue leading-tight flex-1">
										{lesson.title || 'Untitled Lesson'}
									</h3>
									<span class="text-[11px] px-1.5 py-0.5 rounded bg-status-blue/20 text-status-blue border border-status-blue/30 font-bold uppercase tracking-tighter shrink-0">
										High confidence
									</span>
								</div>

								<!-- Two-Part Summary Layout -->
								<div class="flex flex-col gap-2">
									<!-- Part 1: Plain English Summary -->
									<div class="bg-background border border-status-blue/10 rounded p-3">
										<p class="text-xs text-foreground leading-relaxed font-sans font-medium">
											{lesson.plain_english_summary || getPlainEnglish(lesson.text, lesson.title)}
										</p>
									</div>

									<!-- Part 2: Expandable Raw Tech Details -->
									<div>
										<button
											onclick={() => toggleExpand(lessonId)}
											class="text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 focus:outline-none cursor-pointer py-1"
										>
											<Terminal size={10} />
											{#if expandedIds[lessonId]}
												Hide technical details ▴
											{:else}
												View technical details ▾
											{/if}
										</button>

										{#if expandedIds[lessonId]}
											<div class="mt-2 p-3 bg-background rounded border border-border font-mono text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap select-all">
												{lesson.text}
											</div>
										{/if}
									</div>
								</div>

								<div class="flex flex-wrap items-center gap-3 pt-3 mt-3 border-t border-border/50">
									<div class="flex items-center gap-1.5 text-xs text-muted-foreground uppercase">
										<Clock size={10} />
										{formatDate(lesson.adopted_date)}
									</div>
									<div class="flex items-center gap-1.5 text-xs text-muted-foreground uppercase">
										<Globe size={10} />
										{lesson.applies_to?.join(', ') || 'Universal'}
									</div>
									{#if lesson.task_shape && lesson.task_shape.length > 0}
										<div class="flex flex-wrap gap-1 ml-auto">
											{#each lesson.task_shape as tag, i (`${tag}:${i}`)}
												<button
													onclick={() => selectedTag = selectedTag === tag ? null : tag}
													class="text-[11px] px-1 rounded border uppercase tracking-tighter cursor-pointer transition-colors {
														selectedTag === tag
															? 'bg-status-blue/20 text-status-blue border-status-blue/40 font-bold'
															: 'bg-surface text-muted-foreground border-border hover:bg-muted hover:text-foreground'
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
					<div class="text-center py-12 text-xs text-muted-foreground italic border border-dashed border-border rounded-lg">
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
							<div class="bg-surface/30 border border-border rounded-lg p-4 relative overflow-hidden transition-all hover:border-muted-foreground/40">
								{#if lesson.proposed_promotion}
									<div class="absolute top-0 right-0">
										<div class="bg-status-amber text-background text-[11px] font-bold px-2 py-0.5 uppercase tracking-tighter">
											Promotion Pending
										</div>
									</div>
								{/if}

								<div class="flex items-center gap-3 mb-3 {lesson.proposed_promotion ? 'pr-24' : ''}">
									<div class="text-xs text-muted-foreground uppercase font-bold bg-background px-2 py-0.5 rounded border border-border">
										{lesson.project_id}
									</div>
									<div class="text-xs text-muted-foreground uppercase tracking-tight truncate">
										Synthesized by {lesson.synthesized_by}
									</div>
								</div>

								<!-- Two-Part Summary Layout -->
								<div class="flex flex-col gap-2">
									<!-- Part 1: Plain English Summary -->
									<div class="bg-background border border-status-amber/10 rounded p-3">
										<p class="text-xs text-foreground leading-relaxed font-sans font-medium">
											{lesson.plain_english_summary || getPlainEnglish(lesson.lesson_text)}
										</p>
									</div>

									<!-- Part 2: Expandable Raw Tech Details -->
									<div>
										<button
											onclick={() => toggleExpand(lessonId)}
											class="text-xs font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 focus:outline-none cursor-pointer py-1"
										>
											<Terminal size={10} />
											{#if expandedIds[lessonId]}
												Hide technical details ▴
											{:else}
												View technical details ▾
											{/if}
										</button>

										{#if expandedIds[lessonId]}
											<div class="mt-2 p-3 bg-background rounded border border-border font-mono text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap select-all">
												{lesson.lesson_text}
											</div>
										{/if}
									</div>
								</div>

								<div class="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
									<div class="flex flex-wrap gap-1">
										{#each lesson.task_shape_tags as tag, i (`${tag}:${i}`)}
											<button
												onclick={() => selectedTag = selectedTag === tag ? null : tag}
												class="text-[11px] px-1.5 py-0.5 rounded uppercase tracking-tighter cursor-pointer transition-colors {
													selectedTag === tag
														? 'bg-status-amber/20 text-status-amber border border-status-amber/40 font-bold'
														: 'bg-surface/50 text-muted-foreground border border-transparent hover:bg-muted/50 hover:text-foreground'
												}"
											>
												{tag}
											</button>
										{/each}
									</div>
									<span class="text-xs text-muted-foreground uppercase shrink-0 ml-2">
										{formatDate(lesson.created_at)}
									</span>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="text-center py-12 text-xs text-muted-foreground italic border border-dashed border-border rounded-lg">
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
							<div class="bg-surface/30 border border-border rounded-lg p-3.5 transition-all hover:border-muted-foreground/40">
								<div class="flex items-center gap-3 mb-2">
									<span class="text-xs font-bold uppercase tracking-wider shrink-0 {
										obs.observation_kind === 'what-didnt-work' ? 'text-status-red' :
										obs.observation_kind === 'what-worked' ? 'text-status-green' :
										obs.observation_kind === 'surprise' ? 'text-status-amber' :
										'text-status-blue'
									}">
										{mapObservationKind(obs.observation_kind)}
									</span>
									{#if obs.ticket_id}
										<span class="text-xs text-muted-foreground font-mono shrink-0">{obs.ticket_id}</span>
									{/if}
									<span class="text-xs text-muted-foreground ml-auto shrink-0 font-mono">
										{formatRelativeTime(obs.ts)}
									</span>
								</div>

								<!-- Two-Part Summary Layout -->
								<div class="flex flex-col gap-1.5">
									<!-- Part 1: Plain English Summary -->
									<div class="bg-background border border-status-green/10 rounded p-2.5">
										<p class="text-xs text-foreground leading-relaxed font-sans font-medium">
											{obs.plain_english_summary || getPlainEnglish(obs.text)}
										</p>
									</div>

									<!-- Part 2: Expandable Raw Tech Details -->
									<div>
										<button
											onclick={() => toggleExpand(lessonId)}
											class="text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 focus:outline-none cursor-pointer py-0.5"
										>
											<Terminal size={8} />
											{#if expandedIds[lessonId]}
												Hide technical details ▴
											{:else}
												View technical details ▾
											{/if}
										</button>

										{#if expandedIds[lessonId]}
											<div class="mt-2 p-2.5 bg-background rounded border border-border font-mono text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap select-all">
												{obs.text}
											</div>
										{/if}
									</div>
								</div>

								{#if obs.task_shape && obs.task_shape.length > 0}
									<div class="flex flex-wrap gap-1 mt-3.5 pt-2 border-t border-border/30">
										{#each obs.task_shape as tag, i (`${tag}:${i}`)}
											<button
												onclick={() => selectedTag = selectedTag === tag ? null : tag}
												class="text-[11px] px-1 border rounded lowercase cursor-pointer transition-colors {
													selectedTag === tag
														? 'bg-status-green/20 text-status-green border-status-green/40 font-bold'
														: 'text-muted-foreground border-border hover:border-border hover:text-muted-foreground'
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
					<div class="text-center py-12 text-xs text-muted-foreground italic border border-dashed border-border rounded-lg">
						No stream observations match current filter.
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	<footer class="mt-6 pt-4 border-t border-border/50 text-center">
		<div class="inline-flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-[0.2em] bg-background/30 px-4 py-2 rounded-full border border-border/50">
			<Info size={10} />
			Lessons are promoted from drafts after successful cross-repo validation
		</div>
	</footer>
</div>
