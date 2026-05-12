import fs from 'node:fs/promises';
import path from 'node:path';

// Resolve the orchestrator completion log path. Honors the LOGUEOS_COMPLETION_LOG
// env var first, then falls back to a sibling-checkout layout relative to this
// repo (../LogueOS-Orchestrator/data/cc_completion_log.jsonl) so the test stays
// runnable on any operator's machine without code edits.
const logPath =
	process.env.LOGUEOS_COMPLETION_LOG ||
	path.resolve(process.cwd(), '..', 'LogueOS-Orchestrator', 'data', 'cc_completion_log.jsonl');
const trace_id = process.env.LOGUEOS_VERIFY_TRACE_ID || 'cc-LOS-2-1015616d-221341da';

async function test() {
	try {
		const content = await fs.readFile(logPath, 'utf-8');
		const lines = content.split('\n').filter((line) => line.trim() !== '');

		let found = null;
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i];
			try {
				const data = JSON.parse(line);
				if (data.trace_id === trace_id) {
					found = data;
					break;
				}
			} catch {
				// Skip malformed lines
			}
		}

		if (found) {
			console.log('SUCCESS: Found run', found.ticket_id);
			const summary = typeof found.summary === 'string' ? found.summary : '';
			const preview =
				summary.length > 50 ? summary.slice(0, 50) + '...' : summary || '(no summary)';
			console.log('Summary:', preview);
			process.exit(0);
		} else {
			console.error('FAILED: Run not found');
			process.exit(1);
		}
	} catch (e) {
		console.error('ERROR:', e);
		process.exit(1);
	}
}

test();
