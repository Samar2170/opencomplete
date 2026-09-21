import { getApiKey, getModel, getProvider } from '../config';
import { createAnthropic } from './anthropic';
import { createOpenAI } from './openai';
import { createOpenRouter } from './openrouter';
import { CompletionClient, ProviderError, ProviderId } from './types';

let cached: { key: string; client: CompletionClient } | undefined;

export async function createClient(): Promise<CompletionClient> {
  const provider = getProvider();
  const apiKey = await getApiKey(provider);
  if (!apiKey) {
    throw new ProviderError(undefined, `No API key for ${provider}. Run "OpenComplete: Set API Key".`);
  }
  const key = `${provider}|${apiKey}|${getModel()}`;
  if (cached && cached.key === key) return cached.client;
  const client = createClientFor(provider, apiKey, getModel());
  cached = { key, client };
  return client;
}

export function createClientFor(provider: ProviderId, apiKey: string, model: string): CompletionClient {
  const getModel = () => model;
  switch (provider) {
    case 'openai':
      return createOpenAI(apiKey, getModel);
    case 'anthropic':
      return createAnthropic(apiKey, getModel);
    case 'openrouter':
    default:
      return createOpenRouter(apiKey, getModel);
  }
}
