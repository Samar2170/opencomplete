import * as vscode from 'vscode';
import { ProviderId } from './providers/types';

let secrets: vscode.SecretStorage | undefined;
let cfgCache: vscode.WorkspaceConfiguration | undefined;
const keyCache = new Map<ProviderId, string>();

export function initSecrets(context: vscode.ExtensionContext): void {
  secrets = context.secrets;
  context.subscriptions.push(
    context.secrets.onDidChange(() => keyCache.clear()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('opencomplete')) cfgCache = undefined;
    }),
  );
}

function cfg(): vscode.WorkspaceConfiguration {
  return (cfgCache ??= vscode.workspace.getConfiguration('opencomplete'));
}

export function getProvider(): ProviderId {
  return cfg().get<ProviderId>('provider', 'openrouter');
}

export function getModel(): string {
  return cfg().get<string>('model', 'poolside/laguna-s-2.1:free');
}

export function isEnabled(): boolean {
  return cfg().get<boolean>('enabled', true);
}

export function getDebounceMs(): number {
  return cfg().get<number>('debounceMs', 150);
}

export function getContextLines(): number {
  return cfg().get<number>('contextLines', 60);
}

export type PromptStyle = 'auto' | 'chat' | 'fim';

export function getPromptStyle(): PromptStyle {
  return cfg().get<PromptStyle>('promptStyle', 'auto');
}

export function getNextEditEnabled(): boolean {
  return cfg().get<boolean>('nextEdit.enabled', true);
}

export function getNextEditFallback(): boolean {
  return cfg().get<boolean>('nextEdit.fallback', false);
}

export function getNextEditDebounceMs(): number {
  return cfg().get<number>('nextEdit.debounceMs', 400);
}

export function getNextEditMaxFileChars(): number {
  return cfg().get<number>('nextEdit.maxFileChars', 8000);
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
  const memo = keyCache.get(provider);
  if (memo) return memo;
  const stored = await secrets?.get(secretKey(provider));
  if (stored) {
    keyCache.set(provider, stored);
    return stored;
  }
  const fromEnv = process.env[ENV_KEYS[provider]];
  return fromEnv || undefined;
}

export async function storeApiKey(provider: ProviderId, value: string): Promise<void> {
  if (!secrets) return;
  keyCache.delete(provider);
  if (value) {
    await secrets.store(secretKey(provider), value);
  } else {
    await secrets.delete(secretKey(provider));
  }
}
