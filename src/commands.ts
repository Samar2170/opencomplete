import * as vscode from 'vscode';
import { getApiKey, getModel, getProvider, storeApiKey } from './config';
import { fetchOpenRouterModels } from './providers/openrouter';
import { createClient } from './providers';
import { ProviderId } from './providers/types';

const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
];

const OTHER_ITEM = '$(pencil) Other…';

export async function setApiKeyCommand(): Promise<void> {
  const current = getProvider();
  const picked = await vscode.window.showQuickPick(
    PROVIDERS.map((p) => ({ label: p.label, id: p.id, picked: p.id === current })),
    { placeHolder: 'Which provider?' },
  );
  if (!picked) return;
  const existing = await getApiKey(picked.id);
  const key = await vscode.window.showInputBox({
    prompt: `Paste your ${picked.label} API key — stored securely in VS Code secret storage`,
    password: true,
    placeHolder: existing ? 'Leave empty to remove the stored key' : 'sk-or-v1-…',
    ignoreFocusOut: true,
  });
  if (key === undefined) return;
  const trimmed = key.trim();
  await storeApiKey(picked.id, trimmed);
  vscode.window.showInformationMessage(
    trimmed ? `OpenComplete: ${picked.label} key saved.` : `OpenComplete: ${picked.label} key removed.`,
  );
}

export async function pickModelCommand(): Promise<void> {
  const provider = getProvider();
  let models: Array<{ label: string; description?: string; detail?: string }> = [];
  try {
    const list =
      provider === 'openrouter' ? await fetchOpenRouterModels() : await (await createClient()).listModels();
    models = list
      .sort((a, b) => Number(b.free ?? false) - Number(a.free ?? false) || a.id.localeCompare(b.id))
      .map((m) => ({ label: m.id, description: m.free ? 'free' : undefined, detail: m.name }));
  } catch {
    models = [];
  }
  if (!models.length) {
    vscode.window.showWarningMessage('OpenComplete: could not fetch models — enter a model id manually.');
  }
  const picked = await vscode.window.showQuickPick([...models, { label: OTHER_ITEM, detail: 'Type any model id manually' }], {
    placeHolder: `Pick a completion model (${provider})`,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) return;
  let model = picked.label === OTHER_ITEM ? '' : picked.label;
  if (!model) {
    const typed = await vscode.window.showInputBox({
      prompt: 'Model id',
      value: getModel(),
      ignoreFocusOut: true,
    });
    if (!typed) return;
    model = typed.trim();
  }
  if (!model) return;
  await vscode.workspace.getConfiguration('opencomplete').update('model', model, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`OpenComplete: model set to ${model}`);
}

export async function toggleCommand(): Promise<void> {
  const config = vscode.workspace.getConfiguration('opencomplete');
  const next = !config.get<boolean>('enabled', true);
  await config.update('enabled', next, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`OpenComplete ${next ? 'enabled' : 'disabled'}.`);
}

export function suggestAtCursorCommand(): Thenable<unknown> {
  return vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
}

export function acceptNextWordCommand(): Thenable<unknown> {
  return vscode.commands.executeCommand('editor.action.inlineSuggest.acceptNextWord');
}
