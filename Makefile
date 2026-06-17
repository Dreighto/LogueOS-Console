# Local CI — replaces the disabled GitHub Actions ci.yml. Gate runs locally now.
# Install the hook once per clone:  git config core.hooksPath tools/git-hooks
.PHONY: preflight ci e2e
preflight ci:   ## blocking: vitest + build (+ advisory lint/check/drift)
	@tools/preflight.sh
e2e:            ## heavy Playwright chat regression suite (run on apple-node)
	@npx playwright test tests/e2e/chat.spec.ts tests/e2e/chat-preview.spec.ts --reporter=list
