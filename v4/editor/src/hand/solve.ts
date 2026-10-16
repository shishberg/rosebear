/** Root finding for the hand model. The iteration counts are part of each
 * caller's numerics (the presets are fitted to them), so each call passes its own. */

/** Halve [lo, hi] `n` times, keeping the side `below(mid)` says the root is above. */
export function halve(below: (x: number) => boolean, lo: number, hi: number, n: number) {
  for (let i = 0; i < n; i++) {
    const m = (lo + hi) / 2;
    if (below(m)) lo = m;
    else hi = m;
  }
  return [lo, hi] as const;
}

/** The x in [lo, hi] where the rising `f` reaches `target`, by bisection; the
 * end it stays past, if the target is out of range (`clamped`). */
export function bisect(
  f: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
  n: number,
) {
  if (f(lo) >= target) return { x: lo, clamped: true };
  if (f(hi) <= target) return { x: hi, clamped: true };
  const [a, b] = halve((x) => f(x) < target, lo, hi, n);
  return { x: (a + b) / 2, clamped: false };
}

/** Step from 0 by `step` while `below(x)` holds (to `limit` away), then
 * bisect the last step `n` times: the x where `below` stops holding. */
export function bracketThenBisect(
  below: (x: number) => boolean,
  step: number,
  limit: number,
  n: number,
) {
  let lo = 0,
    hi = 0;
  while (Math.abs(hi) < limit && below(hi)) [lo, hi] = [hi, hi + step];
  const [a, b] = halve(below, lo, hi, n);
  return (a + b) / 2;
}
