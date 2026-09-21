import * as vscode from 'vscode';
import { initSecrets, getModel } from './config';
import { OpenCompleteProvider } from './completionProvider';
import { StatusBar } from './statusBar';
import { runBenchmark } from './benchmark';
import {
  acceptNextWordCommand,
  pickModelCommand,
  setApiKeyCommand,
  suggestAtCursorCommand,
  toggleCommand,
} from './commands';

export function activate(context: vscode.ExtensionContext): void {
  initSecrets(context);
  const status = new StatusBar();
  const provider = new OpenCompleteProvider(status);

  context.subscriptions.push(
    status,
    provider,
    vscode.languages.registerInlineCompletionItemProvider([{ scheme: 'file' }, { scheme: 'untitled' }], provider),
    vscode.commands.registerCommand('opencomplete.setApiKey', () => setApiKeyCommand()),
    vscode.commands.registerCommand('opencomplete.pickModel', () => pickModelCommand()),
    vscode.commands.registerCommand('opencomplete.toggle', () => toggleCommand()),
    vscode.commands.registerCommand('opencomplete.suggestAtCursor', suggestAtCursorCommand),
    vscode.commands.registerCommand('opencomplete.acceptNextWord', acceptNextWordCommand),
    vscode.commands.registerCommand('opencomplete.benchmark', () => runBenchmark()),
    vscode.workspace.onDidChangeTextDocument((e) => provider.onDocumentChanged(e)),
    vscode.window.onDidChangeTextEditorSelection((e) => provider.onSelectionChanged(e)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('opencomplete')) {
        provider.clearCache();
        status.update();
      }
    }),
  );

  showFreeModelHint(context);
}

function showFreeModelHint(context: vscode.ExtensionContext): void {
  if (!getModel().endsWith(':free')) return;
  if (context.globalState.get('opencomplete.freeHintShown')) return;
  void context.globalState.update('opencomplete.freeHintShown', true);
  void vscode.window
    .showInformationMessage(
      'OpenComplete: free models often have slow first-token times. Run the benchmark to find a faster model.',
      'Run Benchmark',
    )
    .then((pick) => {
      if (pick) void vscode.commands.executeCommand('opencomplete.benchmark');
    });
}

export function deactivate(): void {}
