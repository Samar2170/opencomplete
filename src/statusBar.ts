import * as vscode from 'vscode';
import { getModel, getProvider, isEnabled } from './config';
import { formatMs } from './format';
import { CompletionMetrics } from './completionProvider';

const PROVIDER_LABEL: Record<string, string> = {
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

const ERROR_FLASH_MS = 4000;

export class StatusBar implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private busy = 0;
  private errorUntil = 0;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;
  private metrics: CompletionMetrics | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.name = 'OpenComplete';
    this.update();
    this.item.show();
  }

  setBusy(busy: boolean): void {
    this.busy = Math.max(0, this.busy + (busy ? 1 : -1));
    this.update();
  }

  setMetrics(metrics: CompletionMetrics): void {
    this.metrics = metrics;
    this.update();
  }

  onError(): void {
    this.errorUntil = Date.now() + ERROR_FLASH_MS;
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => this.update(), ERROR_FLASH_MS + 100);
    this.update();
  }

  update(): void {
    const model = getModel();
    const short = shortModel(model);
    const provider = PROVIDER_LABEL[getProvider()] ?? getProvider();
    if (!isEnabled()) {
      this.item.text = '$(circle-slash) OpenComplete';
      this.item.tooltip = this.tooltip(provider, model, 'Disabled — click to enable');
      this.item.command = 'opencomplete.toggle';
    } else if (Date.now() < this.errorUntil) {
      this.item.text = `$(error) ${short}`;
      this.item.tooltip = this.tooltip(provider, model, 'Last request failed — click to change model');
      this.item.command = 'opencomplete.pickModel';
    } else if (this.busy > 0) {
      this.item.text = `$(loading~spin) ${short}`;
      this.item.tooltip = this.tooltip(provider, model);
      this.item.command = 'opencomplete.pickModel';
    } else {
      this.item.text = `$(zap) ${short}`;
      this.item.tooltip = this.tooltip(provider, model, 'Click to change model');
      this.item.command = 'opencomplete.pickModel';
    }
  }

  private tooltip(provider: string, model: string, note?: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**OpenComplete** — ${provider} · \`${model}\``);
    if (this.metrics) {
      md.appendMarkdown(
        `\n\nLast request: ttft ${formatMs(this.metrics.ttft)} · total ${formatMs(this.metrics.total)}`,
      );
    }
    if (note) md.appendMarkdown(`\n\n${note}`);
    return md;
  }

  dispose(): void {
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.item.dispose();
  }
}

function shortModel(model: string): string {
  const tail = model.split('/').pop() ?? model;
  return tail.length > 18 ? tail.slice(0, 17) + '…' : tail;
}
