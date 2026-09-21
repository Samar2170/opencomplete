# OpenComplete

Superfast AI inline autocomplete for VS Code — powered by **OpenRouter**, **OpenAI** or **Anthropic**. Bring your own API key and model.

## Install

Get it from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=samar.opencomplete).

## Features

- Ghost-text inline completions while you type (Copilot-style)
- Streaming requests with early abort, debounce, prefix caching and idle prefetch — tuned for latency
- Works with OpenRouter (default), OpenAI and Anthropic
- Live model picker (fetches the OpenRouter model list, free models first)
- Word-by-word partial acceptance
- API keys stored securely in VS Code secret storage — never in settings or files

## Setup

1. Install the extension (or press F5 to run it from source).
2. Run **OpenComplete: Set API Key** and paste your key.
   - OpenRouter keys: https://openrouter.ai/keys
   - Env vars `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` are also picked up.
3. Run **OpenComplete: Pick Model** to choose a model (default: `qwen/qwen3-coder:free`).

## Commands

| Command | Keybinding | Description |
| --- | --- | --- |
| OpenComplete: Suggest at Cursor | `Alt+\` | Trigger a completion manually |
| OpenComplete: Accept Next Word | `Alt+]` | Accept the suggestion word by word |
| OpenComplete: Pick Model | | Browse/search models |
| OpenComplete: Set API Key | | Store the key for a provider |
| OpenComplete: Toggle Enable / Disable | | Toggle completions |

## Settings

All under `opencomplete.*`:

| Setting | Default |
| --- | --- |
| `provider` | `openrouter` |
| `model` | `qwen/qwen3-coder:free` |
| `maxTokens` | `64` |
| `temperature` | `0.1` |
| `debounceMs` | `150` |
| `contextLines` | `40` |
| `prefetchIdle` | `true` |
| `prefetchIdleMs` | `600` |
| `partialAccept` | `true` |
| `enabledLanguages` | `["*"]` |

## How it stays fast

- SSE streaming, request aborted the moment it is superseded
- Only the latest keystroke's request survives; earlier ones are cancelled
- Prefix-keyed LRU cache — repeated states return instantly with zero API calls
- Compact windowed context (~40 lines), small `max_tokens` budget
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
