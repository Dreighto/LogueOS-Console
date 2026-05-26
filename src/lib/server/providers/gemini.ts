// Gemini provider — AGY OAuth from ~/.gemini/oauth_creds.json (primary),
// GEMINI_API_KEY (fallback only; RESERVED for image generation in normal
// routing, so the router only sends chat here when OAuth fails or this
// provider is explicitly requested).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface ProviderMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface ProviderChatOptions {
	messages: ProviderMessage[];
	model: string;
	system?: string;
	signal?: AbortSignal;
	/** 'oauth' tries OAuth first; 'api_key' skips OAuth. Default: 'oauth'. */
	authMode?: 'oauth' | 'api_key';
}

export interface ProviderChatResult {
	reply: string;
	usage: { input: number; output: number; total: number };
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OAUTH_CREDS_PATH =
	process.env.LOGUEOS_GEMINI_OAUTH_PATH || path.join(os.homedir(), '.gemini', 'oauth_creds.json');
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// In-memory token cache. Refreshed automatically when expired or on 401.
let cachedToken: { access_token: string; expires_at: number } | null = null;

interface OAuthCreds {
	access_token?: string;
	refresh_token?: string;
	client_id?: string;
	client_secret?: string;
	token_uri?: string;
	expiry?: string;
	expires_in?: number;
}

function readOAuthCreds(): OAuthCreds | null {
	try {
		const raw = fs.readFileSync(OAUTH_CREDS_PATH, 'utf-8');
		return JSON.parse(raw) as OAuthCreds;
	} catch {
		return null;
	}
}

async function refreshAccessToken(creds: OAuthCreds): Promise<string | null> {
	if (!creds.refresh_token || !creds.client_id || !creds.client_secret) return null;
	const tokenUri = creds.token_uri || TOKEN_ENDPOINT;
	try {
		const resp = await fetch(tokenUri, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'refresh_token',
				refresh_token: creds.refresh_token,
				client_id: creds.client_id,
				client_secret: creds.client_secret
			}).toString()
		});
		if (!resp.ok) return null;
		const data = (await resp.json()) as { access_token?: string; expires_in?: number };
		if (!data.access_token) return null;
		cachedToken = {
			access_token: data.access_token,
			expires_at: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000
		};
		return data.access_token;
	} catch {
		return null;
	}
}

async function getOAuthToken(): Promise<string | null> {
	// Use cached token if not expired.
	if (cachedToken && Date.now() < cachedToken.expires_at) {
		return cachedToken.access_token;
	}
	const creds = readOAuthCreds();
	if (!creds) return null;

	// If the stored access_token is present and not expired, use it.
	if (creds.access_token) {
		const expiry = creds.expiry ? new Date(creds.expiry).getTime() : 0;
		if (expiry > Date.now() + 60_000) {
			cachedToken = { access_token: creds.access_token, expires_at: expiry };
			return creds.access_token;
		}
	}
	// Refresh.
	return refreshAccessToken(creds);
}

export function getApiKey(): string {
	return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
}

export function isAvailable(): boolean {
	return !!(readOAuthCreds() || getApiKey());
}

interface GeminiContent {
	role: 'user' | 'model';
	parts: { text: string }[];
}

interface GeminiResponse {
	candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		totalTokenCount?: number;
	};
	error?: { message: string };
}

export async function chat(options: ProviderChatOptions): Promise<ProviderChatResult> {
	const authMode = options.authMode ?? 'oauth';
	let authHeader: Record<string, string> = {};
	let urlKey = '';

	if (authMode === 'oauth') {
		const token = await getOAuthToken();
		if (token) {
			authHeader = { Authorization: `Bearer ${token}` };
		} else {
			// OAuth not available, fall back to API key.
			const key = getApiKey();
			if (!key) throw new Error('Gemini: no OAuth token and GEMINI_API_KEY not configured');
			urlKey = `?key=${key}`;
		}
	} else {
		const key = getApiKey();
		if (!key) throw new Error('Gemini: GEMINI_API_KEY not configured');
		urlKey = `?key=${key}`;
	}

	const contents: GeminiContent[] = options.messages.map((m) => ({
		role: m.role === 'user' ? 'user' : 'model',
		parts: [{ text: m.content }]
	}));

	const resp = await fetch(`${GEMINI_BASE}/models/${options.model}:generateContent${urlKey}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...authHeader },
		body: JSON.stringify({
			contents,
			generationConfig: { maxOutputTokens: 4096 },
			...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {})
		}),
		signal: options.signal
	});

	// On 401/403, invalidate cached token and retry once with API key.
	if ((resp.status === 401 || resp.status === 403) && authMode === 'oauth' && !urlKey) {
		cachedToken = null;
		const key = getApiKey();
		if (key) {
			return chat({ ...options, authMode: 'api_key' });
		}
	}

	if (!resp.ok) {
		const body = await resp.text().catch(() => '');
		const err = new Error(`Gemini HTTP ${resp.status}: ${body.slice(0, 300)}`);
		(err as Error & { status: number }).status = resp.status;
		throw err;
	}

	const data = (await resp.json()) as GeminiResponse;
	if (data.error) throw new Error(`Gemini API error: ${data.error.message}`);

	const reply = (data.candidates?.[0]?.content?.parts ?? [])
		.map((p) => p.text ?? '')
		.filter(Boolean)
		.join('\n')
		.trim();
	if (!reply) throw new Error('Gemini returned an empty reply.');

	const u = data.usageMetadata ?? {};
	return {
		reply,
		usage: {
			input: u.promptTokenCount ?? 0,
			output: u.candidatesTokenCount ?? 0,
			total: u.totalTokenCount ?? 0
		}
	};
}
