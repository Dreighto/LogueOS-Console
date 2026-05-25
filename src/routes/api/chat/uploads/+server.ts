import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { serverConfig } from '$lib/server/config';

// Accept these and only these. The Markdown renderer allows <img>; permitting
// non-image MIME types would let an operator paste arbitrary blobs which then
// render as broken images at best. Keep the list tight.
const ALLOWED_MIME = new Set([
	'image/png',
	'image/jpeg',
	'image/jpg',
	'image/gif',
	'image/webp',
	'image/svg+xml'
]);

// 8 MB. iPhone screenshots are typically 1-3 MB; this leaves headroom for
// HEIC-converted-to-JPEG and full-res phone photos without becoming a DoS vector.
const MAX_BYTES = 8 * 1024 * 1024;

function extFromMime(mime: string): string {
	switch (mime) {
		case 'image/png':
			return 'png';
		case 'image/jpeg':
		case 'image/jpg':
			return 'jpg';
		case 'image/gif':
			return 'gif';
		case 'image/webp':
			return 'webp';
		case 'image/svg+xml':
			return 'svg';
		default:
			return 'bin';
	}
}

export const POST: RequestHandler = async ({ request }) => {
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return error(400, 'multipart/form-data expected');
	}

	const file = formData.get('file');
	if (!(file instanceof File)) {
		return error(400, 'missing field: file');
	}

	if (!ALLOWED_MIME.has(file.type)) {
		return error(415, `unsupported media type: ${file.type}`);
	}
	if (file.size === 0) {
		return error(400, 'empty file');
	}
	if (file.size > MAX_BYTES) {
		return error(413, `file too large (max ${MAX_BYTES} bytes)`);
	}

	try {
		fs.mkdirSync(serverConfig.chatUploadsDir, { recursive: true });
	} catch (e) {
		console.error('chat-uploads mkdir failed:', e);
		return error(500, 'storage unavailable');
	}

	const id = crypto.randomUUID();
	const ext = extFromMime(file.type);
	const filename = `${id}.${ext}`;
	const fullPath = path.join(serverConfig.chatUploadsDir, filename);

	try {
		const buffer = Buffer.from(await file.arrayBuffer());
		fs.writeFileSync(fullPath, buffer);
	} catch (e) {
		console.error('chat-uploads write failed:', e);
		return error(500, 'write failed');
	}

	// Return a relative URL — the chat textarea inserts this verbatim as a
	// markdown image. Browser resolves it against the current path so
	// /console/chat + ./api/chat/uploads/X = /console/api/chat/uploads/X.
	return json({
		url: `./api/chat/uploads/${filename}`,
		filename,
		size: file.size,
		mime: file.type
	});
};
