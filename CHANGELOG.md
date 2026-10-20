# Changelog

## Unreleased

- Performance: OpenRouter requests now disable reasoning and sort providers by latency; single-line stop (`\n`) when text follows the cursor on the line
- Performance: empty completions no longer trigger a second next-edit request by default (`nextEdit.fallback`, off); empty results are no longer cached
- Performance: provider path joins an in-flight prefetch for the same position instead of cancelling and restarting it
- Performance: per-keystroke work no longer scans the whole file (ranged reads, bounded symbol scan, context built once after the idle timer, rename diff limited to changed lines, tracked-document cache capped); non-file documents are ignored
- Performance: API key and configuration cached in memory; 10 s backoff after HTTP 429
- Default `contextLines` lowered from 120 to 60

## 0.3.0

- Next-Edit Suggestions: predicts edits elsewhere in the file (rename propagation, call-site updates) and shows them as ghost text at the edit location — Tab applies them and the next edit chains in (`Alt+.` for manual trigger)
- Rename awareness: the latest change is diffed per keystroke; renames are passed to both the completion and next-edit prompts so usages of the old name get updated
- Richer context: full enclosing-function extraction, identifier harvesting for names declared/used outside the visible window, larger default context (120 lines)
- Fill-in-the-middle prompt mode (`promptStyle: auto|chat|fim`) with native FIM markers for qwen2.5-coder, codestral, starcoder2, codellama, deepseek-coder and codegemma
- New default model `poolside/laguna-s-2.1:free` (purpose-built autocomplete model; `qwen/qwen3-coder:free` no longer available)
- Benchmark now scores models on rename-propagation quality, not just latency
- Cache key includes suffix and cursor offset — stale suggestions after edits below the cursor are gone

## 0.2.0

- Streaming inline completions (ghost text) powered by OpenRouter, OpenAI or Anthropic
- Live model picker — fetches the OpenRouter model list, free models first
- Word-by-word partial acceptance with `Alt+]`
- Idle prefetch and prefix-keyed LRU cache for instant repeat suggestions
- Related-file context (up to two open same-language tabs)
- API keys stored in VS Code secret storage
- `OpenComplete: Benchmark Models` command
