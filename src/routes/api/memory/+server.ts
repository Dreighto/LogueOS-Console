import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serverConfig } from '$lib/server/config';
import type { ProvisionalLesson } from '$lib/types/memory';
import Database from 'better-sqlite3';
import fs from 'node:fs';

export const GET: RequestHandler = async () => {
    try {
        if (!fs.existsSync(serverConfig.memoryDbPath)) {
            return json({ lessons: [] });
        }

        const db = new Database(serverConfig.memoryDbPath, { readonly: true });
        
        const rows = db.prepare("SELECT * FROM provisional_lessons ORDER BY created_at DESC LIMIT 20").all();
        
        const lessons: ProvisionalLesson[] = rows.map((row: any) => {
            if (row.task_shape_tags && typeof row.task_shape_tags === 'string') {
                try {
                    row.task_shape_tags = JSON.parse(row.task_shape_tags);
                } catch {
                    row.task_shape_tags = [];
                }
            }
            row.proposed_promotion = row.proposed_promotion === 1;
            return row as ProvisionalLesson;
        });

        db.close();
        return json({ lessons });
    } catch (error) {
        console.error('Error reading memory DB:', error);
        return json({ error: 'failed_to_load_memory' }, { status: 500 });
    }
};
