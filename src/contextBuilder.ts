import { resolveFim, FIM_SYSTEM } from './fim';

export interface CodeContext {
  path: string;
  language: string;
  imports: string;
  enclosing: string;
  symbols: string;
  related: string;
  prefix: string;
  suffix: string;
  model?: string;
  style?: 'auto' | 'chat' | 'fim';
}

const PREFIX_SHARE = 0.75;
const MAX_PREFIX_CHARS = 16000;
const MAX_SUFFIX_CHARS = 8000;

export function windowContext(
  prefix: string,
  suffix: string,
  maxLines: number,
): { prefix: string; suffix: string } {
  const keepBefore = Math.max(1, Math.floor(maxLines * PREFIX_SHARE));
  const keepAfter = Math.max(1, Math.ceil(maxLines * (1 - PREFIX_SHARE)));
  let p = lastLines(prefix, keepBefore);
  let s = firstLines(suffix, keepAfter);
  if (p.length > MAX_PREFIX_CHARS) p = p.slice(-MAX_PREFIX_CHARS);
  if (s.length > MAX_SUFFIX_CHARS) s = s.slice(0, MAX_SUFFIX_CHARS);
  return { prefix: p, suffix: s };
}

function lastLines(text: string, count: number): string {
  const lines = text.split('\n');
  return lines.slice(-count).join('\n');
}

function firstLines(text: string, count: number): string {
  const lines = text.split('\n');
  return lines.slice(0, count).join('\n');
}

export function buildPrompt(ctx: CodeContext): { system: string; user: string } {
  const fim = ctx.style === 'chat' ? undefined : resolveFim(ctx.model);
  if (fim) {
    const head = extrasBlock(ctx);
    const prefix = head ? `${head}\n${ctx.prefix}` : ctx.prefix;
    return { system: FIM_SYSTEM, user: fim.render(prefix, ctx.suffix) };
  }
  return { system: CHAT_SYSTEM, user: chatUser(ctx) };
}

function extrasBlock(ctx: CodeContext): string {
  const parts: string[] = [];
  if (ctx.imports) parts.push(`<imports>\n${ctx.imports}\n</imports>`);
  if (ctx.enclosing) parts.push(`<current function>\n${ctx.enclosing}\n</current function>`);
  if (ctx.symbols) parts.push(`<symbols>${ctx.symbols}</symbols>`);
  if (ctx.related) parts.push(ctx.related);
  return parts.join('\n');
}

function chatUser(ctx: CodeContext): string {
  const parts: string[] = [];
  parts.push(`<file path="${ctx.path}" language="${ctx.language}">`);
  const head = extrasBlock(ctx);
  if (head) parts.push(head);
  parts.push(`${ctx.prefix}<CURSOR/>${ctx.suffix}`);
  parts.push('</file>');
  return parts.join('\n');
}

const CHAT_SYSTEM = [
  'You are an inline code autocompletion engine inside a code editor.',
  'The user message contains code where <CURSOR/> marks the exact insertion point.',
  'The first character you output must be the very next character that belongs after the cursor.',
  'Never repeat code that already exists before or after <CURSOR/>.',
  'The text after <CURSOR/> must stay valid: if your suggestion would reproduce lines that already follow the cursor, stop before them.',
  'Output raw code only: no markdown, no code fences, no prose, no comments unless the user is writing one.',
  'Match the indentation and style of the surrounding lines. Keep it as short as useful, usually 1-5 lines. If a single identifier or token completes the line, output just that.',
  'The <symbols> block lists identifiers defined elsewhere in the file (possibly outside the visible window) - reuse the exact spelling when they fit.',
  'If nothing sensible can be inserted, output an empty string.',
].join('\n');
