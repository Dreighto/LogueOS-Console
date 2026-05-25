<script lang="ts">
	import type { ProvisionalLesson, AdoptedLesson, Observation } from '$lib/types/memory';
	import { Brain, Tag, Clock, Globe, ShieldCheck, Microscope, Check, Edit, X } from 'lucide-svelte';
	import { slide } from 'svelte/transition';
	import { flip } from 'svelte/animate';

	let { provisional = [], lessons = [], raw = [] }: { provisional: ProvisionalLesson[], lessons: AdoptedLesson[], raw: Observation[] } = $props();

	let activeTab = $state<'provisional' | 'lessons' | 'raw'>('lessons');

	function formatDate(iso: string) {
		return new Date(iso).toLocaleString();
	}
</script>

<div class="flex flex-col gap-4">
	<!-- Tab Switcher -->
	<div class="flex p-1 bg-background/80 rounded-lg border border-border">
		<button
			onclick={() => activeTab = 'lessons'}
			class="active-trigger flex-1 px-2 py-1.5 text-xs font-bold tracking-wider uppercase rounded-md transition-all {activeTab === 'lessons' ? 'bg-status-blue/10 text-status-blue shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
		>
			Canon
		</button>
		<button
			onclick={() => activeTab = 'provisional'}
			class="active-trigger flex-1 px-2 py-1.5 text-xs font-bold tracking-wider uppercase rounded-md transition-all {activeTab === 'provisional' ? 'bg-status-amber/10 text-status-amber shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
		>
			Drafts
		</button>
		<button
			onclick={() => activeTab = 'raw'}
			class="active-trigger flex-1 px-2 py-1.5 text-xs font-bold tracking-wider uppercase rounded-md transition-all {activeTab === 'raw' ? 'bg-status-green/10 text-status-green shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
		>
			Raw
		</button>
	</div>

	<div class="space-y-4">
		{#if activeTab === 'provisional'}
			{#each provisional as lesson (lesson.id)}
				<div animate:flip={{ duration: 300 }} in:slide={{ duration: 300 }} class="rounded-lg border border-border bg-background/50 p-4 shadow-sm transition-all hover:bg-background">
					<div class="mb-2 flex items-start justify-between">
						<div class="flex items-center gap-2">
							<div class="flex h-8 w-8 items-center justify-center rounded-full bg-status-amber/10 text-status-amber">
								<Brain size={16} />
							</div>
							<div>
								<h3 class="text-sm font-semibold text-foreground line-clamp-1">{lesson.lesson_text.slice(0, 60)}...</h3>
								<div class="flex items-center gap-3 text-xs text-muted-foreground uppercase tracking-wider">
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
							<span class="rounded bg-status-amber/10 px-2 py-0.5 text-xs font-medium text-status-amber border border-status-amber/20">
								PROMOTION PENDING
							</span>
						{/if}
					</div>

					<!-- Two-Part Summary Layout -->
					<div class="flex flex-col gap-2">
						<!-- Part 1: Plain English Summary -->
						<div class="bg-background border border-status-amber/10 rounded p-3">
							<p class="text-xs text-foreground leading-relaxed font-sans font-medium">
								{lesson.plain_english_summary || lesson.lesson_text.split(/[.!?]\s+/)[0] || lesson.lesson_text}
							</p>
						</div>

						<!-- Part 2: Expandable Raw Tech Details -->
						<details class="group">
							<summary class="text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 focus:outline-none cursor-pointer py-1 list-none">
								View technical details ▾
							</summary>
							<div class="mt-2 p-3 bg-background rounded border border-border font-mono text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap select-all">
								{lesson.lesson_text}
							</div>
						</details>
					</div>

					<div class="flex flex-wrap gap-1.5">
						{#each lesson.task_shape_tags as tag, i (`${tag}:${i}`)}
							<span class="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-foreground border border-border/50">
								<Tag size={8} />
								{tag}
							</span>
						{/each}
					</div>

					<!-- Triage Controls -->
					<div class="mt-3 flex items-center justify-end gap-2 border-t border-border/50 pt-3">
						<button class="active-trigger flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground">
							<Edit size={10} />
							Edit
						</button>
						<button class="active-trigger flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-status-red transition-colors hover:bg-status-red/10">
							<X size={10} />
							Reject
						</button>
						<button class="active-trigger flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-status-green transition-colors hover:bg-status-green/10">
							<Check size={10} />
							Promote
						</button>
					</div>
				</div>
			{:else}
				<div class="flex flex-col items-center justify-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
					<Brain size={32} class="mb-3 opacity-20" />
					<p class="text-sm italic text-center px-4">No provisional lessons awaiting review.</p>
				</div>
			{/each}
		{:else if activeTab === 'raw'}
			{#each raw as obs (obs.observation_id)}
				<div animate:flip={{ duration: 300 }} in:slide={{ duration: 300 }} class="rounded-lg border border-status-green/20 bg-status-green/5 p-4 shadow-sm transition-all hover:bg-status-green/10">
					<div class="mb-2 flex items-start justify-between">
						<div class="flex items-center gap-2">
							<div class="flex h-8 w-8 items-center justify-center rounded-full bg-status-green/20 text-status-green">
								<Microscope size={16} />
							</div>
							<div>
								<h3 class="text-sm font-semibold text-foreground line-clamp-1">{obs.text.slice(0, 60)}...</h3>
								<div class="flex items-center gap-3 text-xs text-muted-foreground uppercase tracking-wider">
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
						<span class="rounded bg-status-green/20 px-2 py-0.5 text-xs font-bold tracking-wider text-status-green border border-status-green/30 uppercase">
							{obs.observation_kind}
						</span>
					</div>

					<!-- Two-Part Summary Layout -->
					<div class="flex flex-col gap-1.5">
						<!-- Part 1: Plain English Summary -->
						<div class="bg-background border border-status-green/10 rounded p-2.5">
							<p class="text-xs text-foreground leading-relaxed font-sans font-medium">
								{obs.plain_english_summary || obs.text.split(/[.!?]\s+/)[0] || obs.text}
							</p>
						</div>

						<!-- Part 2: Expandable Raw Tech Details -->
						<details class="group">
							<summary class="text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 focus:outline-none cursor-pointer py-0.5 list-none">
								View technical details ▾
							</summary>
							<div class="mt-2 p-2.5 bg-background rounded border border-border font-mono text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap select-all">
								{obs.text}
							</div>
						</details>
					</div>

					<div class="flex flex-wrap gap-1.5">
						{#each obs.task_shape as tag, i (`${tag}:${i}`)}
							<span class="flex items-center gap-1 rounded-md bg-status-green/30 px-2 py-1 text-xs text-status-green border border-status-green/20">
								<Tag size={8} />
								{tag}
							</span>
						{/each}
					</div>
				</div>
			{:else}
				<div class="flex flex-col items-center justify-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
					<Microscope size={32} class="mb-3 opacity-20" />
					<p class="text-sm italic text-center px-4">No raw observations captured yet.</p>
				</div>
			{/each}
		{:else}
			{#each lessons as lesson (`${lesson.adopted_date}:${lesson.title ?? lesson.text.slice(0, 40)}`)}
				<div animate:flip={{ duration: 300 }} in:slide={{ duration: 300 }} class="rounded-lg border border-status-blue/20 bg-status-blue/5 p-4 shadow-sm transition-all hover:bg-status-blue/10">
					<div class="mb-2 flex items-start justify-between">
						<div class="flex items-center gap-2">
							<div class="flex h-8 w-8 items-center justify-center rounded-full bg-status-blue/20 text-status-blue">
								<ShieldCheck size={16} />
							</div>
							<div>
								<h3 class="text-sm font-semibold text-foreground line-clamp-1">{lesson.title || lesson.text.slice(0, 60)}</h3>
								<div class="flex items-center gap-3 text-xs text-muted-foreground uppercase tracking-wider">
									<span class="flex items-center gap-1">
										<Clock size={10} />
										Adopted {lesson.adopted_date}
									</span>
								</div>
							</div>
						</div>
						<span class="rounded bg-status-blue/20 px-2 py-0.5 text-xs font-bold tracking-wider text-status-blue border border-status-blue/30 uppercase">
							{lesson.severity}
						</span>
					</div>

					<!-- Two-Part Summary Layout -->
					<div class="flex flex-col gap-2">
						<!-- Part 1: Plain English Summary -->
						<div class="bg-background border border-status-blue/10 rounded p-3">
							<p class="text-xs text-foreground leading-relaxed font-sans font-medium">
								{lesson.plain_english_summary || lesson.text.split(/[.!?]\s+/)[0] || lesson.text}
							</p>
						</div>

						<!-- Part 2: Expandable Raw Tech Details -->
						<details class="group">
							<summary class="text-[11px] font-bold uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 focus:outline-none cursor-pointer py-1 list-none">
								View technical details ▾
							</summary>
							<div class="mt-2 p-3 bg-background rounded border border-border font-mono text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap select-all">
								{lesson.text}
							</div>
						</details>
					</div>

					<div class="flex flex-wrap gap-1.5">
						{#each lesson.applies_to as scope, i (`${scope}:${i}`)}
							<span class="flex items-center gap-1 rounded-md bg-status-blue/30 px-2 py-1 text-xs text-status-blue border border-status-blue/20">
								<Globe size={8} />
								{scope === '*' ? 'Universal' : scope}
							</span>
						{/each}
						{#if lesson.task_shape}
							{#each lesson.task_shape as tag, i (`${tag}:${i}`)}
								<span class="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground border border-border/50">
									<Tag size={8} />
									{tag}
								</span>
							{/each}
						{/if}
					</div>
				</div>
			{:else}
				<div class="flex flex-col items-center justify-center py-12 text-muted-foreground border border-dashed border-border rounded-lg">
					<ShieldCheck size={32} class="mb-3 opacity-20" />
					<p class="text-sm italic text-center px-4">No adopted lessons in the canon yet.</p>
				</div>
			{/each}
		{/if}
	</div>
</div>
