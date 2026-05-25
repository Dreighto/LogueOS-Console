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

		if (!message || !message.trim()) {
			return json({ error: 'Message content is required.' }, { status: 400 });
		}

		// 1. Insert the operator's message into SQLite
		const chatMsg = addChatMessage(sender || 'operator', message.trim(), null, ticket_id || null);

		// 2. Scan the message to detect worker & repo dispatch heuristics
		const text = message.toLowerCase();
		
		// Heuristic 1: Worker selection
		let worker = 'auto';
		let role = 'backend';
		if (text.includes('@cc') || text.includes('claude') || text.includes('cc')) {
			worker = 'claude-code';
		} else if (text.includes('@agy') || text.includes('antigravity') || text.includes('agy') || text.includes('gemini')) {
			worker = 'agy';
		}

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

		// Heuristic 3: Check if the message actually wants to trigger a job
		// If the operator tags an agent explicitly (e.g. "@agy") or uses terms like "run", "do", "fix", "verify", "audit", "build"
		const shouldTrigger = 
			text.includes('@cc') || 
			text.includes('@agy') || 
			text.includes('run ') || 
			text.includes('fix ') || 
			text.includes('verify ') || 
			text.includes('build ') || 
			text.includes('deploy ') || 
			text.includes('check ');

		if (shouldTrigger && sender !== 'system') {
			// Trigger a background dispatch via the gateway!
			// We format the prompt to include the last 10 messages of chat history so the worker has context.
			const history = getChatMessages(10);
			const historyContext = history
				.map((m) => `[${m.sender} - ${m.timestamp}]: ${m.message}`)
				.join('\n');

			const workerPrompt = `You are a background agent in a co-working chat with the Operator (Captain).
Here is the recent conversation history for context:
---
${historyContext}
---
The operator's latest command is: "${message}"

Please execute the request, make any necessary code/file modifications in your target repository (${targetRepo}), and write your response back to the chat using the 'emit_chat_message' script when completed. If you need approval for commands, run 'wait_for_approval.py'.

PROGRESS REPORTING — emit fine-grained activity between tool calls so the
Operator can see what you're doing in the chat live. Call this between each
distinct step (reading a file, editing, running a command, finishing):

  python tools/emit_chat_activity.py --trace-id "$LOGUEOS_TRACE_ID" --action reading --target src/foo.svelte
  python tools/emit_chat_activity.py --trace-id "$LOGUEOS_TRACE_ID" --action edited --target src/foo.svelte
  python tools/emit_chat_activity.py --trace-id "$LOGUEOS_TRACE_ID" --action ran --target "npm test"
  python tools/emit_chat_activity.py --trace-id "$LOGUEOS_TRACE_ID" --action thinking
  python tools/emit_chat_activity.py --trace-id "$LOGUEOS_TRACE_ID" --action completed
  python tools/emit_chat_activity.py --trace-id "$LOGUEOS_TRACE_ID" --action failed --target "tests red"

action vocab: reading | edited | ran | thinking | completed | failed.
The script is fast (~30ms) — emit liberally. The chat polls every second
for activity rows tied to your trace_id and renders each as a thin line
under the dispatch bubble. Without these emits the operator sees a generic
"Working..." spinner and nothing else until your final emit_chat_message.`;

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
							thinking_level: 'none'
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
					console.error('Dispatch failed in chat POST:', await response.text());
				}
			} catch (err) {
				console.error('Auto-dispatch error in chat:', err);
			}
		}

		return json({ message: chatMsg });
	} catch (e: unknown) {
		console.error('POST /api/chat error:', e);
		return json({ error: 'internal_server_error' }, { status: 500 });
	}
};
