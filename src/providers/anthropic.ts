import { sseData } from './sse';
import { CompletionClient, CompletionRequest, ModelInfo, ProviderError, toProviderError } from './types';

const BASE = 'https://api.anthropic.com/v1';
const STOP = ['\n\n\n\n'];
const STOP_LINE = ['\n'];
const MAX_STREAM_CHARS = 4000;

export const MODELS = [
  'claude-haiku-4-5',
  'claude-sonnet-4-5',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
];

export function createAnthropic(apiKey: string, getModel: () => string): CompletionClient {
  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  });

  return {
    async complete(req: CompletionRequest): Promise<string> {
      const res = await fetch(`${BASE}/messages`, {
        method: 'POST',
        headers: headers(),
        signal: req.signal,
        body: JSON.stringify({
          model: getModel(),
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          stop_sequences: req.singleLine ? STOP_LINE : STOP,
          stream: true,
        }),
      });
      if (!res.ok) throw await toProviderError(res);
      return collectAnthropicDelta(res, req.onFirstToken);
    },

    async listModels(): Promise<ModelInfo[]> {
      try {
        const res = await fetch(`${BASE}/models`, { headers: headers() });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { data?: Array<{ id?: string; display_name?: string }> };
        const models = (json.data ?? [])
          .filter((m) => typeof m.id === 'string' && m.id.length > 0)
          .map((m) => ({ id: m.id as string, name: m.display_name }));
        return models.length ? models : MODELS.map((id) => ({ id }));
      } catch {
        return MODELS.map((id) => ({ id }));
      }
    },
  };
}

async function collectAnthropicDelta(res: Response, onFirstToken?: () => void): Promise<string> {
  let out = '';
  let first = false;
  for await (const data of sseData(res)) {
    try {
      const json = JSON.parse(data) as any;
      if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
        if (typeof json.delta.text === 'string') {
          if (!first) {
            first = true;
            onFirstToken?.();
          }
          out += json.delta.text;
        }
      } else if (json.type === 'message_stop') {
        break;
      } else if (json.type === 'error') {
        throw new ProviderError(undefined, String(json.error?.message ?? 'Anthropic stream error'));
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
    }
    if (out.length >= MAX_STREAM_CHARS) break;
  }
  return out;
}
