export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i];
  return s / xs.length;
}

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  if (q <= 0) return Math.min(...xs);
  if (q >= 1) return Math.max(...xs);
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}


