import fs from 'node:fs';
import { serverConfig } from './config';

export interface UsageMetrics {
	totalPredictedCost: number;
	totalPredictedTokens: number;
	workerBreakdown: Record<string, { cost: number; tokens: number; count: number }>;
	recentDispatches: number;
}

export async function getUsageMetrics(): Promise<UsageMetrics> {
	const metrics: UsageMetrics = {
		totalPredictedCost: 0,
		totalPredictedTokens: 0,
		workerBreakdown: {},
		recentDispatches: 0
	};

	if (!fs.existsSync(serverConfig.workerLogPath)) {
		return metrics;
	}

	// Untangling Cowboy Code: Read only the end of the log to prevent O(N) bomb.
	// Since 1 log entry is ~200 bytes, last 2MB is ~10,000 entries (plenty for 24h).
	const MAX_READ_BYTES = 2 * 1024 * 1024;
	const stats = fs.statSync(serverConfig.workerLogPath);
	const startPos = Math.max(0, stats.size - MAX_READ_BYTES);
	
	const stream = fs.createReadStream(serverConfig.workerLogPath, {
		start: startPos,
		encoding: 'utf-8'
	});

	let remainder = '';
	const now = new Date();
	const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

	for await (const chunk of stream) {
		const lines = (remainder + chunk).split('\n');
		remainder = lines.pop() || '';
		
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line);
				if (entry.msg === 'hermes_predict_logged') {
					const entryTs = new Date(entry.ts);
					if (entryTs >= twentyFourHoursAgo) {
						metrics.totalPredictedCost += entry.predicted_cost_usd || 0;
						metrics.totalPredictedTokens += entry.predicted_total_tokens || 0;
						metrics.recentDispatches++;

						const worker = entry.worker_dispatched || 'unknown';
						if (!metrics.workerBreakdown[worker]) {
							metrics.workerBreakdown[worker] = { cost: 0, tokens: 0, count: 0 };
						}
						metrics.workerBreakdown[worker].cost += entry.predicted_cost_usd || 0;
						metrics.workerBreakdown[worker].tokens += entry.predicted_total_tokens || 0;
						metrics.workerBreakdown[worker].count++;
					}
				}
			} catch {
				// skip malformed
			}
		}
	}

	if (remainder.trim()) {
		try {
			const entry = JSON.parse(remainder);
			if (entry.msg === 'hermes_predict_logged') {
				const entryTs = new Date(entry.ts);
				if (entryTs >= twentyFourHoursAgo) {
					metrics.totalPredictedCost += entry.predicted_cost_usd || 0;
					metrics.totalPredictedTokens += entry.predicted_total_tokens || 0;
					metrics.recentDispatches++;

					const worker = entry.worker_dispatched || 'unknown';
					if (!metrics.workerBreakdown[worker]) {
						metrics.workerBreakdown[worker] = { cost: 0, tokens: 0, count: 0 };
					}
					metrics.workerBreakdown[worker].cost += entry.predicted_cost_usd || 0;
					metrics.workerBreakdown[worker].tokens += entry.predicted_total_tokens || 0;
					metrics.workerBreakdown[worker].count++;
				}
			}
		} catch {
			// skip malformed
		}
	}

	// Round cost to 4 decimals for precision
	metrics.totalPredictedCost = Math.round(metrics.totalPredictedCost * 10000) / 10000;

	return metrics;
}
