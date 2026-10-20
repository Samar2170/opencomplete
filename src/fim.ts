export interface FimTemplate {
  render(prefix: string, suffix: string): string;
}

const TEMPLATES: Array<{ re: RegExp; template: FimTemplate }> = [
  {
    re: /qwen2\.5-coder|codegemma/i,
    template: { render: (p, s) => `<|fim_prefix|>${p}<|fim_suffix|>${s}<|fim_middle|>` },
  },
  {
    re: /codestral/i,
    template: { render: (p, s) => `<[SUFFIX]>${s}<[PREFIX]>${p}<[MIDDLE]>` },
  },
  {
    re: /starcoder|codellama/i,
    template: { render: (p, s) => `<fim_prefix>${p}<fim_suffix>${s}<fim_middle>` },
  },
  {
    re: /deepseek-coder/i,
    template: { render: (p, s) => `<|fim\u2581begin|>${p}<|fim\u2581end|>${s}<|fim\u2581middle|>` },
  },
];

export function resolveFim(model: string | undefined): FimTemplate | undefined {
  if (!model) return undefined;
  return TEMPLATES.find((t) => t.re.test(model))?.template;
}

export const FIM_SYSTEM = [
  'You are a fill-in-the-middle code completion engine inside a code editor.',
  'The user message contains code wrapped in fill-in-the-middle markers.',
  'Output exactly the code that belongs at the middle position - nothing else.',
  'The first character you output must be the very next character that belongs after the prefix.',
  'Never repeat text from the prefix or the suffix; the suffix text must remain valid.',
  'Output raw code only: no markdown, no code fences, no prose, no comments unless the user is writing one.',
  'Match the indentation and style of the surrounding lines. Keep it as short as useful, usually 1-5 lines. If a single identifier or token completes the line, output just that.',
  'If nothing sensible can be inserted, output an empty string.',
].join('\n');
