<script lang="ts">
	import type { PageProps } from './$types';
	import { Brain, Tag, Clock, Globe, ShieldCheck, Microscope, Info } from 'lucide-svelte';

	let { data }: PageProps = $props();

	function formatDate(iso: string) {
		if (!iso) return 'Unknown';
		try {
			return new Date(iso).toLocaleString();
		} catch {
			return iso;
		}
	}

	const isEmpty = $derived(
		data.lessons.length === 0 && 
		data.provisional.length === 0 && 
		data.raw.length === 0
	);
</script>

<svelte:head>
	<title>LogueOS | Memory</title>
</svelte:head>

<div class="p-6 max-w-6xl mx-auto font-mono">
	<header class="mb-8 flex items-center justify-between border-b border-slate-800 pb-4">
		<div class="flex items-center gap-3">
			<Brain class="text-blue-400" size={24} />
			<h1 class="text-xl font-bold tracking-tight text-slate-100 uppercase">Team Memory</h1>
		</div>
		<div class="text-[10px] text-slate-500 uppercase tracking-widest bg-slate-900 px-3 py-1 rounded border border-slate-800">
			v2.0.0-PRO-CORE
		</div>
	</header>

	{#if isEmpty}
		<div class="flex flex-col items-center justify-center py-24 text-slate-500 border border-dashed border-slate-800 rounded-lg bg-slate-900/20">
			<Brain size={48} class="mb-4 opacity-10" />
			<h2 class="text-lg font-semibold text-slate-400 mb-1">Amnesia Detected</h2>
			<p class="text-sm italic text-center px-4">No records found in the team memory database.</p>
		</div>
	{:else}
		<div class="space-y-12">
			<!-- PROMOTED LESSONS (TIER 2) -->
			{#if data.lessons.length > 0}
				<section>
					<div class="flex items-center gap-2 mb-6 border-l-2 border-blue-500 pl-3">
						<ShieldCheck class="text-blue-400" size={18} />
						<h2 class="text-sm font-bold text-slate-300 uppercase tracking-widest">Promoted Lessons</h2>
						<span class="text-[10px] text-slate-500 ml-auto">Tier 2: Canon</span>
					</div>
					
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
						{#each data.lessons as lesson}
							<div class="bg-blue-500/5 border border-blue-500/20 rounded-lg p-5 transition-all hover:bg-blue-500/10 hover:border-blue-500/40">
								<div class="flex items-start justify-between mb-3">
									<h3 class="text-sm font-bold text-blue-400 leading-tight">
										{lesson.title || 'Untitled Lesson'}
									</h3>
									<span class="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30 font-bold uppercase tracking-tighter">
										HARD-RULE
									</span>
								</div>
								
								<p class="text-xs text-slate-300 mb-4 leading-relaxed whitespace-pre-wrap">
									{lesson.text}
								</p>

								<div class="flex flex-wrap items-center gap-3 pt-3 border-t border-blue-500/10">
									<div class="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase">
										<Clock size={12} />
										{formatDate(lesson.adopted_date)}
									</div>
									<div class="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase">
										<Globe size={12} />
										{lesson.applies_to?.join(', ') || 'Universal'}
									</div>
									{#if lesson.task_shape && lesson.task_shape.length > 0}
										<div class="flex flex-wrap gap-1 ml-auto">
											{#each lesson.task_shape as tag}
												<span class="text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700 uppercase tracking-tighter">
													{tag}
												</span>
											{/each}
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<!-- RECENT OBSERVATIONS (TIER 0) -->
			{#if data.raw.length > 0}
				<section>
					<div class="flex items-center gap-2 mb-4 border-l-2 border-emerald-500 pl-3">
						<Microscope class="text-emerald-400" size={18} />
						<h2 class="text-sm font-bold text-slate-300 uppercase tracking-widest">Recent Observations</h2>
						<span class="text-[10px] text-slate-500 ml-auto">Tier 0: Stream</span>
					</div>

					<div class="space-y-2">
						{#each data.raw as obs}
							<div class="bg-slate-900/40 border border-slate-800 rounded p-3 flex gap-4 items-start transition-all hover:bg-slate-900/80 group">
								<div class="flex flex-col items-center gap-1 mt-1 shrink-0">
									<div class="w-2 h-2 rounded-full {
										obs.observation_kind === 'what-didnt-work' ? 'bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.5)]' : 
										obs.observation_kind === 'what-worked' ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]' : 
										obs.observation_kind === 'surprise' ? 'bg-amber-500 shadow-[0_0_5px_rgba(245,158,11,0.5)]' : 
										'bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.5)]'
									}"></div>
									<div class="w-px flex-1 bg-slate-800"></div>
								</div>

								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-3 mb-1">
										<span class="text-[10px] font-bold uppercase tracking-wider {
											obs.observation_kind === 'what-didnt-work' ? 'text-red-400' : 
											obs.observation_kind === 'what-worked' ? 'text-emerald-400' : 
											obs.observation_kind === 'surprise' ? 'text-amber-400' : 
											'text-blue-400'
										}">
											{obs.observation_kind.replace(/-/g, ' ')}
										</span>
										<span class="text-[10px] text-slate-600 font-medium">/</span>
										<span class="text-[10px] text-slate-500 uppercase tracking-tighter">
											{obs.project_id}
										</span>
										<span class="text-[10px] text-slate-600 font-medium ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
											{formatDate(obs.ts)}
										</span>
									</div>
									<p class="text-xs text-slate-400 leading-relaxed">
										{obs.text}
									</p>
									{#if obs.task_shape && obs.task_shape.length > 0}
										<div class="flex flex-wrap gap-1 mt-2">
											{#each obs.task_shape as tag}
												<span class="text-[8px] text-slate-600 px-1 border border-slate-800 rounded lowercase">
													#{tag}
												</span>
											{/each}
										</div>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<!-- PROVISIONAL LESSONS (TIER 1) -->
			{#if data.provisional.length > 0}
				<section>
					<div class="flex items-center gap-2 mb-4 border-l-2 border-amber-500 pl-3">
						<Brain class="text-amber-400" size={18} />
						<h2 class="text-sm font-bold text-slate-300 uppercase tracking-widest">Provisional Lessons</h2>
						<span class="text-[10px] text-slate-500 ml-auto">Tier 1: Drafts</span>
					</div>

					<div class="space-y-3">
						{#each data.provisional as lesson}
							<div class="bg-amber-500/5 border border-amber-500/10 rounded p-4 relative overflow-hidden group transition-all hover:bg-amber-500/10 hover:border-amber-500/20">
								{#if lesson.proposed_promotion}
									<div class="absolute top-0 right-0">
										<div class="bg-amber-500 text-slate-900 text-[8px] font-bold px-2 py-0.5 uppercase tracking-tighter transform rotate-0">
											Promotion Pending
										</div>
									</div>
								{/if}
								
								<div class="flex items-center gap-3 mb-2">
									<div class="text-[10px] text-slate-500 uppercase font-bold bg-slate-900/50 px-2 py-0.5 rounded border border-slate-800">
										{lesson.project_id}
									</div>
									<div class="text-[10px] text-slate-600 uppercase tracking-tight">
										Synthesized by {lesson.synthesized_by}
									</div>
								</div>

								<p class="text-xs text-slate-400 leading-relaxed mb-3">
									{lesson.lesson_text}
								</p>

								<div class="flex items-center justify-between">
									<div class="flex gap-1">
										{#each lesson.task_shape_tags as tag}
											<span class="text-[9px] bg-slate-800/50 text-slate-500 px-1.5 py-0.5 rounded uppercase tracking-tighter">
												{tag}
											</span>
										{/each}
									</div>
									<span class="text-[9px] text-slate-600 uppercase">
										{formatDate(lesson.created_at)}
									</span>
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	{/if}

	<footer class="mt-16 pt-8 border-t border-slate-800/50 text-center">
		<div class="inline-flex items-center gap-2 text-[10px] text-slate-600 uppercase tracking-[0.2em] bg-slate-900/30 px-4 py-2 rounded-full border border-slate-800/50">
			<Info size={12} />
			Lessons are promoted from drafts after successful cross-repo validation
		</div>
	</footer>
</div>

<style>
	:global(body) {
		background-color: #020617; /* slate-950 */
		color: #f8fafc; /* slate-50 */
	}
</style>
