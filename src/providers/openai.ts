import { collectChatDelta } from './sse';
import { CompletionClient, CompletionRequest, ModelInfo, toProviderError } from './types';

const BASE = 'https://api.openai.com/v1';
const STOP = ['\n\n\n\n'];
const STOP_LINE = ['\n'];
const MAX_STREAM_CHARS = 4000;

export const CHAT_MODELS = ['gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o-mini', 'gpt-4o', 'gpt-4.1'];

export function createOpenAI(apiKey: string, getModel: () => string): CompletionClient {  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
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
          stop: req.singleLine ? STOP_LINE : STOP,
          stream: true,
        }),
      });
      if (!res.ok) throw await toProviderError(res);
      return collectChatDelta(res, MAX_STREAM_CHARS, req.onFirstToken);
    },

    async listModels(): Promise<ModelInfo[]> {
      try {
        const res = await fetch(`${BASE}/models`, {
          headers: { authorization: `Bearer ${apiKey}` },
        });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { data?: Array<{ id?: string }> };
        const ids = (json.data ?? [])
          .map((m) => m.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        if (!ids.length) throw new Error('empty');
        return ids.sort().map((id) => ({ id }));
      } catch {
        return CHAT_MODELS.map((id) => ({ id }));
      }
    },
  };
}
