import * as vscode from 'vscode';
import { ProviderId } from './providers/types';

let secrets: vscode.SecretStorage | undefined;

export function initSecrets(context: vscode.ExtensionContext): void {
  secrets = context.secrets;
}

function cfg(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('opencomplete');
}

export function getProvider(): ProviderId {
  return cfg().get<ProviderId>('provider', 'openrouter');
}

export function getModel(): string {
  return cfg().get<string>('model', 'qwen/qwen3-coder:free');
}

export function isEnabled(): boolean {
  return cfg().get<boolean>('enabled', true);
}

export function getDebounceMs(): number {
  return cfg().get<number>('debounceMs', 150);
}

export function getContextLines(): number {
  return cfg().get<number>('contextLines', 40);
}

export function getMaxTokens(): number {
  return cfg().get<number>('maxTokens', 64);
}

export function getTemperature(): number {
  return cfg().get<number>('temperature', 0.1);
}

export function getPrefetchIdle(): boolean {
  return cfg().get<boolean>('prefetchIdle', true);
}

export function getPrefetchIdleMs(): number {
  return cfg().get<number>('prefetchIdleMs', 600);
}

export function getEnabledLanguages(): string[] {
  return cfg().get<string[]>('enabledLanguages', ['*']);
}

export function getRelatedFiles(): boolean {
  return cfg().get<boolean>('relatedFiles', true);
}

export function getRelatedFileLines(): number {
  return cfg().get<number>('relatedFileLines', 30);
}

const ENV_KEYS: Record<ProviderId, string> = {
  openrouter: 'OPENROUTER_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

function secretKey(provider: ProviderId): string {
  return `apiKey.${provider}`;
}

export async function getApiKey(provider: ProviderId): Promise<string | undefined> {
  const stored = await secrets?.get(secretKey(provider));
  if (stored) return stored;
  const fromEnv = process.env[ENV_KEYS[provider]];
  return fromEnv || undefined;
}

export async function storeApiKey(provider: ProviderId, value: string): Promise<void> {
  if (!secrets) return;
  if (value) {
    await secrets.store(secretKey(provider), value);
  } else {
    await secrets.delete(secretKey(provider));
  }
}
