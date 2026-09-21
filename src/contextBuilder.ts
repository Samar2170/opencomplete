export interface CodeContext {
  path: string;
  language: string;
  imports: string;
  enclosing: string;
  related: string;
  prefix: string;
  suffix: string;
}

const PREFIX_SHARE = 0.6;
const MAX_PREFIX_CHARS = 8000;
const MAX_SUFFIX_CHARS = 4000;

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
  const system = [
    'You are an inline code autocompletion engine inside a code editor.',
    'The user message contains code where <CURSOR/> marks the exact insertion point.',
    'The first character you output must be the very next character that belongs after the cursor.',
    'Never repeat code that already exists before or after <CURSOR/>.',
    'Output raw code only: no markdown, no code fences, no prose, no comments unless the user is writing one.',
    'Match the indentation and style of the surrounding lines. Keep it as short as useful, usually 1-5 lines.',
    'If nothing sensible can be inserted, output an empty string.',
  ].join('\n');

  const parts: string[] = [];
  parts.push(`<file path="${ctx.path}" language="${ctx.language}">`);
  if (ctx.imports) parts.push(`<imports>\n${ctx.imports}\n</imports>`);
  if (ctx.enclosing) parts.push(`<current function>\n${ctx.enclosing}\n</current function>`);
  if (ctx.related) parts.push(ctx.related);
  parts.push(`${ctx.prefix}<CURSOR/>${ctx.suffix}`);
  parts.push('</file>');
  return { system, user: parts.join('\n') };
}
