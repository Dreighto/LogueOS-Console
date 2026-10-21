// Sample data for the mobile analytics dashboard mockup (/mobile-dashboard).
//
// Everything here is static/local — there is no fetch(), no API route, and no
// server load. The initial snapshot is a fixed, hand-written object so the
// page (and its e2e coverage) renders deterministic content on first load.
// The "Refresh" control in the page calls randomizeSnapshot() to re-roll
// values in place using Math.random() — still fully offline.
//
// Pure functions here (tallies, formatters, randomizeSnapshot) are unit
// tested directly in tests/unit/mobile-dashboard.test.ts.

export type FleetState = 'busy' | 'idle' | 'error';
export type ServiceState = 'good' | 'warning' | 'critical';
export type RunState = 'success' | 'failed' | 'running' | 'queued';

export interface FleetWorker {
	id: string;
	label: string;
	state: FleetState;
	task: string | null;
	color: string;
}

export interface ServiceHealth {
	id: string;
	label: string;
	state: ServiceState;
	detail: string;
}

export interface RunOutcome {
	id: string;
	ticket: string;
	workerId: string;
	workerLabel: string;
	workerColor: string;
	state: RunState;
	durationMin: number;
	minutesAgo: number;
	summary: string;
}

export interface WorkerSpend {
	id: string;
	label: string;
	color: string;
	spend: number;
}

export interface DashboardSnapshot {
	generatedAt: Date;
	fleet: FleetWorker[];
	services: ServiceHealth[];
	runs: RunOutcome[];
	spend: WorkerSpend[];
}

// Fixed roster shared by fleet + spend samples. Colors reuse the same hex
// family as the real worker registry (src/lib/config/workers.json) purely
// for visual continuity with the rest of the Console — this module does not
// import that registry, so the mockup stays fully decoupled and static.
const ROSTER = [
	{ id: 'cc-backend-1', label: 'Claude Backend', color: '#D97757' },
	{ id: 'cc-backend-2', label: 'Claude Backend (2)', color: '#D97757' },
	{ id: 'gmi-frontend-1', label: 'Gemini Frontend', color: '#AD89EB' },
	{ id: 'ops-relay', label: 'Operator Relay', color: '#F5A623' },
	{ id: 'qa-bot', label: 'QA Automation', color: '#3b82f6' }
] as const;

const RUN_SUMMARIES = [
	'Fix stale restart procedure',
	'Operator API for PG run state',
	'Silent-death sweeper bookkeeping',
	'Stop counting clean-exit backfills',
	'Voice bridge reconnect handling',
	'Thread archive/rename UI',
	'Memory pipeline privacy redactor',
	'Canon sweep — retired worktree naming'
] as const;

function pick<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

function jitter(base: number, pct: number, min = 0): number {
	const delta = base * pct * (Math.random() * 2 - 1);
	return Math.max(min, Math.round((base + delta) * 100) / 100);
}

function rosterMember(id: string) {
	const found = ROSTER.find((w) => w.id === id);
	if (!found) throw new Error(`Unknown roster id: ${id}`);
	return found;
}

/** The fixed, deterministic starting snapshot rendered on first page load. */
export function initialSnapshot(): DashboardSnapshot {
	return {
		generatedAt: new Date(),
		fleet: [
			{
				id: 'cc-backend-1',
				label: rosterMember('cc-backend-1').label,
				state: 'busy',
				task: 'LOS-253 operator API for PG run state',
				color: rosterMember('cc-backend-1').color
			},
			{
				id: 'cc-backend-2',
				label: rosterMember('cc-backend-2').label,
				state: 'idle',
				task: null,
				color: rosterMember('cc-backend-2').color
			},
			{
				id: 'gmi-frontend-1',
				label: rosterMember('gmi-frontend-1').label,
				state: 'busy',
				task: 'Mobile dashboard mockup (LOS-260)',
				color: rosterMember('gmi-frontend-1').color
			},
			{
				id: 'ops-relay',
				label: rosterMember('ops-relay').label,
				state: 'idle',
				task: null,
				color: rosterMember('ops-relay').color
			},
			{
				id: 'qa-bot',
				label: rosterMember('qa-bot').label,
				state: 'error',
				task: 'Playwright suite — 2 specs failing',
				color: rosterMember('qa-bot').color
			}
		],
		services: [
			{
				id: 'dispatch-listener',
				label: 'Dispatch Listener',
				state: 'good',
				detail: 'Routing 12 req/min, p50 84ms'
			},
			{
				id: 'sentinel',
				label: 'Sentinel',
				state: 'good',
				detail: 'Last stall sweep 4m ago, clean'
			},
			{
				id: 'mcp-gateway',
				label: 'MCP Gateway',
				state: 'warning',
				detail: 'Elevated latency (620ms p95)'
			},
			{
				id: 'card-catalog-db',
				label: 'Card Catalog DB',
				state: 'good',
				detail: 'Nominal, 38% disk'
			},
			{
				id: 'tailscale-funnel',
				label: 'Tailscale Funnel',
				state: 'critical',
				detail: 'Funnel unreachable — retrying'
			}
		],
		runs: [
			{
				id: 'run-1',
				ticket: 'LOS-253',
				workerId: 'cc-backend-1',
				workerLabel: rosterMember('cc-backend-1').label,
				workerColor: rosterMember('cc-backend-1').color,
				state: 'success',
				durationMin: 18,
				minutesAgo: 6,
				summary: RUN_SUMMARIES[1]
			},
			{
				id: 'run-2',
				ticket: 'LOS-260',
				workerId: 'gmi-frontend-1',
				workerLabel: rosterMember('gmi-frontend-1').label,
				workerColor: rosterMember('gmi-frontend-1').color,
				state: 'running',
				durationMin: 4,
				minutesAgo: 4,
				summary: 'Mobile dashboard mockup in progress'
			},
			{
				id: 'run-3',
				ticket: 'LOS-178',
				workerId: 'cc-backend-1',
				workerLabel: rosterMember('cc-backend-1').label,
				workerColor: rosterMember('cc-backend-1').color,
				state: 'success',
				durationMin: 9,
				minutesAgo: 42,
				summary: RUN_SUMMARIES[2]
			},
			{
				id: 'run-4',
				ticket: 'LOS-177',
				workerId: 'qa-bot',
				workerLabel: rosterMember('qa-bot').label,
				workerColor: rosterMember('qa-bot').color,
				state: 'failed',
				durationMin: 3,
				minutesAgo: 55,
				summary: RUN_SUMMARIES[3]
			},
			{
				id: 'run-5',
				ticket: 'LOS-176',
				workerId: 'cc-backend-2',
				workerLabel: rosterMember('cc-backend-2').label,
				workerColor: rosterMember('cc-backend-2').color,
				state: 'success',
				durationMin: 26,
				minutesAgo: 91,
				summary: 'Operator API for PG run state + recovery actions'
			},
			{
				id: 'run-6',
				ticket: 'LOS-180',
				workerId: 'ops-relay',
				workerLabel: rosterMember('ops-relay').label,
				workerColor: rosterMember('ops-relay').color,
				state: 'success',
				durationMin: 5,
				minutesAgo: 130,
				summary: RUN_SUMMARIES[0]
			},
			{
				id: 'run-7',
				ticket: 'LOS-179',
				workerId: 'cc-backend-1',
				workerLabel: rosterMember('cc-backend-1').label,
				workerColor: rosterMember('cc-backend-1').color,
				state: 'failed',
				durationMin: 12,
				minutesAgo: 174,
				summary: 'Stale restart procedure fix — retry needed'
			},
			{
				id: 'run-8',
				ticket: 'LOS-142',
				workerId: 'gmi-frontend-1',
				workerLabel: rosterMember('gmi-frontend-1').label,
				workerColor: rosterMember('gmi-frontend-1').color,
				state: 'queued',
				durationMin: 0,
				minutesAgo: 2,
				summary: 'Design sync — dashboard token registry'
			}
		],
		spend: [
			{ id: 'cc-backend-1', label: 'Claude Backend', color: '#D97757', spend: 4.82 },
			{ id: 'gmi-frontend-1', label: 'Gemini Frontend', color: '#AD89EB', spend: 2.14 },
			{ id: 'ops-relay', label: 'Operator Relay', color: '#F5A623', spend: 0.36 },
			{ id: 'qa-bot', label: 'QA Automation', color: '#3b82f6', spend: 1.05 }
		]
	};
}

/**
 * Re-roll every value in the snapshot while preserving ids/labels/colors —
 * used by the page's "Refresh" control. Fully local (Math.random only), so
 * the dashboard still makes zero network calls after a refresh.
 */
export function randomizeSnapshot(snapshot: DashboardSnapshot): DashboardSnapshot {
	const fleetStates: FleetState[] = ['busy', 'idle', 'error'];
	const serviceStates: ServiceState[] = ['good', 'good', 'good', 'good', 'warning', 'critical'];
	const runStates: RunState[] = ['success', 'success', 'success', 'failed', 'running', 'queued'];

	return {
		generatedAt: new Date(),
		fleet: snapshot.fleet.map((w) => {
			const state = pick(fleetStates);
			return {
				...w,
				state,
				task: state === 'busy' ? pick(RUN_SUMMARIES) : null
			};
		}),
		services: snapshot.services.map((s) => {
			const state = pick(serviceStates);
			const detail =
				state === 'good'
					? 'Nominal — all checks passing'
					: state === 'warning'
						? `Elevated latency (${300 + Math.floor(Math.random() * 500)}ms p95)`
						: 'Unreachable — retrying';
			return { ...s, state, detail };
		}),
		runs: snapshot.runs.map((r) => {
			const state = pick(runStates);
			return {
				...r,
				state,
				durationMin: state === 'queued' ? 0 : 1 + Math.floor(Math.random() * 40),
				minutesAgo: Math.floor(Math.random() * 240),
				summary: pick(RUN_SUMMARIES)
			};
		}),
		spend: snapshot.spend.map((w) => ({ ...w, spend: jitter(w.spend, 0.6, 0.05) }))
	};
}

/** Tally fleet workers by state — drives the three health stat tiles. */
export function tallyFleetStates(fleet: FleetWorker[]): Record<FleetState, number> {
	const tally: Record<FleetState, number> = { busy: 0, idle: 0, error: 0 };
	for (const w of fleet) tally[w.state]++;
	return tally;
}

/** Tally services by state. */
export function tallyServiceStates(services: ServiceHealth[]): Record<ServiceState, number> {
	const tally: Record<ServiceState, number> = { good: 0, warning: 0, critical: 0 };
	for (const s of services) tally[s.state]++;
	return tally;
}

/**
 * Success rate across *terminal* runs (success + failed). Running/queued
 * runs haven't resolved yet, so they're excluded from the denominator —
 * otherwise refreshing toward more in-flight runs would misleadingly drag
 * the rate down. Returns 0 when there are no terminal runs yet.
 */
export function computeSuccessRate(runs: RunOutcome[]): number {
	const terminal = runs.filter((r) => r.state === 'success' || r.state === 'failed');
	if (terminal.length === 0) return 0;
	const successes = terminal.filter((r) => r.state === 'success').length;
	return Math.round((successes / terminal.length) * 100);
}

/** Sum of 24h spend across the fleet, rounded to cents. */
export function computeTotalSpend(spend: WorkerSpend[]): number {
	const total = spend.reduce((sum, w) => sum + w.spend, 0);
	return Math.round(total * 100) / 100;
}

export function formatCurrency(n: number): string {
	return `$${n.toFixed(2)}`;
}

/** Compact "Xm ago" / "Xh Ym ago" label for a run row. */
export function formatMinutesAgo(minutesAgo: number): string {
	if (minutesAgo < 1) return 'just now';
	if (minutesAgo < 60) return `${Math.floor(minutesAgo)}m ago`;
	const hours = Math.floor(minutesAgo / 60);
	const mins = Math.floor(minutesAgo % 60);
	return mins === 0 ? `${hours}h ago` : `${hours}h ${mins}m ago`;
}
