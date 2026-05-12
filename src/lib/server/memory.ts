import fs from 'node:fs';
import readline from 'node:readline';
import Database from 'better-sqlite3';
import { serverConfig } from './config';
import type { ProvisionalLesson, AdoptedLesson, Observation } from '$lib/types/memory';

function parseAdoptedLessons(markdown: string): AdoptedLesson[] {
	const sections = markdown.split(/^## /m).slice(1);
	return sections.map((section) => {
		const lines = section.trim().split('\n');
		const header = lines[0];
		const body = lines.slice(1).join('\n').trim();

		// Extract (source, adopted YYYY-MM-DD)
		const metaMatch = header.match(/\(([^,]+),\s*adopted\s*(\d{4}-\d{2}-\d{2})\)/);
		const text = body;
		const adopted_date = metaMatch ? metaMatch[2] : new Date().toISOString().split('T')[0];

		return {
			text,
			adopted_date,
			severity: 'hard-rule', // Tier 2 defaults to hard-rule
			applies_to: ['*'] // Default to all projects for Tier 2 for now
		};
	});
}

async function loadObservations(filePath: string): Promise<Observation[]> {
	if (!fs.existsSync(filePath)) return [];

	const observations: Observation[] = [];
	const fileStream = fs.createReadStream(filePath);
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity
	});

	for await (const line of rl) {
		if (!line.trim()) continue;
		try {
			const row = JSON.parse(line);
			if (row.kind === 'observation') {
				observations.push(row);
			}
		} catch {
			// skip malformed lines
		}
	}

	return observations.reverse().slice(0, 50); // Newest first, limit to 50
}

export async function getMemoryData() {
	let provisional: ProvisionalLesson[] = [];
	let adopted: AdoptedLesson[] = [];
	let raw: Observation[] = [];

	// 1. Load Provisional Lessons (Tier 1) from SQLite
	if (fs.existsSync(serverConfig.memoryDbPath)) {
		const db = new Database(serverConfig.memoryDbPath, { readonly: true });
		const rows = db.prepare('SELECT * FROM provisional_lessons ORDER BY created_at DESC LIMIT 20').all();

		provisional = rows.map((row: any) => {
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
	}

	// 2. Load Adopted Lessons (Tier 2) from Markdown
	if (fs.existsSync(serverConfig.adoptedLessonsPath)) {
		const md = fs.readFileSync(serverConfig.adoptedLessonsPath, 'utf-8');
		adopted = parseAdoptedLessons(md);
	}

	// 3. Load Raw Observations (Tier 0) from JSONL
	raw = await loadObservations(serverConfig.decisionsLogPath);

	return { provisional, adopted, raw };
}
