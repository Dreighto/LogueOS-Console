/**
 * LOS-118 design-drift check.
 *
 * Fails if any src/**\/*.svelte file reintroduces a hardcoded colour that the
 * LOS-115 token migration removed:
 *   - a hex value inside a Tailwind arbitrary class:
 *       bg-[#161b22]   divide-[#30363d]   shadow-[0_0_4px_#22c55e]
 *   - a raw Tailwind shade utility:
 *       text-slate-400   bg-blue-500   border-gray-700
 *
 * Colour is defined once in src/app.css; components reference semantic tokens
 * only. See docs/design-system.md > Colour.
 *
 * Run: npm run check:drift
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

const PATTERNS = [
	{ label: 'hardcoded hex', re: /\[[^\]]*#[0-9a-fA-F]{3,8}/g },
	{
		label: 'raw shade utility',
		re: /\b(?:text|bg|border|ring|fill|stroke|outline|decoration|divide|from|via|to|accent|caret|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g
	}
];

/** Recursively collect every .svelte file under a directory. */
function svelteFiles(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) out.push(...svelteFiles(p));
		else if (name.endsWith('.svelte')) out.push(p);
	}
	return out;
}

let findings = 0;
for (const file of svelteFiles(SRC)) {
	const rel = 'src/' + file.slice(SRC.length + 1).replace(/\\/g, '/');
	const lines = readFileSync(file, 'utf8').split('\n');
	lines.forEach((line, i) => {
		for (const { label, re } of PATTERNS) {
			re.lastIndex = 0;
			let m;
			while ((m = re.exec(line))) {
				findings++;
				console.error(`  ${rel}:${i + 1}  [${label}]  ${m[0]}`);
			}
		}
	});
}

if (findings > 0) {
	console.error(`\ncheck:drift FAILED - ${findings} hardcoded colour(s) in src/**/*.svelte.`);
	console.error('Use a theme token from src/app.css. See docs/design-system.md > Colour.');
	process.exit(1);
}
console.log('check:drift OK - no hardcoded colours in src/**/*.svelte');
