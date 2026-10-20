import * as vscode from 'vscode';
import { LruCache } from './cache';
import {
  getContextLines,
  getDebounceMs,
  getEnabledLanguages,
  getMaxTokens,
  getModel,
  getPrefetchIdle,
  getPrefetchIdleMs,
  getPromptStyle,
  getTemperature,
  isEnabled,
  getNextEditEnabled,
  getNextEditFallback,
} from './config';
import { cleanCompletion } from './clean';
import { buildPrompt, windowContext } from './contextBuilder';
import { assembleExtras, displayPath } from './context';
import { createClient } from './providers';
import { ProviderError } from './providers/types';
import { detectIndent, validateCompletion } from './validate';
import { LocatedEdit, buildNextEditPrompt, diffEditHint, locateEdit, parseEditBlocks } from './nextEdit';

const CACHE_CAPACITY = 50;
const REQUEST_TIMEOUT_MS = 10000;
const NES_TIMEOUT_MS = 15000;
const NES_MAX_TOKENS = 400;
const ERROR_THROTTLE_MS = 30000;
const IDLE_SURFACE_MS = 800;
const PREFER_NES_MS = 2500;
const BACKOFF_MS = 10000;
const MAX_TRACKED_DOCS = 8;
const MAX_TRACKED_CHARS = 200000;

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
  position: vscode.Position;
  singleLine: boolean;
}

interface NesState {
  version: number;
  edits: LocatedEdit[];
}

export class OpenCompleteProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private cache = new LruCache<string>(CACHE_CAPACITY);
  private inflight = new Map<string, Promise<string | undefined>>();
  private current: CurrentRequest | undefined;
  private prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  private lastErrorAt = 0;
  private backoffUntil = 0;
  private busyCount = 0;

  private nesState = new Map<string, NesState>();
  private nesInflight = new Map<string, Promise<LocatedEdit[]>>();
  private lastEditAt = 0;
  private docText = new Map<string, string>();
  private renameHints = new Map<string, { hint: string; at: number }>();
  private lastNesSurface = '';
  private preferNesUntil = 0;

  constructor(private status: CompletionStatus) {}

  dispose(): void {
    this.cancelCurrent();
    if (this.prefetchTimer) clearTimeout(this.prefetchTimer);
  }

  clearCache(): void {
    this.cache.clear();
    this.nesState.clear();
    this.nesInflight.clear();
  }

  preferNes(): void {
    this.preferNesUntil = Date.now() + PREFER_NES_MS;
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
    const preferNes = Date.now() < this.preferNesUntil;

    if (preferNes) {
      const nesItems = await this.nesFallback(document, position, token);
      if (nesItems) return nesItems;
    }

    if (cached) return this.toItems(cached, position);
    if (Date.now() < this.backoffUntil) return undefined;

    const pending = this.inflight.get(ctx.key);
    if (pending) {
      const text = await pending;
      if (token.isCancellationRequested) return undefined;
      if (text) return this.toItems(text, position);
      return this.emptyFallback(document, position, token);
    }

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
      if (token.isCancellationRequested) return undefined;
      if (text) return this.toItems(text, position);
      return await this.emptyFallback(document, position, token);
    } finally {
      cancel.dispose();
    }
  }

  private emptyFallback(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!getNextEditFallback()) return Promise.resolve(undefined);
    return this.nesFallback(document, position, token);
  }

  onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    const document = event.document;
    const scheme = document.uri.scheme;
    if (scheme !== 'file' && scheme !== 'untitled') return;
    if (!event.contentChanges.length) return;

    this.lastEditAt = Date.now();
    this.trackEdit(event);
    const uri = document.uri.toString();
    const state = this.nesState.get(uri);
    if (state && state.version !== document.version) this.nesState.delete(uri);

    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) return;
    this.schedulePrefetch(document, editor.selection.active);
  }

  private trackEdit(event: vscode.TextDocumentChangeEvent): void {
    const document = event.document;
    const uri = document.uri.toString();
    const lastLine = document.lineCount - 1;
    const size = document.offsetAt(new vscode.Position(lastLine, document.lineAt(lastLine).text.length));
    if (size > MAX_TRACKED_CHARS) {
      this.docText.delete(uri);
      return;
    }
    const prev = this.docText.get(uri);
    const next = document.getText();
    this.docText.delete(uri);
    this.docText.set(uri, next);
    while (this.docText.size > MAX_TRACKED_DOCS) {
      const oldest = this.docText.keys().next().value;
      if (oldest === undefined) break;
      this.docText.delete(oldest);
      this.renameHints.delete(oldest);
    }
    if (prev === undefined || event.contentChanges.length !== 1) return;

    const change = event.contentChanges[0];
    const from = prev.lastIndexOf('\n', change.rangeOffset - 1) + 1;
    let toPrev = prev.indexOf('\n', change.rangeOffset + change.rangeLength);
    if (toPrev < 0) toPrev = prev.length;
    const startLine = change.range.start.line;
    const addedLines = change.text.split('\n').length - 1;
    const endLine = Math.min(document.lineCount - 1, startLine + addedLines);
    const nextSnippet = document.getText(
      new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length),
    );
    const hint = diffEditHint(prev.slice(from, toPrev), nextSnippet);
    if (hint) this.renameHints.set(uri, { hint, at: Date.now() });
  }

  onSelectionChanged(event: vscode.TextEditorSelectionChangeEvent): void {
    if (!event.selections.every((s) => s.isEmpty)) return;
    const scheme = event.textEditor.document.uri.scheme;
    if (scheme !== 'file' && scheme !== 'untitled') return;
    this.schedulePrefetch(event.textEditor.document, event.selections[0].active);
  }

  private schedulePrefetch(document: vscode.TextDocument, position: vscode.Position): void {
    if (this.prefetchTimer) {
      clearTimeout(this.prefetchTimer);
      this.prefetchTimer = undefined;
    }
    if (!getPrefetchIdle()) return;
    if (!isEnabled() || !this.languageAllowed(document)) return;
    if (position.line >= document.lineCount) return;
    if (position.character !== document.lineAt(position.line).text.length) return;

    const version = document.version;
    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = undefined;
      if (Date.now() < this.backoffUntil) return;
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== document || document.version !== version) return;
      if (!editor.selection.isEmpty || !editor.selection.active.isEqual(position)) return;

      const ctx = this.buildContext(document, position);
      if (!ctx.prefixRaw.trim() && !ctx.suffixRaw.trim()) return;
      if (this.cache.get(ctx.key) !== undefined || this.inflight.has(ctx.key)) return;

      this.cancelCurrent();
      const { controller, result } = this.startFetch(ctx, ctx.windowed.prefix, ctx.windowed.suffix);
      this.current = { controller, key: ctx.key };
      void result.then(async (text) => {
        if (text || document.version !== version) return;
        if (!getNextEditEnabled()) return;
        if (Date.now() - this.lastEditAt < IDLE_SURFACE_MS) return;
        const edits = await this.nesEdits(document, position);
        this.maybeSurfaceNes(document, position, edits);
      });
    }, Math.max(0, getPrefetchIdleMs()));
  }

  private maybeSurfaceNes(document: vscode.TextDocument, position: vscode.Position, edits: LocatedEdit[]): void {
    if (!edits.length) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) return;
    if (!editor.selection.active.isEqual(position)) return;
    const key = `${document.uri.toString()}|${document.version}|${edits[0].start}`;
    if (key === this.lastNesSurface) return;
    this.lastNesSurface = key;
    void vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
  }

  private buildContext(document: vscode.TextDocument, position: vscode.Position) {
    const lines = Math.max(1, getContextLines());
    const startLine = Math.max(0, position.line - lines);
    const endLine = Math.min(document.lineCount - 1, position.line + lines);
    const prefixRaw = document.getText(new vscode.Range(startLine, 0, position.line, position.character));
    const suffixRaw = document.getText(
      new vscode.Range(position, new vscode.Position(endLine, document.lineAt(endLine).text.length)),
    );
    const windowed = windowContext(prefixRaw, suffixRaw, lines);
    const offset = document.offsetAt(position);
    const key = `${document.uri.toString()}|${document.languageId}|${offset}|${windowed.prefix}|${windowed.suffix}`;
    const lineText = document.lineAt(position.line).text;
    const singleLine = lineText.slice(position.character).trim().length > 0;
    return {
      prefixRaw,
      suffixRaw,
      windowed,
      key,
      info: { document, position, singleLine } as FetchInfo,
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
        if (text) this.cache.set(key, text);
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
      const extras = assembleExtras(info.document, info.position, prefix, suffix);
      const { system, user } = buildPrompt({
        path: extras.path,
        language: info.document.languageId,
        imports: extras.imports,
        enclosing: extras.enclosing,
        symbols: extras.symbols,
        related: extras.related,
        prefix,
        suffix,
        model: getModel(),
        style: getPromptStyle(),
      });
      const startedAt = Date.now();
      let ttft: number | undefined;
      const raw = await client.complete({
        system,
        user,
        maxTokens: getMaxTokens(),
        temperature: getTemperature(),
        signal,
        singleLine: info.singleLine,
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

  private async nesFallback(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    if (!getNextEditEnabled() || !this.languageAllowed(document)) return undefined;
    const edits = await this.nesItems(document, position, token);
    return edits.length ? edits : undefined;
  }

  private async nesItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    const edits = await this.nesEdits(document, position, token);
    if (!edits.length) return [];
    return this.toNesItems(document, edits);
  }

  private async nesEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<LocatedEdit[]> {
    const uri = document.uri.toString();
    const state = this.nesState.get(uri);
    if (state && state.version === document.version) return state.edits;

    let pending = this.nesInflight.get(uri);
    if (!pending) {
      pending = this.fetchNextEdits(document, position, token);
      this.nesInflight.set(uri, pending);
      void pending.finally(() => {
        if (this.nesInflight.get(uri) === pending) this.nesInflight.delete(uri);
      });
    }
    await pending;
    if (token?.isCancellationRequested) return [];
    const fresh = this.nesState.get(uri);
    return fresh && fresh.version === document.version ? fresh.edits : [];
  }

  private async fetchNextEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    token?: vscode.CancellationToken,
  ): Promise<LocatedEdit[]> {
    const uri = document.uri.toString();
    const version = document.version;
    this.beginBusy();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NES_TIMEOUT_MS);
    const cancel = token?.onCancellationRequested(() => controller.abort());
    try {
      const client = await createClient();
      const cursorOffset = document.offsetAt(position);
      const hintRecord = this.renameHints.get(uri);
      if (hintRecord && Date.now() - hintRecord.at > 120000) this.renameHints.delete(uri);
      const { system, user } = buildNextEditPrompt({
        path: displayPath(document),
        language: document.languageId,
        text: document.getText(),
        cursorOffset,
        hint: hintRecord?.hint,
      });
      const raw = await client.complete({
        system,
        user,
        maxTokens: NES_MAX_TOKENS,
        temperature: getTemperature(),
        signal: controller.signal,
      });
      if (document.version !== version) return [];
      const blocks = parseEditBlocks(raw);
      const edits: LocatedEdit[] = [];
      const text = document.getText();
      for (const block of blocks) {
        const located = locateEdit(text, block, cursorOffset);
        if (!located) continue;
        edits.push(located);
        if (edits.length >= 4) break;
      }
      if (edits.length) this.nesState.set(uri, { version, edits });
      else this.nesState.set(uri, { version, edits: [] });
      return edits;
    } catch {
      return [];
    } finally {
      clearTimeout(timeout);
      cancel?.dispose();
      this.endBusy();
    }
  }

  private toNesItems(document: vscode.TextDocument, edits: LocatedEdit[]): vscode.InlineCompletionItem[] {
    const command: vscode.Command = { title: 'Suggest next edit', command: 'opencomplete.suggestNextEdit' };
    return edits.map((edit) => {
      const range = new vscode.Range(document.positionAt(edit.start), document.positionAt(edit.end));
      const item = new vscode.InlineCompletionItem(edit.text, range);
      item.command = command;
      return item;
    });
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
    if (err instanceof ProviderError && err.status === 429) this.backoffUntil = Date.now() + BACKOFF_MS;
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
