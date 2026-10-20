import * as vscode from 'vscode';
import { getRelatedFileLines, getRelatedFiles } from './config';

export interface PromptExtras {
  path: string;
  imports: string;
  enclosing: string;
  symbols: string;
  related: string;
}

export interface RelatedSnippet {
  path: string;
  text: string;
}

const IMPORT_RES = [
  /^\s*(?:import\b|export\b[^;]*\bfrom\b|from\b[^;]*\bimport\b)/,
  /^\s*const\s+[\w{},\s*]+\s*=\s*require\s*\(/,
  /^\s*#include\b/,
  /^\s*using\s+[\w.<>]+\s*;/,
  /^\s*@import\b/,
  /^\s*require\s*\(/,
  /^\s*use\s+\w/,
  /^\s*extern\s+crate\b/,
];

const SYMBOL_RES = [
  /^\s*(?:@[\w.]+\s+)*(?:(?:export|default|declare|abstract|async|public|private|protected|internal|static|final|override|virtual|unsafe)\s+)*(?:class|interface|struct|enum|trait|impl|module|object)\b/,
  /^\s*(?:@[\w.]+\s+)*(?:(?:export|default|declare|public|private|protected|static|async|override|virtual)\s+)*(?:def|function|fn|func|sub|constructor|operator)\b/,
  /^\s*(?:export\s+)?(?:const|let|var|final|val)\s+\w+\s*[^=]*=\s*(?:async\s*)?(?:function\b|\([^)]*\)|[\w$]+)\s*(?:=>|\{)/,
  /^\s*(?:(?:public|private|protected|internal|static|final|abstract|async|override|virtual|sealed)\s+)*[\w<>\[\],?.]+\s+\w+\s*\([^;)]*\)\s*(?::\s*[\w<>\[\], ]+)?\s*\{/,
];

const DECL_RE =
  /\b(?:const|let|var|val|final|def|fn|func|function|class|interface|struct|enum|type|trait|record)\s+([A-Za-z_$][\w$]*)/g;
const IDENT_RE = /\b[A-Za-z_$][\w$]{2,}\b/g;

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'class', 'new',
  'import', 'export', 'from', 'def', 'self', 'this', 'super', 'true', 'false', 'null', 'none',
  'undefined', 'nil', 'async', 'await', 'try', 'catch', 'finally', 'switch', 'case', 'default',
  'break', 'continue', 'typeof', 'instanceof', 'extends', 'implements', 'static', 'public',
  'private', 'protected', 'interface', 'enum', 'struct', 'type', 'trait', 'record', 'lambda',
  'yield', 'throw', 'with', 'as', 'and', 'or', 'not', 'in', 'of', 'then', 'end', 'module',
  'require', 'include', 'namespace', 'using', 'void', 'int', 'float', 'double', 'char',
  'boolean', 'string', 'number', 'object', 'any', 'unknown', 'never', 'readonly', 'override',
  'abstract', 'sealed', 'final', 'val', 'fn', 'func', 'where', 'println', 'print', 'console',
  'log', 'length', 'push', 'map', 'filter', 'forEach', 'reduce', 'toString', 'valueOf',
]);

const MAX_IMPORT_LINES = 20;
const MAX_IMPORT_CHARS = 1500;
const MAX_SYMBOL_SCAN_LINES = 160;
const MAX_RELATED_FILES = 2;
const MAX_RELATED_CHARS = 2000;
const MAX_ENCLOSING_CHARS = 1600;
const MAX_SYMBOL_NAMES = 16;
const MAX_SYMBOL_CHARS = 700;

const MAX_IMPORT_SCAN_LINES = 150;
const MAX_LINE_LENGTH = 1000;
const SYMBOL_WINDOW_LINES = 1200;
const SYMBOL_LINES_BEFORE = 800;

export function assembleExtras(
  document: vscode.TextDocument,
  position: vscode.Position,
  windowedPrefix: string,
  windowedSuffix: string,
): PromptExtras {
  return {
    path: displayPath(document),
    imports: extractImports(document),
    enclosing: findEnclosing(document, position, windowedPrefix),
    symbols: collectSymbols(document, position, windowedPrefix, windowedSuffix),
    related: renderRelated(collectRelated(document)),
  };
}

function lineText(document: vscode.TextDocument, line: number): string {
  const text = document.lineAt(line).text;
  return text.length > MAX_LINE_LENGTH ? '' : text;
}

export function extractImports(document: vscode.TextDocument): string {
  const count = Math.min(document.lineCount, MAX_IMPORT_SCAN_LINES);
  const found: string[] = [];
  for (let i = 0; i < count; i++) {
    const line = lineText(document, i);
    if (!line.trim()) continue;
    if (IMPORT_RES.some((re) => re.test(line))) {
      found.push(line.trimEnd());
      if (found.length >= MAX_IMPORT_LINES) break;
    }
  }
  return found.join('\n').slice(0, MAX_IMPORT_CHARS);
}

export function findEnclosing(
  document: vscode.TextDocument,
  position: vscode.Position,
  windowedPrefix: string,
): string {
  const end = position.line;
  let blockStart = -1;
  for (let i = end; i >= 0 && i > end - MAX_SYMBOL_SCAN_LINES; i--) {
    let line = lineText(document, i);
    if (i === end) line = line.slice(0, position.character);
    if (SYMBOL_RES.some((re) => re.test(line))) {
      blockStart = i;
      break;
    }
  }
  if (blockStart < 0) return '';
  const winLines = windowedPrefix ? windowedPrefix.split('\n').length : 0;
  const winFirst = Math.max(0, end + 1 - winLines);
  if (blockStart >= winFirst) return '';
  const range = new vscode.Range(blockStart, 0, winFirst - 1, document.lineAt(winFirst - 1).range.end.character);
  return document.getText(range).slice(0, MAX_ENCLOSING_CHARS);
}

export function collectSymbols(
  document: vscode.TextDocument,
  position: vscode.Position,
  windowedPrefix: string,
  windowedSuffix: string,
): string {
  const cursorLine = position.line;
  const windowNames = new Set(matchAll(`${windowedPrefix}\n${windowedSuffix}`, IDENT_RE));

  let first = 0;
  let last = document.lineCount;
  if (last > SYMBOL_WINDOW_LINES) {
    first = Math.max(0, cursorLine - SYMBOL_LINES_BEFORE);
    last = Math.min(document.lineCount, first + SYMBOL_WINDOW_LINES);
    first = Math.max(0, last - SYMBOL_WINDOW_LINES);
  }

  interface Info {
    count: number;
    dist: number;
    after: boolean;
  }
  const declared = new Map<string, number>();
  const info = new Map<string, Info>();
  for (let i = first; i < last; i++) {
    const line = lineText(document, i);
    if (!line) continue;
    const dist = Math.abs(i - cursorLine);
    if (i <= cursorLine) {
      const declLine = i === cursorLine ? line.slice(0, position.character) : line;
      DECL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = DECL_RE.exec(declLine))) {
        const name = m[1];
        if (KEYWORDS.has(name) || declared.has(name)) continue;
        declared.set(name, dist);
      }
    }
    for (const name of matchAll(line, IDENT_RE)) {
      if (KEYWORDS.has(name)) continue;
      const rec = info.get(name);
      if (rec) {
        rec.count++;
        if (dist < rec.dist) rec.dist = dist;
        if (i >= cursorLine) rec.after = true;
      } else {
        info.set(name, { count: 1, dist, after: i >= cursorLine });
      }
    }
  }

  const scored: Array<{ name: string; score: number }> = [];
  for (const [name, rec] of info) {
    if (windowNames.has(name)) continue;
    const declDist = declared.get(name);
    if (rec.count < 2 && !(declDist !== undefined && declDist <= 40)) continue;
    let score = rec.count;
    if (declDist !== undefined) score += 8;
    if (declDist !== undefined && declDist <= 40) score += 4;
    if (rec.after) score += 2;
    score += 6 / (1 + rec.dist / 20);
    scored.push({ name, score });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const names = scored.slice(0, MAX_SYMBOL_NAMES).map((s) => s.name);
  return names.join(', ').slice(0, MAX_SYMBOL_CHARS);
}

function matchAll(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(re)) out.push(m[0]);
  return out;
}

export function collectRelated(document: vscode.TextDocument): RelatedSnippet[] {
  if (!getRelatedFiles()) return [];
  const maxLines = Math.max(5, getRelatedFileLines());
  const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
  const picked: RelatedSnippet[] = [];
  const seen = new Set<string>([document.uri.toString()]);
  for (let i = tabs.length - 1; i >= 0 && picked.length < MAX_RELATED_FILES; i--) {
    const input = tabs[i].input;
    if (!(input instanceof vscode.TabInputText)) continue;
    const uri = input.uri;
    if (seen.has(uri.toString())) continue;
    seen.add(uri.toString());
    const uriStr = uri.toString();
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uriStr);
    if (!doc || doc.languageId !== document.languageId) continue;
    const lastLine = Math.min(doc.lineCount, maxLines) - 1;
    const text = doc.getText(new vscode.Range(0, 0, lastLine, doc.lineAt(lastLine).range.end.character));
    if (text.trim()) picked.push({ path: displayPath(doc), text: truncateLines(text, MAX_RELATED_CHARS) });
  }
  return picked;
}

export function renderRelated(related: RelatedSnippet[]): string {
  return related.map((r) => `<related file="${r.path}">\n${r.text}\n</related>`).join('\n');
}

export function displayPath(document: vscode.TextDocument): string {
  if (document.uri.scheme === 'untitled') {
    return document.uri.path.split('/').pop() ?? 'untitled';
  }
  const ws = vscode.workspace.getWorkspaceFolder(document.uri);
  if (ws) {
    const base = ws.uri.path.replace(/\/$/, '');
    if (document.uri.path.startsWith(base + '/')) return document.uri.path.slice(base.length + 1);
  }
  return document.uri.fsPath;
}

function truncateLines(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).split('\n').slice(0, -1).join('\n');
}
