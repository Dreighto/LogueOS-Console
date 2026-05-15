<script lang="ts">
	import type { ProvisionalLesson, AdoptedLesson, Observation } from '$lib/types/memory';
	import { Brain, Tag, Clock, Globe, ShieldCheck, Microscope } from 'lucide-svelte';

	let { provisional = [], lessons = [], raw = [] }: { provisional: ProvisionalLesson[], lessons: AdoptedLesson[], raw: Observation[] } = $props();

	let activeTab = $state<'provisional' | 'lessons' | 'raw'>('lessons');

	function formatDate(iso: string) {
		return new Date(iso).toLocaleString();
	}
</script>

<div class="flex flex-col gap-4">
	<!-- Tab Switcher -->
	<div class="flex p-1 bg-slate-900/80 rounded-lg border border-slate-800">
		<button
			onclick={() => activeTab = 'lessons'}
			class="flex-1 px-2 py-1.5 text-[10px] font-bold tracking-wider uppercase rounded-md transition-all {activeTab === 'lessons' ? 'bg-blue-500/10 text-blue-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}"
		>
			Canon
		</button>
		<button
			onclick={() => activeTab = 'provisional'}
			class="flex-1 px-2 py-1.5 text-[10px] font-bold tracking-wider uppercase rounded-md transition-all {activeTab === 'provisional' ? 'bg-amber-500/10 text-amber-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}"
		>
			Drafts
		</button>
		<button
			onclick={() => activeTab = 'raw'}
			class="flex-1 px-2 py-1.5 text-[10px] font-bold tracking-wider uppercase rounded-md transition-all {activeTab === 'raw' ? 'bg-emerald-500/10 text-emerald-400 shadow-sm' : 'text-slate-500 hover:text-slate-300'}"
		>
			Raw
		</button>
	</div>

	<div class="space-y-4">
		{#if activeTab === 'provisional'}
			{#each provisional as lesson (lesson.id)}
				<div class="rounded-lg border border-slate-800 bg-slate-900/50 p-4 shadow-sm transition-all hover:bg-slate-900">
					<div class="mb-2 flex items-start justify-between">
						<div class="flex items-center gap-2">
							<div class="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
								<Brain size={16} />
							</div>
							<div>
								<h3 class="text-sm font-semibold text-slate-100 line-clamp-1">{lesson.lesson_text.slice(0, 60)}...</h3>
								<div class="flex items-center gap-3 text-[10px] text-slate-500 uppercase tracking-wider">
									<span class="flex items-center gap-1">
										<Globe size={10} />
										{lesson.project_id}
									</span>
									<span class="flex items-center gap-1">
										<Clock size={10} />
										{formatDate(lesson.created_at)}
									</span>
								</div>
							</div>
						</div>
						{#if lesson.proposed_promotion}
							<span class="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 border border-amber-500/20">
								PROMOTION PENDING
							</span>
						{/if}
					</div>

					<p class="mb-3 text-xs leading-relaxed text-slate-400">
						{lesson.lesson_text}
					</p>

					<div class="flex flex-wrap gap-1.5">
						{#each lesson.task_shape_tags as tag, i (`${tag}:${i}`)}
							<span class="flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[10px] text-slate-300 border border-slate-700/50">
								<Tag size={8} />
								{tag}
							</span>
						{/each}
					</div>
				</div>
			{:else}
				<div class="flex flex-col items-center justify-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-lg">
					<Brain size={32} class="mb-3 opacity-20" />
					<p class="text-sm italic text-center px-4">No provisional lessons awaiting review.</p>
				</div>
			{/each}
		{:else if activeTab === 'raw'}
			{#each raw as obs (obs.observation_id)}
				<div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 shadow-sm transition-all hover:bg-emerald-500/10">
					<div class="mb-2 flex items-start justify-between">
						<div class="flex items-center gap-2">
							<div class="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
								<Microscope size={16} />
							</div>
							<div>
								<h3 class="text-sm font-semibold text-slate-100 line-clamp-1">{obs.text.slice(0, 60)}...</h3>
								<div class="flex items-center gap-3 text-[10px] text-slate-500 uppercase tracking-wider">
									<span class="flex items-center gap-1">
										<Globe size={10} />
										{obs.project_id}
									</span>
									<span class="flex items-center gap-1">
										<Clock size={10} />
										{formatDate(obs.ts)}
									</span>
								</div>
							</div>
						</div>
						<span class="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold tracking-wider text-emerald-400 border border-emerald-500/30 uppercase">
							{obs.observation_kind}
						</span>
					</div>

					<p class="mb-3 text-xs leading-relaxed text-slate-400">
						{obs.text}
					</p>

					<div class="flex flex-wrap gap-1.5">
						{#each obs.task_shape as tag, i (`${tag}:${i}`)}
							<span class="flex items-center gap-1 rounded-md bg-emerald-900/30 px-2 py-1 text-[10px] text-emerald-300 border border-emerald-500/20">
								<Tag size={8} />
								{tag}
							</span>
						{/each}
					</div>
				</div>
			{:else}
				<div class="flex flex-col items-center justify-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-lg">
					<Microscope size={32} class="mb-3 opacity-20" />
					<p class="text-sm italic text-center px-4">No raw observations captured yet.</p>
				</div>
			{/each}
		{:else}
			{#each lessons as lesson (`${lesson.adopted_date}:${lesson.title ?? lesson.text.slice(0, 40)}`)}
				<div class="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4 shadow-sm transition-all hover:bg-blue-500/10">
					<div class="mb-2 flex items-start justify-between">
						<div class="flex items-center gap-2">
							<div class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-blue-400">
								<ShieldCheck size={16} />
							</div>
							<div>
								<h3 class="text-sm font-semibold text-slate-100 line-clamp-1">{lesson.title || lesson.text.slice(0, 60)}</h3>
								<div class="flex items-center gap-3 text-[10px] text-slate-500 uppercase tracking-wider">
									<span class="flex items-center gap-1">
										<Clock size={10} />
										Adopted {lesson.adopted_date}
									</span>
								</div>
							</div>
						</div>
						<span class="rounded bg-blue-500/20 px-2 py-0.5 text-[10px] font-bold tracking-wider text-blue-400 border border-blue-500/30 uppercase">
							{lesson.severity}
						</span>
					</div>

					<p class="mb-3 text-xs leading-relaxed text-slate-300">
						{lesson.text}
					</p>

					<div class="flex flex-wrap gap-1.5">
						{#each lesson.applies_to as scope, i (`${scope}:${i}`)}
							<span class="flex items-center gap-1 rounded-md bg-blue-900/30 px-2 py-1 text-[10px] text-blue-300 border border-blue-500/20">
								<Globe size={8} />
								{scope === '*' ? 'Universal' : scope}
							</span>
						{/each}
						{#if lesson.task_shape}
							{#each lesson.task_shape as tag, i (`${tag}:${i}`)}
								<span class="flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[10px] text-slate-400 border border-slate-700/50">
									<Tag size={8} />
									{tag}
								</span>
							{/each}
						{/if}
					</div>
				</div>
			{:else}
				<div class="flex flex-col items-center justify-center py-12 text-slate-500 border border-dashed border-slate-800 rounded-lg">
					<ShieldCheck size={32} class="mb-3 opacity-20" />
					<p class="text-sm italic text-center px-4">No adopted lessons in the canon yet.</p>
				</div>
			{/each}
		{/if}
	</div>
</div>
