import * as vscode from 'vscode';
import { LruCache } from './cache';
import {
  getContextLines,
  getDebounceMs,
  getEnabledLanguages,
  getMaxTokens,
  getPrefetchIdle,
  getPrefetchIdleMs,
  getTemperature,
  isEnabled,
} from './config';
import { cleanCompletion } from './clean';
import { buildPrompt, windowContext } from './contextBuilder';
import { assembleExtras } from './context';
import { createClient } from './providers';
import { detectIndent, validateCompletion } from './validate';

const CACHE_CAPACITY = 50;
const REQUEST_TIMEOUT_MS = 10000;
const ERROR_THROTTLE_MS = 30000;

export interface CompletionMetrics {
  ttft?: number;
  total: number;
}

export interface CompletionStatus {
  setBusy(busy: boolean): void;
  onError(): void;
  setMetrics(metrics: CompletionMetrics): void;
}

interface CurrentRequest {
  controller: AbortController;
  key: string;
}

interface FetchInfo {
  document: vscode.TextDocument;
  cursorLine: number;
  cursorOffset: number;
}

export class OpenCompleteProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private cache = new LruCache<string>(CACHE_CAPACITY);
  private inflight = new Map<string, Promise<string | undefined>>();
  private current: CurrentRequest | undefined;
  private prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  private lastErrorAt = 0;
  private busyCount = 0;

  constructor(private status: CompletionStatus) {}

  dispose(): void {
    this.cancelCurrent();
    if (this.prefetchTimer) clearTimeout(this.prefetchTimer);
  }

  clearCache(): void {
    this.cache.clear();
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!isEnabled() || !this.languageAllowed(document)) return undefined;
    const ctx = this.buildContext(document, position);
    if (!ctx.prefixRaw.trim() && !ctx.suffixRaw.trim()) return undefined;

    const cached = this.cache.get(ctx.key);
    if (cached !== undefined) return this.toItems(cached, position);

    const manual = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
    if (!manual) {
      await this.debounce(token);
      if (token.isCancellationRequested) return undefined;
    }

    this.cancelCurrent();
    const { controller, result } = this.startFetch(ctx, ctx.windowed.prefix, ctx.windowed.suffix);
    this.current = { controller, key: ctx.key };
    const cancel = token.onCancellationRequested(() => controller.abort());
    try {
      const text = await result;
      if (!text || token.isCancellationRequested) return undefined;
      return this.toItems(text, position);
    } finally {
      cancel.dispose();
    }
  }

  onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== event.document) return;
    this.schedulePrefetch(editor.document, editor.selection.active);
  }

  onSelectionChanged(event: vscode.TextEditorSelectionChangeEvent): void {
    if (!event.selections.every((s) => s.isEmpty)) return;
    this.schedulePrefetch(event.textEditor.document, event.selections[0].active);
  }

  private schedulePrefetch(document: vscode.TextDocument, position: vscode.Position): void {
    if (!getPrefetchIdle()) return;
    if (!isEnabled() || !this.languageAllowed(document)) return;
    if (position.character !== document.lineAt(position.line).text.length) return;

    const ctx = this.buildContext(document, position);
    if (!ctx.prefixRaw.trim() && !ctx.suffixRaw.trim()) return;
    if (this.cache.get(ctx.key) !== undefined || this.inflight.has(ctx.key)) return;

    if (this.prefetchTimer) clearTimeout(this.prefetchTimer);
    this.prefetchTimer = setTimeout(() => {
      if (this.cache.get(ctx.key) !== undefined || this.inflight.has(ctx.key)) return;
      this.cancelCurrent();
      const { controller, result } = this.startFetch(ctx, ctx.windowed.prefix, ctx.windowed.suffix);
      this.current = { controller, key: ctx.key };
      void result;
    }, Math.max(0, getPrefetchIdleMs()));
  }

  private buildContext(document: vscode.TextDocument, position: vscode.Position) {
    const whole = document.getText();
    const offset = document.offsetAt(position);
    const prefixRaw = whole.slice(0, offset);
    const suffixRaw = whole.slice(offset);
    const windowed = windowContext(prefixRaw, suffixRaw, getContextLines());
    const key = `${document.uri.toString()}|${document.languageId}|${windowed.prefix}`;
    return {
      prefixRaw,
      suffixRaw,
      windowed,
      key,
      info: { document, cursorLine: position.line, cursorOffset: offset } as FetchInfo,
    };
  }

  private languageAllowed(document: vscode.TextDocument): boolean {
    const languages = getEnabledLanguages();
    return languages.includes('*') || languages.includes(document.languageId);
  }

  private startFetch(
    ctx: { key: string; info: FetchInfo },
    prefix: string,
    suffix: string,
  ): { controller: AbortController; result: Promise<string | undefined> } {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const result = this.request(ctx.key, ctx.info, prefix, suffix, controller.signal).finally(() =>
      clearTimeout(timeout),
    );
    return { controller, result };
  }

  private request(
    key: string,
    info: FetchInfo,
    prefix: string,
    suffix: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const promise = this.fetchCompletion(info, prefix, suffix, signal)
      .then((text) => {
        this.cache.set(key, text ?? '');
        return text;
      })
      .catch((err: unknown) => {
        this.reportError(err);
        return undefined;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  private async fetchCompletion(
    info: FetchInfo,
    prefix: string,
    suffix: string,
    signal: AbortSignal,
  ): Promise<string | undefined> {
    this.beginBusy();
    try {
      const client = await createClient();
      const extras = assembleExtras(info.document, info.cursorLine, info.cursorOffset);
      const { system, user } = buildPrompt({
        path: extras.path,
        language: info.document.languageId,
        imports: extras.imports,
        enclosing: extras.enclosing,
        related: extras.related,
        prefix,
        suffix,
      });
      const startedAt = Date.now();
      let ttft: number | undefined;
      const raw = await client.complete({
        system,
        user,
        maxTokens: getMaxTokens(),
        temperature: getTemperature(),
        signal,
        onFirstToken: () => {
          ttft = Date.now() - startedAt;
        },
      });
      this.status.setMetrics({ ttft, total: Date.now() - startedAt });
      const cleaned = cleanCompletion(raw, prefix);
      return validateCompletion(cleaned, suffix, detectIndent(prefix));
    } finally {
      this.endBusy();
    }
  }

  private cancelCurrent(): void {
    if (!this.current) return;
    this.current.controller.abort();
    this.inflight.delete(this.current.key);
    this.current = undefined;
  }

  private debounce(token: vscode.CancellationToken): Promise<void> {
    const ms = getDebounceMs();
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let sub: vscode.Disposable | undefined;
      const done = () => {
        if (timer) clearTimeout(timer);
        sub?.dispose();
        resolve();
      };
      timer = setTimeout(done, ms);
      sub = token.onCancellationRequested(done);
    });
  }

  private beginBusy(): void {
    this.busyCount++;
    this.status.setBusy(true);
  }

  private endBusy(): void {
    this.busyCount = Math.max(0, this.busyCount - 1);
    if (this.busyCount === 0) this.status.setBusy(false);
  }

  private reportError(err: unknown): void {
    if (err instanceof Error && err.name === 'AbortError') return;
    this.status.onError();
    const message = err instanceof Error ? err.message : String(err);
    const now = Date.now();
    if (now - this.lastErrorAt < ERROR_THROTTLE_MS) return;
    this.lastErrorAt = now;
    void vscode.window.showErrorMessage(`OpenComplete: ${message}`);
  }

  private toItems(text: string, position: vscode.Position): vscode.InlineCompletionItem[] | undefined {
    if (!text) return undefined;
    return [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))];
  }
}
