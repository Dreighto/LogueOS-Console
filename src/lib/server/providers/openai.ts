// OpenAI provider — OPENAI_API_KEY, no OAuth path.
// Fallback path only (Anthropic and Gemini are preferred).

export interface ProviderMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface ProviderChatOptions {
	messages: ProviderMessage[];
	model: string;
	system?: string;
	signal?: AbortSignal;
}

export interface ProviderChatResult {
	reply: string;
	usage: { input: number; output: number; total: number };
}

const OPENAI_BASE = 'https://api.openai.com/v1';

export function getApiKey(): string {
	return process.env.OPENAI_API_KEY || '';
}

export function isAvailable(): boolean {
	return !!getApiKey();
}

interface OpenAIResponse {
	choices?: Array<{ message?: { content?: string } }>;
	usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
	error?: { message: string };
}

export async function chat(options: ProviderChatOptions): Promise<ProviderChatResult> {
	const key = getApiKey();
	if (!key) throw new Error('OpenAI: OPENAI_API_KEY not configured');

	const resp = await fetch(`${OPENAI_BASE}/chat/completions`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${key}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			model: options.model,
			messages: options.system
				? [{ role: 'system', content: options.system }, ...options.messages]
				: options.messages,
			max_tokens: 4096
		}),
		signal: options.signal
	});

	if (!resp.ok) {
		const body = await resp.text().catch(() => '');
		const err = new Error(`OpenAI HTTP ${resp.status}: ${body.slice(0, 300)}`);
		(err as Error & { status: number }).status = resp.status;
		throw err;
	}

	const data = (await resp.json()) as OpenAIResponse;
	if (data.error) throw new Error(`OpenAI API error: ${data.error.message}`);

	const reply = data.choices?.[0]?.message?.content?.trim();
	if (!reply) throw new Error('OpenAI returned an empty reply.');

	const u = data.usage;
	return {
		reply,
		usage: {
			input: u?.prompt_tokens ?? 0,
			output: u?.completion_tokens ?? 0,
			total: u?.total_tokens ?? 0
		}
	};
}
