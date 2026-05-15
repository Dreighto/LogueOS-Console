<script lang="ts">
	import {
		Activity,
		CircleCheck,
		CircleAlert,
		Database,
		Network,
		Zap,
		Unplug
	} from 'lucide-svelte';

	interface Props {
		name: string;
		status: 'online' | 'offline';
		id: string;
	}

	let { name, status, id }: Props = $props();

	const icons: Record<string, any> = {
		mcp_gateway: Zap,
		pm: Activity,
		miru_ai: Network,
		dispatch_listener: CircleCheck,
		n8n: Database
	};

	const Icon = icons[id] || Activity;

	let colorClass = $derived(status === 'online' ? 'text-status-green' : 'text-status-red');
	let bgClass = $derived(status === 'online' ? 'bg-status-green/10' : 'bg-status-red/10');
	let borderClass = $derived(
		status === 'online' ? 'border-status-green/20' : 'border-status-red/20'
	);
</script>

<div
	class="flex items-center justify-between rounded-full border {borderClass} {bgClass} hover:bg-opacity-20 px-3 py-1.5 transition-all"
>
	<div class="flex items-center gap-2">
		<div class={colorClass}>
			<Icon size={14} />
		</div>
		<span class="font-sans text-xs font-medium text-foreground">{name}</span>
	</div>
	<div class="flex items-center gap-1.5">
		<div
			class="h-1.5 w-1.5 rounded-full {status === 'online'
				? 'bg-status-green shadow-[0_0_4px_#22c55e]'
				: 'bg-status-red'}"
		></div>
		<span class="font-mono text-[10px] tracking-tighter uppercase {colorClass}">
			{status}
		</span>
	</div>
</div>
