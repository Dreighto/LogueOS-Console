<script lang="ts">
    import DispatchCenter from '$lib/components/DispatchCenter.svelte';
    import PageHeader from '$lib/components/PageHeader.svelte';
</script>

<div class="flex flex-col gap-6 h-full max-w-5xl mx-auto py-6 px-4">
    <PageHeader
        title="Jobs"
        subtitle="Describe the work, pick who handles it, and send it off."
    />

    <div class="flex-1 min-h-0">
        <DispatchCenter />
    </div>

    <p class="text-xs text-muted-foreground font-mono text-center">
        Jobs are usually picked up within a few minutes. You'll see progress in Activity.
    </p>
</div>
