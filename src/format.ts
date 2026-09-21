export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (!Number.isFinite(ms)) return 'timeout';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}
