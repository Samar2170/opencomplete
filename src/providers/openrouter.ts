import { collectChatDelta } from './sse';
import { CompletionClient, CompletionRequest, ModelInfo, ProviderError, toProviderError } from './types';

const BASE = 'https://openrouter.ai/api/v1';
const STOP = ['\n\n\n\n'];
const MAX_STREAM_CHARS = 4000;

const FALLBACK_MODELS = [
  'qwen/qwen3-coder:free',
  'z-ai/glm-4.5-air:free',
  'deepseek/deepseek-chat-v3.1:free',
  'mistralai/devstral-small:free',
  'openai/gpt-4.1-mini',
  'anthropic/claude-3.5-haiku',
];

export function createOpenRouter(apiKey: string, getModel: () => string): CompletionClient {
  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
    'http-referer': 'https://github.com/samar/opencomplete',
    'x-title': 'OpenComplete',
  });

  return {
    async complete(req: CompletionRequest): Promise<string> {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: headers(),
        signal: req.signal,
        body: JSON.stringify({
          model: getModel(),
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          stop: STOP,
          stream: true,
        }),
      });
      if (!res.ok) throw await toProviderError(res);
      return collectChatDelta(res, MAX_STREAM_CHARS, req.onFirstToken);
    },

    async listModels(): Promise<ModelInfo[]> {
      try {
        const res = await fetch(`${BASE}/models`);
        if (!res.ok) throw await toProviderError(res);
        const json = (await res.json()) as { data?: any[] };
        return (json.data ?? []).map((m) => ({
          id: String(m.id),
          name: typeof m.name === 'string' ? m.name : undefined,
          free: isFree(m),
        }));
      } catch (err) {
        if (err instanceof ProviderError) throw err;
        return FALLBACK_MODELS.map((id) => ({ id, free: id.endsWith(':free') }));
      }
    },
  };
}

export async function fetchOpenRouterModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${BASE}/models`);
  if (!res.ok) throw await toProviderError(res);
  const json = (await res.json()) as { data?: any[] };
  return (json.data ?? []).map((m) => ({
    id: String(m.id),
    name: typeof m.name === 'string' ? m.name : undefined,
    free: isFree(m),
  }));
}

function isFree(model: any): boolean {
  const pricing = model?.pricing;
  const zero = (v: unknown) => v !== undefined && Number(v) === 0;
  return (
    (pricing && zero(pricing.prompt) && zero(pricing.completion)) ||
    String(model?.id ?? '').endsWith(':free')
  );
}
