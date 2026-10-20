import * as vscode from 'vscode';
import { getApiKey, getModel, getProvider } from './config';
import { createClientFor } from './providers';
import { fetchOpenRouterModels } from './providers/openrouter';
import { CHAT_MODELS } from './providers/openai';
import { MODELS } from './providers/anthropic';
import { ProviderId } from './providers/types';
import { formatMs } from './format';
import { NEXT_EDIT_SYSTEM, parseEditBlocks } from './nextEdit';

const CANDIDATE_RE = /(coder|code|codestral|devstral|deepseek|glm|qwen|haiku|flash|mini|sonnet|kimi|gemini|laguna|poolside|north)/i;
const MAX_CANDIDATES = 12;
const SAMPLES = 2;
const SAMPLE_TIMEOUT_MS = 8000;
const QUALITY_TIMEOUT_MS = 20000;
const MAX_BENCH_TOKENS = 48;

const BENCH_SYSTEM = 'You are an inline code autocompletion engine. Output ONLY the raw code to insert. No markdown, no prose.';
const BENCH_USER = [
  '<file language="typescript">',
  'function binarySearch(arr: number[], target: number): number {',
  '  let lo = 0;',
  '  let hi = arr.length - 1;',
  '  <CURSOR/>',
  '}',
  '</file>',
].join('\n');

interface BenchResult {
  id: string;
  free: boolean;
  ttfts: number[];
  totals: number[];
  errors: number;
  renameFixes?: number;
}

const QUALITY_USER = [
  '<file path="profile.ts" language="typescript">',
  'function getProfile(db: Database, id: string) {',
  '  const account = db.users.find(id);',
  '  if (!account) throw new Error("not found");',
  '  return {',
  '    name: user.name,',
  '    ref: user.id,',
  '  };',
  '}',
  '<CURSOR/>',
  '</file>',
  '<latest change>the user just renamed "user" to "account" - update other usages of the old name</latest change>',
].join('\n');

export async function runBenchmark(): Promise<void> {
  const provider = getProvider();
  const apiKey = await getApiKey(provider);
  if (!apiKey) {
    void vscode.window.showErrorMessage(
      `OpenComplete: no API key for ${provider}. Run "OpenComplete: Set API Key" first.`,
    );
    return;
  }
  const current = getModel();
  const freeSet = new Set<string>();
  let pool: string[] = [];
  if (provider === 'openrouter') {
    try {
      const models = await fetchOpenRouterModels();
      for (const m of models) {
        if (m.free) freeSet.add(m.id);
        if (CANDIDATE_RE.test(m.id)) pool.push(m.id);
      }
    } catch {
      pool = [];
    }
  } else if (provider === 'openai') {
    pool = [...CHAT_MODELS];
  } else {
    pool = [...MODELS];
  }
  const candidates = [current, ...pool.filter((id) => id !== current)].slice(0, MAX_CANDIDATES);
  if (candidates.length <= 1 && !pool.length) {
    void vscode.window.showWarningMessage('OpenComplete: no benchmark candidates found.');
    return;
  }

  const results: BenchResult[] = [];
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'OpenComplete: benchmarking models',
      cancellable: true,
    },
    async (progress, token) => {
      for (let i = 0; i < candidates.length; i++) {
        if (token.isCancellationRequested) break;
        const id = candidates[i];
        progress.report({ message: `${id} (${i + 1}/${candidates.length})`, increment: 100 / candidates.length });
        results.push(await benchModel(provider, apiKey, id, freeSet.has(id)));
      }
    },
  );

  const ranked = results.sort(
    (a, b) => b.renameFixes! - a.renameFixes! || a.errors - b.errors || median(a.ttfts) - median(b.ttfts),
  );
  const items = ranked.map((r) => ({
    label: r.id,
    description: `${r.free ? 'free · ' : ''}ttft ${formatMs(median(r.ttfts))} · total ${formatMs(
      median(r.totals),
    )} · rename fixes ${r.renameFixes ?? '?'}/2`,
    detail: r.errors ? `${r.errors} of ${SAMPLES} samples failed` : undefined,
    id: r.id,
  }));
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Fastest first — pick a model to switch to it',
    matchOnDescription: true,
  });
  if (!picked) return;
  await vscode.workspace.getConfiguration('opencomplete').update('model', picked.id, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(`OpenComplete: model set to ${picked.id}`);
}

async function benchModel(provider: ProviderId, apiKey: string, id: string, free: boolean): Promise<BenchResult> {
  const client = createClientFor(provider, apiKey, id);
  const ttfts: number[] = [];
  const totals: number[] = [];
  let errors = 0;
  await Promise.all(
    Array.from({ length: SAMPLES }, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SAMPLE_TIMEOUT_MS);
      const started = Date.now();
      let ttft: number | undefined;
      try {
        await client.complete({
          system: BENCH_SYSTEM,
          user: BENCH_USER,
          maxTokens: MAX_BENCH_TOKENS,
          temperature: 0.1,
          signal: controller.signal,
          onFirstToken: () => {
            if (ttft === undefined) ttft = Date.now() - started;
          },
        });
        totals.push(Date.now() - started);
        if (ttft !== undefined) ttfts.push(ttft);
      } catch {
        errors++;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const renameFixes = await benchQuality(client);
  return { id, free, ttfts, totals, errors, renameFixes };
}

async function benchQuality(client: ReturnType<typeof createClientFor>): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QUALITY_TIMEOUT_MS);
  try {
    const raw = await client.complete({
      system: NEXT_EDIT_SYSTEM,
      user: QUALITY_USER,
      maxTokens: 400,
      temperature: 0.1,
      signal: controller.signal,
    });
    const blocks = parseEditBlocks(raw);
    return blocks.filter((b) => b.before.includes('user.') && b.after.includes('account.')).length;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

function median(nums: number[]): number {
  if (!nums.length) return Number.POSITIVE_INFINITY;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
