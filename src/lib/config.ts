import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

// We use process.env as fallback for local dev if $env is not populated
const getPrivateEnv = (key: string, fallback: string) => (privateEnv as Record<string, string>)[key] || (typeof process !== 'undefined' ? process.env[key] : fallback) || fallback;
const getPublicEnv = (key: string, fallback: string) => (publicEnv as Record<string, string>)[key] || (typeof process !== 'undefined' ? process.env[key] : fallback) || fallback;

export const config = {
	completionLogPath: getPrivateEnv('LOGUEOS_COMPLETION_LOG_PATH', 'D:\\dev\\miru\\data\\cc_completion_log.jsonl'),
	pollIntervalMs: parseInt(getPublicEnv('LOGUEOS_RUN_POLL_MS', '5000')),
	feedLimit: parseInt(getPublicEnv('LOGUEOS_RUN_FEED_LIMIT', '50'))
};
