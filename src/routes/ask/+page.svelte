<script lang="ts">
    import DispatchCenter from '$lib/components/DispatchCenter.svelte';
</script>

<div class="flex flex-col gap-6 h-full max-w-5xl mx-auto py-6 px-4">
    <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-bold font-sans tracking-tight text-slate-100">Mission Control</h1>
        <p class="text-sm text-slate-500 font-mono">Execute remote worker dispatches across the LogueOS fleet.</p>
    </div>

    <div class="flex-1 min-h-0">
        <DispatchCenter />
    </div>
    
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="p-4 border border-slate-800 bg-slate-900/50 rounded-lg">
            <h3 class="text-[10px] font-mono text-slate-500 uppercase mb-2">Protocol Note</h3>
            <p class="text-xs text-slate-400 leading-relaxed font-sans">
                Every dispatch is logged in the <span class="text-blue-400 font-mono italic">activity feed</span>. 
                Ensure a Linear ticket exists for major tasks to maintain audit traceability.
            </p>
        </div>
        <div class="p-4 border border-slate-800 bg-slate-900/50 rounded-lg">
            <h3 class="text-[10px] font-mono text-slate-500 uppercase mb-2">Hardware Status</h3>
            <p class="text-xs text-slate-400 leading-relaxed font-sans">
                Local machine (Win32) confirmed nominal. System overhead is low; concurrent dispatches (up to 3) are authorized.
            </p>
        </div>
    </div>
</div>
