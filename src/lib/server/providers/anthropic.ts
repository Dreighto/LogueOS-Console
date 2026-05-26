// Anthropic provider — Claude Max subscription via MIRU_ROUTING_KEY.
// No fallback key: MIRU_ROUTING_KEY IS the subscription path.
// On 402 billing error, caller should rotate credential (not downgrade tier).

export interface ProviderMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface ProviderChatOptions {
	messages: ProviderMessage[];
	model: string;
	signal?: AbortSignal;
}

export interface ProviderChatResult {
	reply: string;
	usage: { input: number; output: number; total: number };
}

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

export function getApiKey(): string {
	return process.env.MIRU_ROUTING_KEY || process.env.ANTHROPIC_API_KEY || '';
}

export function isAvailable(): boolean {
	return !!getApiKey();
}

interface AnthropicResponse {
	content?: Array<{ type: string; text?: string }>;
	usage?: { input_tokens: number; output_tokens: number };
	error?: { type: string; message: string };
}

export async function chat(options: ProviderChatOptions): Promise<ProviderChatResult> {
	const key = getApiKey();
	if (!key) throw new Error('Anthropic: MIRU_ROUTING_KEY not configured');

	const resp = await fetch(`${ANTHROPIC_BASE}/messages`, {
		method: 'POST',
		headers: {
			'x-api-key': key,
			'anthropic-version': ANTHROPIC_VERSION,
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			model: options.model,
			max_tokens: 4096,
			messages: options.messages
		}),
		signal: options.signal
	});

	if (!resp.ok) {
		const body = await resp.text().catch(() => '');
		// Surface the status code so the router can distinguish 402 (billing)
		// from 5xx (outage). Do not wrap both under a generic Error.
		const err = new Error(`Anthropic HTTP ${resp.status}: ${body.slice(0, 300)}`);
		(err as Error & { status: number }).status = resp.status;
		throw err;
	}

	const data = (await resp.json()) as AnthropicResponse;
	if (data.error) throw new Error(`Anthropic API error: ${data.error.message}`);

	const reply = (data.content ?? [])
		.filter((p) => p.type === 'text')
		.map((p) => p.text ?? '')
		.join('')
		.trim();
	if (!reply) throw new Error('Anthropic returned an empty reply.');

	const input = data.usage?.input_tokens ?? 0;
	const output = data.usage?.output_tokens ?? 0;
	return { reply, usage: { input, output, total: input + output } };
}
