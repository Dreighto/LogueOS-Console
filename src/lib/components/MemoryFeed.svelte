<script lang="ts">
	import type { ProvisionalLesson } from '$lib/types/memory';
	import { Brain, Tag, Clock, Globe } from 'lucide-svelte';

	let { lessons = [] }: { lessons: ProvisionalLesson[] } = $props();

	function formatDate(iso: string) {
		return new Date(iso).toLocaleString();
	}
</script>

<div class="space-y-4">
	{#each lessons as lesson}
		<div class="rounded-lg border border-slate-800 bg-slate-900/50 p-4 shadow-sm transition-all hover:bg-slate-900">
			<div class="mb-2 flex items-start justify-between">
				<div class="flex items-center gap-2">
					<div class="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10 text-blue-400">
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
				{#each lesson.task_shape_tags as tag}
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
			<p class="text-sm italic">No lessons in the notebook yet.</p>
		</div>
	{/each}
</div>
