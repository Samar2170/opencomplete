# OpenComplete

Superfast AI inline autocomplete for VS Code — powered by **OpenRouter**, **OpenAI** or **Anthropic**. Bring your own API key and model.

## Install

Get it from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=samararora99.opencomplete).

## Features

- Ghost-text inline completions while you type (Copilot-style)
- **Next-Edit Suggestions**: edits predicted elsewhere in the file (e.g. renaming a variable updates its other usages) appear as ghost text at the edit location — Tab applies them and the next edit chains in
- Symbol-aware context: the full enclosing function, plus identifiers declared outside the visible window, are included in the prompt
- Fill-in-the-middle prompt mode for FIM-trained models (qwen2.5-coder, codestral, starcoder2, …)
- Streaming requests with early abort, debounce, caching and idle prefetch — tuned for latency
- Works with OpenRouter (default), OpenAI and Anthropic
- Live model picker (fetches the OpenRouter model list, free models first)
- Word-by-word partial acceptance
- API keys stored securely in VS Code secret storage — never in settings or files

## Setup

1. Install the extension (or press F5 to run it from source).
2. Run **OpenComplete: Set API Key** and paste your key.
   - OpenRouter keys: https://openrouter.ai/keys
   - Env vars `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are also picked up.
3. Run **OpenComplete: Pick Model** to choose a model (default: `poolside/laguna-s-2.1:free`).

## Commands

| Command | Keybinding | Description |
| --- | --- | --- |
| OpenComplete: Suggest at Cursor | `Alt+\` | Trigger a completion manually |
| OpenComplete: Suggest Next Edit | `Alt+.` | Trigger a next-edit prediction manually |
| OpenComplete: Accept Next Word | `Alt+]` | Accept the suggestion word by word |
| OpenComplete: Pick Model | | Browse/search models |
| OpenComplete: Set API Key | | Store the key for a provider |
| OpenComplete: Toggle Enable / Disable | | Toggle completions |

## Settings

All under `opencomplete.*`:

| Setting | Default |
| --- | --- |
| `provider` | `openrouter` |
| `model` | `poolside/laguna-s-2.1:free` |
| `promptStyle` | `auto` |
| `maxTokens` | `64` |
| `temperature` | `0.1` |
| `debounceMs` | `150` |
| `contextLines` | `60` |
| `prefetchIdle` | `true` |
| `prefetchIdleMs` | `600` |
| `partialAccept` | `true` |
| `enabledLanguages` | `["*"]` |
| `nextEdit.enabled` | `true` |
| `nextEdit.fallback` | `false` |
| `nextEdit.debounceMs` | `400` |
| `nextEdit.maxFileChars` | `8000` |
| `relatedFiles` | `true` |
| `relatedFileLines` | `30` |

## How suggestions work

- The prompt contains a window around the cursor (default 120 lines), the enclosing function signature + body above the cursor, imports, up to two open same-language tabs, and a ranked list of identifiers declared outside the window — so variables renamed or declared far above the cursor are still used with the right spelling.
- The most recent edit is diffed on every keystroke; if it looks like a rename (`oldName` → `newName`), that hint is attached to the prompt.
- When no cursor completion is available, a next-edit predictor reviews the whole file (budgeted, default 8k chars) and proposes `SEARCH/REPLACE` edits away from the cursor; each is shown as ghost text at its location, applied with Tab, and further edits chain in.
- FIM-trained models get native fill-in-the-middle markers (`<|fim_prefix|>…<|fim_suffix|>…<|fim_middle|>`, codestral-style, …) chosen automatically from the model id, or forced via `promptStyle`.

## How it stays fast

- SSE streaming, request aborted the moment it is superseded
- Only the latest keystroke's request survives; earlier ones are cancelled
- Cache keyed by cursor, prefix and suffix — repeated states return instantly with zero API calls
- Compact windowed context, small `max_tokens` budget for cursor completions
- Idle prefetch warms the cache while the cursor rests at end of line
- Post-processing strips fences/prose and dedupes overlapping prefix text

## Development

```bash
npm install
npm run compile     # typecheck + bundle to dist/
npm run watch       # rebuild on change
F5                  # launch Extension Development Host
npm run package     # build .vsix
```
