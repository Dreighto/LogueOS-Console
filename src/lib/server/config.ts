// Server-only configuration. Lives under $lib/server/ so SvelteKit's
// build will refuse to import it from any client-reachable module —
// see https://svelte.dev/docs/kit/server-only-modules.
//
// Why this is a separate file: the previous shape (single $lib/config.ts)
// imported $env/dynamic/private, but $lib/config was also imported by
// +page.svelte (client). $env/dynamic/private "can only be imported into
// modules that only run on the server" — flagged Critical by CodeRabbit
// on PR #2. Splitting server vs. client config is the SvelteKit
// canonical pattern.

import { env as privateEnv } from '$env/dynamic/private';

// Same fallback chain as before: $env first (set via .env or platform
// secret manager), then process.env (local dev with raw shell exports),
// then the literal default. This survives both `vite dev` and a built
// `node build/` deployment.
//
// Nullish coalescing (??) instead of || so an env var explicitly set to ''
// (empty string, no value) doesn't silently fall through to the next tier.
// CodeRabbit Round 2 nit: previously used (privateEnv as Record<string,string>)
// which masked the actual `string | undefined` return type from $env.
const getEnv = (key: string, fallback: string): string =>
	privateEnv[key] ?? (typeof process !== 'undefined' ? (process.env[key] ?? fallback) : fallback);

// Validate parsed integers — CodeRabbit Major: parseInt accepts NaN,
// negatives, and "1foo", any of which would silently break the polling
// loop or return-window math. Fail loudly at startup instead.
const parsePositiveInt = (raw: string, name: string): number => {
	const value = Number.parseInt(raw, 10);
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error(
			`${name} must be a positive integer; got ${JSON.stringify(raw)} (parsed as ${value}).`
		);
	}
	return value;
};

// LOS-20: post-LOS-10 cutover (2026-05-11). Audit chain + listener logs now
// live in LogueOS-Orchestrator/data and /logs. Defaults updated; both env
// vars still overridable for dev/test isolation. Old project-miru paths are
// now the frozen v1 chain — Console reads the live v2 chain by default.
export const serverConfig = {
	completionLogPath: getEnv(
		'LOGUEOS_COMPLETION_LOG_PATH',
		'D:\\dev\\LogueOS-Orchestrator\\data\\cc_completion_log.jsonl'
	),
	workerLogPath: getEnv(
		'LOGUEOS_WORKER_LOG_PATH',
		'D:\\dev\\LogueOS-Orchestrator\\logs\\dispatch_listener_stdout.log'
	),
	// Kill switch contract (tools/check_kill_switch.py): file presence at
	// killSwitchPath = ACTIVE. File absence = CLEAR. Contents are free-form;
	// we write a small JSON payload on activate so future workers can see
	// who/when/why before deciding what to do. killSwitchLogPath is an
	// append-only audit of every activate/clear toggle for after-the-fact
	// review (separate from the existence-bit because the bit is destroyed
	// on clear).
	killSwitchPath: getEnv(
		'LOGUEOS_KILL_SWITCH_PATH',
		'D:\\dev\\LogueOS-Orchestrator\\data\\system_halt'
	),
	killSwitchLogPath: getEnv(
		'LOGUEOS_KILL_SWITCH_LOG_PATH',
		'D:\\dev\\LogueOS-Orchestrator\\data\\kill_switch_log.jsonl'
	),
	pollIntervalMs: parsePositiveInt(getEnv('LOGUEOS_RUN_POLL_MS', '5000'), 'LOGUEOS_RUN_POLL_MS'),
	feedLimit: parsePositiveInt(getEnv('LOGUEOS_RUN_FEED_LIMIT', '50'), 'LOGUEOS_RUN_FEED_LIMIT')
};

// Subset of serverConfig that's safe to expose to the client via load().
// Specifically excludes completionLogPath (filesystem path leak risk).
export const clientSafeConfig = {
	pollIntervalMs: serverConfig.pollIntervalMs,
	feedLimit: serverConfig.feedLimit
};
