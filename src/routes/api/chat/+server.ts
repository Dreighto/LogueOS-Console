import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getChatMessages, addChatMessage } from '$lib/server/chat';
import { serverConfig } from '$lib/server/config';

const GATEWAY_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

export const GET: RequestHandler = async ({ url }) => {
	try {
		const limitParam = url.searchParams.get('limit');
		const limit = limitParam ? Number.parseInt(limitParam, 10) : 50;
		const messages = getChatMessages(limit);
		return json({ messages });
	} catch (e: unknown) {
		console.error('GET /api/chat error:', e);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { sender, message, ticket_id } = body;
		// Explicit agent selection from the chat UI's pill switcher. Accepted
		// values: 'auto' | 'claude-code' | 'agy'. When set to anything other
		// than 'auto', it overrides the @-mention heuristic below.
		const explicitAgent: string =
			body && typeof body.agent === 'string' ? body.agent.trim().toLowerCase() : 'auto';

		if (!message || !message.trim()) {
			return json({ error: 'Message content is required.' }, { status: 400 });
		}

		// 1. Insert the operator's message into SQLite
		const chatMsg = addChatMessage(sender || 'operator', message.trim(), null, ticket_id || null);

		// 2. Resolve worker selection. Operator's explicit pill wins if set;
		//    otherwise fall back to @-mention heuristic; otherwise 'auto'.
		const text = message.toLowerCase();
		let role = 'backend';
		let worker = 'auto';
		if (explicitAgent === 'claude-code' || explicitAgent === 'agy') {
			worker = explicitAgent;
		} else if (text.includes('@cc')) {
			worker = 'claude-code';
		} else if (text.includes('@agy') || text.includes('@gemini')) {
			worker = 'agy';
		}
		// Note: the previous bare-substring matching ('claude', 'cc', 'gemini')
		// was removed — it fired on unrelated mentions like "fix the Claude
		// config" or "the cc_completion_log path". Operators that want a
		// specific worker either use @cc / @agy explicitly or pick the pill.

		// Heuristic 2: Repository/Project selection
		let targetRepo = 'LogueOS-Console'; // Default project
		if (text.includes('miru')) {
			targetRepo = 'project-miru';
		} else if (text.includes('orchestrator') || text.includes('kernel') || text.includes('logueos-orchestrator')) {
			targetRepo = 'LogueOS-Orchestrator';
		} else if (text.includes('nasdoom')) {
			targetRepo = 'NASDOOM';
		} else if (text.includes('console') || text.includes('dashboard') || text.includes('ui')) {
			targetRepo = 'LogueOS-Console';
		}

		// Heuristic 3: Should this message actually fire a worker dispatch?
		// In Auto mode (no explicit agent locked), we trigger on a generous
		// set of signals so casual operator phrasing reliably gets a reply
		// without forcing them to type magic verbs. The rare false-positive
		// (firing a worker on a non-request comment) is much cheaper than
		// the silent no-response bug operators kept hitting.
		//
		//   - Any @-mention (@cc, @agy, @gemini)
		//   - Any '?' anywhere in the message — questions ARE requests
		//   - Action verb (broadened from the original 6 to ~30)
		//   - Message starts with a question word (what/where/why/how/...)
		const ACTION_VERBS = [
			'run ', 'fix ', 'verify ', 'build ', 'deploy ', 'check ',
			'do ', 'make ', 'add ', 'remove ', 'delete ', 'update ',
			'refactor ', 'audit ', 'review ', 'analyze ', 'analyse ',
			'investigate ', 'explain ', 'find ', 'search ', 'list ',
			'show ', 'tell ', 'help ', 'test ', 'try ', 'create ',
			'write ', 'generate ', 'propose ', 'suggest ', 'summarize ',
			'summarise ', 'compare ', 'triage ', 'figure out ',
			'look at ', 'look into ',
			'start ', 'stop ', 'restart ', 'kill ', 'clean ',
			'pull ', 'push ', 'merge ', 'commit '
		];
		const QUESTION_START = /^(what|where|why|how|who|when|which|whose|whom|can|could|should|would|is|are|was|were|does|do|did|will|won't|don't|isn't|aren't|am|has|have|had)\b/i;

		const shouldTrigger =
			explicitAgent === 'claude-code' ||
			explicitAgent === 'agy' ||
			text.includes('@cc') ||
			text.includes('@agy') ||
			text.includes('@gemini') ||
			text.includes('?') ||
			ACTION_VERBS.some((v) => text.includes(v)) ||
			QUESTION_START.test(text);

		if (shouldTrigger && sender !== 'system') {
			// Trigger a background dispatch via the gateway!
			// Pull the last 30 messages, then trim to anything AFTER the most
			// recent "--- NEW CONVERSATION ---" system marker so operator-initiated
			// resets actually clear worker context (instead of leaking older
			// threads into the new one).
			const allHistory = getChatMessages(30);
			const lastResetIdx = (() => {
				for (let i = allHistory.length - 1; i >= 0; i--) {
					if (
						allHistory[i].sender === 'system' &&
						allHistory[i].message.startsWith('--- NEW CONVERSATION ---')
					) {
						return i;
					}
				}
				return -1;
			})();
			const history = lastResetIdx >= 0 ? allHistory.slice(lastResetIdx + 1) : allHistory;
			const historyContext = history
				.map((m) => `[${m.sender} - ${m.timestamp}]: ${m.message}`)
				.join('\n');

			const workerPrompt = `You are a background agent in a co-working chat with the Operator (Captain).
Here is the recent conversation history for context:
---
${historyContext}
---
The operator's latest command is: "${message}"

Please execute the request, make any necessary code/file modifications in your target repository (${targetRepo}).

REPLY PROTOCOL — write your final response back to the chat with this EXACT shape:

  python tools/emit_chat_message.py --sender cc --trace_id "$LOGUEOS_TRACE_ID" --message "<your response>"

(use --sender agy instead of cc if you are Antigravity / a Gemini-class worker).

The --trace_id flag is REQUIRED. Without it the chat UI cannot match your
reply to this dispatch and will show "Working..." forever even after you
finish. Always include it.

If you need approval for commands, run 'wait_for_approval.py'.

PROGRESS REPORTING — emit fine-grained activity between tool calls so the
Operator can see what you're doing in the chat live. Call this between each
distinct step (reading a file, editing, running a command, finishing):

  python tools/emit_chat_activity.py --trace-id "$LOGUEOS_TRACE_ID" --action reading --target src/foo.svelte
  python tools/emit_chat_activity.py --trace-id "$LOGUEOS_TRACE_ID" --action edited --target src/foo.svelte
  python tools/emit_chat_activity.py --trace-id "$LOGUEOS_TRACE_ID" --action ran --target "npm test"
  python tools/emit_chat_activity.py --trace-id "$LOGUEOS_TRACE_ID" --action thinking

action vocab during work: reading | edited | ran | thinking.

CLOSING PROTOCOL — REQUIRED. After your final emit_chat_message above, ALWAYS
emit ONE terminal activity row so the chat tab knows you're done:

  python tools/emit_chat_activity.py --trace-id "$LOGUEOS_TRACE_ID" --action completed
  # OR if the task ended badly:
  python tools/emit_chat_activity.py --trace-id "$LOGUEOS_TRACE_ID" --action failed --target "<brief reason>"

Without this terminal emit the streaming bubble never closes. Treat it as
non-optional. The script is fast (~30ms).`;

			try {
				const response = await fetchWithTimeout(
					`${serverConfig.gatewayUrl}/api/v1/dispatch`,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							tool_profile: 'standard_worker',
							worker: worker === 'auto' ? undefined : worker,
							role: worker === 'auto' ? role : undefined,
							target_repo: targetRepo,
							ticket_id: ticket_id || null,
							prompt: workerPrompt,
							thinking_level: 'none',
							// Sonnet by default for chat dispatches — 3-5x faster
							// first-token + tool-call latency than Opus with no
							// meaningful quality drop for casual chat work. Heavy
							// tasks can override via a future model-pill toggle.
							model: 'claude-sonnet-4-6'
						})
					},
					GATEWAY_TIMEOUT_MS
				);

				if (response.ok) {
					const data = await response.json();
					// Emit system notification that the agent is starting
					addChatMessage(
						'system',
						`Agent dispatched: **${worker === 'auto' ? 'Role Routing' : worker}** is spinning up to handle this request on **${targetRepo}**. (Trace ID: ${data.trace_id || 'unknown'})`,
						data.trace_id || null,
						ticket_id || null
					);
				} else {
					// Surface dispatch failures into the chat so the operator
					// isn't waiting on a worker that never started. The console
					// log keeps the full payload; the chat gets a one-line
					// summary with the status code + a sanitized reason.
					const text = await response.text();
					console.error('Dispatch failed in chat POST:', text);
					let reason = `HTTP ${response.status}`;
					try {
						const parsed = JSON.parse(text);
						const inner = parsed?.error;
						if (typeof inner === 'string') {
							reason = inner;
						} else if (inner && typeof inner === 'object') {
							reason = inner.error || JSON.stringify(inner);
						}
					} catch {
						// keep the HTTP-status fallback
					}
					addChatMessage(
						'system',
						`⚠️ **Dispatch failed.** ${worker === 'auto' ? 'Role-routed worker' : worker} could not be spawned on **${targetRepo}**. Reason: \`${reason}\`. Check the dispatch_listener logs (\`journalctl -u logueos-dispatch-listener\`) for details, then retry.`,
						null,
						ticket_id || null
					);
				}
			} catch (err) {
				console.error('Auto-dispatch error in chat:', err);
				const msg = err instanceof Error ? err.message : String(err);
				addChatMessage(
					'system',
					`⚠️ **Dispatch errored before reaching the listener.** Could not reach the gateway: \`${msg.slice(0, 200)}\`. Check the gateway is running (\`systemctl status logueos-mcp-gateway\`).`,
					null,
					ticket_id || null
				);
			}
		} else if (sender !== 'system') {
			// Auto mode + the operator's message didn't match any trigger and
			// no agent pill was locked. Almost any natural phrasing should
			// have triggered (the trigger list is intentionally broad now —
			// any '?', any action verb, any question-word start, any
			// @-mention). If we're STILL here, the message was probably a
			// bare statement like "ok" or "thanks". Surface that explicitly
			// so the chat never just goes silent.
			addChatMessage(
				'system',
				`💬 No agent dispatched. That message didn't look like a request — Auto fires on questions (\`?\`), action verbs, or @-mentions. Tap the **CC** or **AGY** pill above to lock every send to a specific worker, or end with a \`?\`.`
			);
		}

		return json({ message: chatMsg });
	} catch (e: unknown) {
		console.error('POST /api/chat error:', e);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};
