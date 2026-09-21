import * as vscode from 'vscode';
import { getRelatedFileLines, getRelatedFiles } from './config';

export interface PromptExtras {
  path: string;
  imports: string;
  enclosing: string;
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

const MAX_IMPORT_LINES = 20;
const MAX_IMPORT_CHARS = 1500;
const MAX_SYMBOL_SCAN_LINES = 120;
const MAX_RELATED_FILES = 2;
const MAX_RELATED_CHARS = 2000;

export function assembleExtras(
  document: vscode.TextDocument,
  cursorLine: number,
  cursorOffset: number,
): PromptExtras {
  const whole = document.getText();
  return {
    path: displayPath(document),
    imports: extractImports(whole),
    enclosing: findEnclosing(whole.slice(0, cursorOffset), cursorLine),
    related: renderRelated(collectRelated(document)),
  };
}

export function extractImports(text: string): string {
  const lines = text.split('\n').slice(0, 150);
  const found: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (IMPORT_RES.some((re) => re.test(line))) {
      found.push(line.trimEnd());
      if (found.length >= MAX_IMPORT_LINES) break;
    }
  }
  return found.join('\n').slice(0, MAX_IMPORT_CHARS);
}

export function findEnclosing(prefix: string, cursorLine: number): string {
  const lines = prefix.split('\n');
  const end = Math.min(cursorLine, lines.length - 1);
  for (let i = end; i >= 0 && i > end - MAX_SYMBOL_SCAN_LINES; i--) {
    if (SYMBOL_RES.some((re) => re.test(lines[i]))) {
      return lines[i].trimEnd().slice(0, 200);
    }
  }
  return '';
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
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (!doc || doc.languageId !== document.languageId) continue;
    const text = doc.getText().split('\n').slice(0, maxLines).join('\n');
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
