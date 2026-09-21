const OVERLAP_LIMIT = 1000;

export function cleanCompletion(raw: string, prefix: string): string {
  if (!raw) return '';
  let text = raw.replace(/\r\n/g, '\n');
  text = stripFences(text);
  text = cutArtifacts(text);
  text = trimOverlap(text, prefix);
  text = text.replace(/\s+$/, '');
  return text;
}

function stripFences(text: string): string {
  text = text.replace(/^\s*```[^\n]*\n/, '');
  const idx = text.indexOf('```');
  if (idx !== -1) text = text.slice(0, idx);
  return text;
}

function cutArtifacts(text: string): string {
  const cursor = text.indexOf('<CURSOR/>');
  if (cursor !== -1) return text.slice(0, cursor);
  const lines = text.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*(note|explanation|warning)\s*:/i.test(line)) break;
    if (/^\s*(i am sorry|i'm sorry|sure,|here('s| is) )/i.test(line)) break;
    kept.push(line);
  }
  return kept.join('\n');
}

function trimOverlap(text: string, prefix: string): string {
  const max = Math.min(text.length, prefix.length, OVERLAP_LIMIT);
  for (let k = max; k > 0; k--) {
    if (prefix.endsWith(text.slice(0, k))) return text.slice(k);
  }
  return text;
}
