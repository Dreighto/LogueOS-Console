import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// Absolute path so this doesn't depend on the console server process having
// `gh` on its PATH; falls back to a PATH lookup.
const GH_ABS = 'C:\\Program Files\\GitHub CLI\\gh.exe';
const GH = existsSync(GH_ABS) ? GH_ABS : 'gh';

const ALLOWED_REPOS = new Set(['project-miru', 'LogueOS-Console', 'LogueOS-Orchestrator']);
const TTL_MS = 10 * 60 * 1000;

interface ShipmentDetail {
	summary: string;
	url: string;
}
const cache = new Map<string, { at: number; value: ShipmentDetail }>();

/**
 * Turn a PR body into a brief, plain-English explanation for a non-coder
 * operator: drop markdown headings and tables, de-markdown the rest, cap it.
 */
function plainLead(body: string): string {
	if (!body) return '';
	const cleaned = body
		.replace(/\r/g, '')
		// Bots (CodeRabbit etc.) append an auto-generated block — cut from there.
		.split('<!-- This is an auto-generated comment')[0]
		.split(/\n#+\s*Summary by CodeRabbit/i)[0]
		.replace(/<!--[\s\S]*?-->/g, '') // strip HTML comments
		.split('\n')
		.filter((line) => !/^\s*#{1,6}\s/.test(line)) // drop heading lines
		.filter((line) => !/^\s*\|.*\|\s*$/.test(line)) // drop markdown table rows
		.join('\n')
		.replace(/!\[[^\]]*\]\([^)]+\)/g, '') // drop images
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links -> text
		.replace(/<\/?[a-z][^>]*>/gi, '') // strip stray HTML tags
		.replace(/\*\*(.+?)\*\*/g, '$1') // bold
		.replace(/`([^`]+)`/g, '$1') // inline code
		.replace(/^\s*[-*]\s+/gm, '- ') // normalize bullets
		.replace(/[ \t]+\n/g, '\n') // strip trailing spaces
		.replace(/\n{3,}/g, '\n\n') // collapse blank runs
		.replace(/\n+[^\n]*Generated with[^\n]*$/i, '') // drop the CC footer line
		.trim();
	if (cleaned.length <= 700) return cleaned;
	// Truncate on a sentence boundary where possible, else a word boundary —
	// never mid-word.
	const slice = cleaned.slice(0, 700);
	const sentenceEnd = slice.lastIndexOf('. ');
	const cut = sentenceEnd > 400 ? sentenceEnd + 1 : Math.max(slice.lastIndexOf(' '), 400);
	return slice.slice(0, cut).trimEnd() + ' [...]';
}

export const GET: RequestHandler = async ({ url }) => {
	const repo = url.searchParams.get('repo') ?? '';
	const number = url.searchParams.get('number') ?? '';
	if (!ALLOWED_REPOS.has(repo) || !/^[0-9]+$/.test(number)) {
		return json({ error: 'bad_request' }, { status: 400 });
	}

	const key = `${repo}#${number}`;
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) {
		return json(hit.value);
	}

	try {
		const { stdout } = await execFileAsync(
			GH,
			['pr', 'view', number, '-R', `Dreighto/${repo}`, '--json', 'body,url'],
			{ timeout: 15000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }
		);
		const pr = JSON.parse(stdout) as { body?: string; url?: string };
		const value: ShipmentDetail = {
			summary: plainLead(pr.body ?? ''),
			url: pr.url ?? ''
		};
		cache.set(key, { at: Date.now(), value });
		return json(value);
	} catch (e) {
		console.error('shipment detail fetch failed:', e);
		return json({ error: 'fetch_failed' }, { status: 502 });
	}
};
