const MIN_TEXT_LEN = 2;
const MIN_SUFFIX_ECHO_LEN = 8;

export function validateCompletion(text: string, suffix: string, indentUnit: string | undefined): string {
  if (text.trim().length < MIN_TEXT_LEN) return '';
  text = cutSuffixEcho(text, suffix);
  text = stripOverClosed(text);
  text = trimBlankLines(text);
  if (!text.trim()) return '';
  if (indentUnit) text = normalizeIndent(text, indentUnit);
  return text;
}

export function detectIndent(text: string): string | undefined {
  let tabs = 0;
  let two = 0;
  let four = 0;
  for (const line of text.split('\n').slice(0, 300)) {
    const m = line.match(/^([ \t]+)\S/);
    if (!m) continue;
    const ws = m[1];
    if (ws.includes('\t')) tabs++;
    else if (ws.length % 4 === 0) four++;
    else if (ws.length % 2 === 0) two++;
  }
  if (tabs > two + four) return '\t';
  if (four > two) return '    ';
  if (two > 0 || four > 0) return '  ';
  return undefined;
}

function cutSuffixEcho(text: string, suffix: string): string {
  if (!suffix.trim()) return text;
  const suffixLines = new Set(
    suffix
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length >= MIN_SUFFIX_ECHO_LEN),
  );
  if (!suffixLines.size) return text;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 1; i--) {
    if (suffixLines.has(lines[i].trim())) return lines.slice(0, i).join('\n');
  }
  return text;
}

function stripOverClosed(text: string): string {
  let out = text;
  let depth = scanDepth(out).depth;
  while (depth < 0) {
    const { lastBracket } = scanDepth(out);
    if (lastBracket < 0) break;
    out = out.slice(0, lastBracket) + out.slice(lastBracket + 1);
    depth++;
  }
  return out;
}

function scanDepth(text: string): { depth: number; lastBracket: number } {
  let depth = 0;
  let quote: string | undefined;
  let blockComment = false;
  let lastBracket = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (blockComment) {
      if (c === '*' && n === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = undefined;
      continue;
    }
    if (c === '/' && n === '/') {
      const nl = text.indexOf('\n', i);
      if (nl === -1) break;
      i = nl;
      continue;
    }
    if (c === '/' && n === '*') {
      blockComment = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      lastBracket = i;
    }
  }
  return { depth, lastBracket };
}

function trimBlankLines(text: string): string {
  const lines = text.split('\n');
  while (lines.length > 1 && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n').replace(/\s+$/, '');
}

function normalizeIndent(text: string, unit: string): string {
  if (unit === '\t') {
    return text
      .split('\n')
      .map((l) => l.replace(/^( +)/, (m) => '\t'.repeat(Math.max(1, Math.floor(m.length / 4)))))
      .join('\n');
  }
  const width = unit.length;
  return text
    .split('\n')
    .map((l) => l.replace(/^(\t+)/, (m) => ' '.repeat(width * m.length)))
    .join('\n');
}
