import fs from 'node:fs/promises';

const logPath = 'D:\\dev\\LogueOS-Orchestrator\\data\\cc_completion_log.jsonl';
const trace_id = 'cc-LOS-2-1015616d-221341da';

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
			console.log('Summary:', found.summary.slice(0, 50) + '...');
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
