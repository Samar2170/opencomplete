export type ProviderId = 'openrouter' | 'openai' | 'anthropic';

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
  temperature: number;
  signal: AbortSignal;
  singleLine?: boolean;
  onFirstToken?: () => void;
}

export interface ModelInfo {
  id: string;
  name?: string;
  free?: boolean;
}

export interface CompletionClient {
  complete(req: CompletionRequest): Promise<string>;
  listModels(): Promise<ModelInfo[]>;
}

export class ProviderError extends Error {
  constructor(readonly status: number | undefined, message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export async function toProviderError(res: Response): Promise<ProviderError> {
  let detail = '';
  try {
    const body = await res.text();
    try {
      const json = JSON.parse(body) as { error?: { message?: string }; message?: string };
      detail = json.error?.message ?? json.message ?? body;
    } catch {
      detail = body;
    }
  } catch {
    detail = '';
  }
  const hints: Record<number, string> = {
    401: 'Invalid or missing API key. Run "OpenComplete: Set API Key".',
    402: 'Insufficient credits. Try a free model or top up.',
    403: 'Request forbidden.',
    404: 'Unknown model. Run "OpenComplete: Pick Model".',
    429: 'Rate limited. Wait or switch model.',
    500: 'Provider server error.',
    502: 'Provider server error.',
    503: 'Provider temporarily unavailable.',
  };
  const parts = [`${res.status} ${res.statusText}`.trim()];
  const hint = hints[res.status];
  if (hint) parts.push(hint);
  if (detail) parts.push(detail.slice(0, 200));
  return new ProviderError(res.status, parts.join(' — '));
}
