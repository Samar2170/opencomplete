export async function* sseData(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n');
      while (idx >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
        idx = buffer.indexOf('\n');
      }
    }
    const rest = (buffer + decoder.decode()).replace(/\r$/, '');
    if (rest.startsWith('data:')) yield rest.slice(5).trim();
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

export async function collectChatDelta(
  res: Response,
  maxChars: number,
  onFirstToken?: () => void,
): Promise<string> {
  let out = '';
  let first = false;
  for await (const data of sseData(res)) {
    if (data === '[DONE]') break;
    try {
      const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
      const delta = json.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) {
        if (!first) {
          first = true;
          onFirstToken?.();
        }
        out += delta;
      }
    } catch {
    }
    if (out.length >= maxChars) break;
  }
  return out;
}
