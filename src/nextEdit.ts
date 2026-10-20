import { getNextEditMaxFileChars } from './config';

export interface EditBlock {
  before: string;
  after: string;
}

export interface LocatedEdit {
  start: number;
  end: number;
  text: string;
}

const MAX_EDIT_CHARS = 600;

export function buildNextEditPrompt(ctx: {
  path: string;
  language: string;
  text: string;
  cursorOffset: number;
  hint?: string;
}): { system: string; user: string } {
  const trimmed = trimAroundCursor(ctx.text, ctx.cursorOffset, getNextEditMaxFileChars());
  const user = [
    `<file path="${ctx.path}" language="${ctx.language}">`,
    trimmed,
    '</file>',
    ctx.hint ? `<latest change>${ctx.hint}</latest change>` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return { system: NEXT_EDIT_SYSTEM, user };
}

const cursorAnchor = '<CURSOR/>';

function trimAroundCursor(text: string, cursorOffset: number, budget: number): string {
  if (text.length <= budget) {
    return text.slice(0, cursorOffset) + cursorAnchor + text.slice(cursorOffset);
  }
  const beforeShare = Math.floor(budget * 0.6);
  const start = Math.max(0, cursorOffset - beforeShare);
  const end = Math.min(text.length, cursorOffset + (budget - beforeShare));
  const head = (start > 0 ? '...\n' : '') + text.slice(start, cursorOffset);
  const tail = text.slice(cursorOffset, end);
  return head + cursorAnchor + tail + (end < text.length ? '\n...' : '');
}

export const NEXT_EDIT_SYSTEM = [
  'You are a code edit predictor inside a code editor.',
  'The user message contains a file where <CURSOR/> marks the caret position, plus a note about the user\'s latest change.',
  'Predict edits that should follow from the latest change elsewhere in the file.',
  'Typical edits: usages of a renamed identifier, call sites that need a new argument, duplicated logic that must stay in sync, stale comments or values.',
  'Respond ONLY with edits in this exact format, most important edit first, at most 3 edits:',
  '<<<<<<< SEARCH',
  '<exact text copied verbatim from the file, unique within the file>',
  '=======',
  '<replacement text>',
  '>>>>>>> REPLACE',
  'Keep each SEARCH block short (1-5 lines) and copy it exactly, preserving indentation.',
  'Do not edit text immediately around the cursor - that is handled by a different mechanism.',
  'If no edit is needed, output an empty string.',
].join('\n');

export function parseEditBlocks(raw: string): EditBlock[] {
  if (!raw) return [];
  let text = raw.replace(/\r\n/g, '\n');
  text = text
    .split('\n')
    .filter((l) => !/^\s*```/.test(l))
    .join('\n');

  const blocks: EditBlock[] = [];
  let state: 'idle' | 'before' | 'after' = 'idle';
  let buf: string[] = [];
  let before = '';
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (/^<{3,9}\s*SEARCH/i.test(t)) {
      state = 'before';
      buf = [];
      before = '';
    } else if (state === 'before' && /^={3,9}\s*$/.test(t)) {
      before = tidyBlock(buf.join('\n'));
      buf = [];
      state = 'after';
    } else if (state === 'after' && /^>{3,9}/.test(t)) {
      if (before.trim()) blocks.push({ before, after: tidyBlock(buf.join('\n')) });
      buf = [];
      before = '';
      state = 'idle';
    } else if (state !== 'idle') {
      buf.push(line);
    }
  }
  return blocks;
}

function tidyBlock(text: string): string {
  const lines = text.split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
}

export function locateEdit(
  fileText: string,
  block: EditBlock,
  avoidOffset: number,
): LocatedEdit | undefined {
  const before = block.before;
  const after = block.after;
  if (!before.trim() || after.trim() === before.trim()) return undefined;
  if (after.length > MAX_EDIT_CHARS) return undefined;

  let start = -1;
  let end = -1;
  const exact = findAll(fileText, before);
  if (exact.length === 1) {
    start = exact[0];
    end = start + before.length;
  } else {
    const fuzzy = fuzzyFind(fileText, before);
    if (!fuzzy) return undefined;
    start = fuzzy.start;
    end = fuzzy.end;
  }

  if (start <= avoidOffset && avoidOffset <= end) return undefined;
  const editLine = countLines(fileText, start);
  const cursorLine = countLines(fileText, avoidOffset);
  if (Math.abs(editLine - cursorLine) <= 1) return undefined;
  return { start, end, text: after };
}

function countLines(text: string, offset: number): number {
  let lines = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') lines++;
  }
  return lines;
}

function findAll(text: string, needle: string): number[] {
  const out: number[] = [];
  let idx = text.indexOf(needle);
  while (idx !== -1 && out.length < 8) {
    out.push(idx);
    idx = text.indexOf(needle, idx + needle.length);
  }
  return out;
}

function fuzzyFind(text: string, needle: string): { start: number; end: number } | undefined {
  if (!needle.trim()) return undefined;
  const lines = tidyBlock(needle).split('\n').map((l) => l.trim());
  if (!lines.length) return undefined;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = lines.map((l) => `${esc(l)}`).join('\\n\\s*');
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch {
    return undefined;
  }
  const m = re.exec(text);
  if (!m) return undefined;
  return { start: m.index, end: m.index + m[0].length };
}

const TOKEN_RE = /[A-Za-z_$][\w$]*|\d+|\s+|[^\s\w$]+/g;

export function diffEditHint(prev: string, next: string): string | undefined {
  if (prev === next) return undefined;
  const pt = prev.match(TOKEN_RE) ?? [];
  const nt = next.match(TOKEN_RE) ?? [];
  let start = 0;
  while (start < pt.length && start < nt.length && pt[start] === nt[start]) start++;
  let endP = pt.length;
  let endN = nt.length;
  while (endP > start && endN > start && pt[endP - 1] === nt[endN - 1]) {
    endP--;
    endN--;
  }
  const removed = pt.slice(start, endP).join('');
  const added = nt.slice(start, endN).join('');
  if (!removed && !added) return undefined;

  const ident = /^[A-Za-z_$][\w$]*$/;
  if (ident.test(removed) && ident.test(added) && removed !== added) {
    return `the user just renamed "${removed}" to "${added}" - update other usages of the old name`;
  }
  const r = removed.trim();
  const a = added.trim();
  if (!/\S/.test(r) && !/\S/.test(a)) return undefined;
  if (r.length + a.length <= 120) {
    return `the user just changed ${JSON.stringify(r)} to ${JSON.stringify(a)}`;
  }
  return undefined;
}
