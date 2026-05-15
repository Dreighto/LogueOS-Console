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
    'listener_restarted'
]);

function formatDuration(ms: number | undefined): string {
    if (ms === undefined) return '';
    const seconds = Math.floor(ms / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function deriveSummary(event: any): string {
    const worker = event.worker || (event.trace_id?.startsWith('cc-') ? 'claude-code' : 'gemini');
    
    let ticket = event.ticket_id;
    if (!ticket && event.trace_id) {
        // e.g. 'rtr-LOS-60-6c811...' -> 'LOS-60' or 'cc-CANARY-003-fa37...' -> 'CANARY-003'
        const match = event.trace_id.match(/^(?:rtr|cc)-([A-Za-z0-9]+-\d+)/i);
        if (match) {
            ticket = match[1];
        }
    }
    ticket = ticket || 'unknown task';

    switch (event.msg as ActivityEventType) {
        case 'worker_spawned':
            return `${worker} started on ${ticket}`;
        case 'worker_exit': {
            const duration = formatDuration(event.duration_ms);
            return `${worker} finished ${ticket} (status ${event.status}${duration ? `, ${duration}` : ''})`;
        }
        case 'worktree_cleanup_stashed':
            return `${worker} stashed work on ${ticket} (no PR created)`;
        case 'dispatch_rejected':
            return `Dispatch rejected: ${event.reason || 'unknown reason'}`;
        case 'hmac_reject':
            return `HMAC signature rejection: ${event.error || 'invalid key'}`;
        case 'listener_listening':
            return 'Listener started';
        case 'listener_restarted':
            return 'Listener restarted';
        default:
            return event.msg;
    }
}

function deriveLevel(event: any): ActivityEvent['level'] {
    switch (event.msg as ActivityEventType) {
        case 'worker_exit':
            // Take HEAD: non-CONFIRMED exits are 'error' (red) so they stand out
            // visually in the activity feed. 'info' would treat all non-success
            // worker exits the same as routine spawn events.
            return event.status === 'CONFIRMED_WORKING' ? 'success' : 'error';
        case 'worktree_cleanup_stashed':
            return 'warning';
        case 'dispatch_rejected':
        case 'hmac_reject':
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
                        events.push({
                            id: `${data.ts}-${lineCount++}`,
                            ts: data.ts,
                            msg: data.msg as ActivityEventType,
                            summary: deriveSummary(data),
                            level: deriveLevel(data),
                            trace_id: data.trace_id,
                            ticket_id: data.ticket_id,
                            worker: data.worker
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
