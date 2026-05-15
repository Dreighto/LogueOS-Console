import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';
import type { ActivityEvent, ActivityEventType } from '$lib/types/activity';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const INTERESTING_EVENTS = new Set<string>([
    'worker_spawned',
    'worker_exit',
    'worktree_cleanup_stashed',
    'dispatch_rejected',
    'hmac_reject',
    'listener_listening',
    'listener_restarted',
    'hermes_predict_failed',
    'no_worktree_available',
    'worktree_cleanup_pull_failed',
    'memory_injected',
    'duplicate_prompt_in_flight',
    'worktree_auto_clean_failed'
]);

interface RawLogEvent {
    msg: string;
    ts: string;
    trace_id?: string;
    ticket_id?: string;
    worker?: string;
    status?: string;
    duration_ms?: number;
    reason?: string;
    error?: string;
    stderr?: string;
}

function deriveFriendlyWorker(event: RawLogEvent): string {
    const workerRaw = event.worker || (event.trace_id?.startsWith('cc-') ? 'claude-code' : 'gemini');
    return workerRaw === 'claude-code' ? 'Claude' : workerRaw === 'gemini' ? 'Gemini' : workerRaw;
}

function formatDuration(ms: number | undefined): string {
    if (ms === undefined) return '';
    const seconds = Math.floor(ms / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function deriveSummary(event: RawLogEvent): string {
    const worker = deriveFriendlyWorker(event);
    
    let ticket = event.ticket_id;
    if (!ticket && event.trace_id) {
        const match = event.trace_id.match(/^(?:rtr|cc)-([A-Za-z0-9]+-\d+)/i);
        if (match) {
            ticket = match[1];
        }
    }
    
    const taskLabel = ticket && ticket !== 'unknown' ? `ticket ${ticket}` : 'a task';

    switch (event.msg as ActivityEventType | string) {
        case 'worker_spawned':
            return `${worker} started working on ${taskLabel}`;
        case 'worker_exit': {
            const duration = formatDuration(event.duration_ms);
            const timeInfo = duration ? ` in ${duration}` : '';
            const status = event.status || 'unknown';
            
            if (status === 'CONFIRMED_WORKING') {
                return `${worker} finished ${taskLabel}${timeInfo}`;
            } else if (status === 'INCONCLUSIVE') {
                return `${worker} stopped work on ${taskLabel} and needs a question answered${timeInfo}`;
            } else if (status.startsWith('ESCALATE')) {
                return `${worker} flagged ${taskLabel} for manual review${timeInfo}`;
            } else {
                const statusClean = status.toLowerCase().replace(/_/g, ' ');
                return `${worker} stopped work on ${taskLabel} (${statusClean})${timeInfo}`;
            }
        }
        case 'worktree_cleanup_stashed':
            return `${worker} stashed progress on ${taskLabel}`;
        case 'dispatch_rejected':
            return `Job request was denied: ${event.reason || 'unknown reason'}`;
        case 'hmac_reject':
            return `Security: Signature verification failed`;
        case 'listener_listening':
            return 'Dispatch system is live and ready for jobs';
        case 'listener_restarted':
            return 'Dispatch system restarted';
        case 'hermes_predict_failed':
            return `Cost prediction failed: ${event.error || 'timeout'}`;
        case 'no_worktree_available':
            return `No worktree available to start ${worker} on ${taskLabel}`;
        case 'worktree_cleanup_pull_failed':
            return `Failed to sync latest changes for ${worker}`;
        case 'memory_injected':
            return `Relevant lessons injected for ${taskLabel}`;
        case 'duplicate_prompt_in_flight':
            return `A duplicate request for ${taskLabel} is already being processed`;
        case 'worktree_auto_clean_failed':
            return `Worktree maintenance failed: ${event.stderr || 'unknown error'}`;
        default:
            return event.msg;
    }
}

function deriveLevel(event: RawLogEvent): ActivityEvent['level'] {
    switch (event.msg as ActivityEventType | string) {
        case 'worker_exit':
            if (event.status === 'CONFIRMED_WORKING') return 'success';
            if (event.status === 'INCONCLUSIVE') return 'warning';
            return 'error';
        case 'worktree_cleanup_stashed':
        case 'hermes_predict_failed':
        case 'memory_injected':
            return 'warning';
        case 'dispatch_rejected':
        case 'hmac_reject':
        case 'no_worktree_available':
        case 'worktree_cleanup_pull_failed':
        case 'duplicate_prompt_in_flight':
        case 'worktree_auto_clean_failed':
            return 'error';
        case 'listener_listening':
        case 'listener_restarted':
        case 'worker_spawned':
        default:
            return 'info';
    }
}

export const GET: RequestHandler = async () => {
    const events: ActivityEvent[] = [];

    try {
        const resolvedPath = path.resolve(serverConfig.workerLogPath);
        const dataDir = path.resolve(path.dirname(serverConfig.workerLogPath));
        const relative = path.relative(dataDir, resolvedPath);
        const isSafe =
            relative !== '' &&
            !relative.startsWith('..') &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative);
        
        if (!isSafe) {
            return json({ error: 'path_traversal_blocked' }, { status: 403 });
        }

        if (fs.existsSync(resolvedPath)) {
            const fileStream = fs.createReadStream(resolvedPath);
            const rl = readline.createInterface({
                input: fileStream,
                crlfDelay: Infinity
            });

            let lineCount = 0;
            for await (const line of rl) {
                if (!line.trim()) continue;
                try {
                    const data = JSON.parse(line);
                    if (INTERESTING_EVENTS.has(data.msg)) {
                        const summary = deriveSummary(data);
                        const friendlyWorker = deriveFriendlyWorker(data);

                        events.push({
                            id: `${data.ts}-${lineCount++}`,
                            ts: data.ts,
                            msg: data.msg as ActivityEventType,
                            summary: summary,
                            level: deriveLevel(data),
                            trace_id: data.trace_id,
                            ticket_id: data.ticket_id,
                            worker: friendlyWorker
                        });
                    }
                } catch {
                    // Ignore malformed JSON
                }
            }
        }
    } catch (error) {
        console.error('Error reading activity log:', error);
    }

    // Return the 50 most recent events, newest first
    return json({
        events: events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, 50)
    });
};
