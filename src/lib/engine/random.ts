/**
 * Deterministic pseudo-random numbers.
 *
 * The simulation uses a *seeded* generator rather than `Math.random()` for two
 * reasons, and both matter more than they might sound:
 *
 *  1. **Stability.** A success probability that jitters by a point every time a
 *     slider moves is unreadable — you can't tell your change from the noise.
 *  2. **Fair comparison.** Every scenario is run against the *same* sequence of
 *     market conditions, so a difference between two plans is a difference in
 *     the plans, not in the weather they happened to draw.
 */

/**
 * mulberry32 — small, fast, and good enough for Monte Carlo. Not cryptographic,
 * and deliberately not: reproducibility is the whole point.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard normal draws via the Box–Muller transform.
 *
 * Returns a function producing N(0,1) values. The transform yields two
 * independent normals per pair of uniforms; the spare is cached.
 */
export function normalGenerator(seed: number): () => number {
  const uniform = mulberry32(seed);
  let spare: number | undefined;

  return function nextNormal(): number {
    if (spare !== undefined) {
      const value = spare;
      spare = undefined;
      return value;
    }
    // Guard against log(0).
    let u = uniform();
    while (u <= Number.EPSILON) u = uniform();
    const v = uniform();

    const magnitude = Math.sqrt(-2 * Math.log(u));
    spare = magnitude * Math.sin(2 * Math.PI * v);
    return magnitude * Math.cos(2 * Math.PI * v);
  };
}

/**
 * The percentile of a sorted array, by linear interpolation between the two
 * neighbouring ranks.
 */
export function percentileOfSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];

  const rank = (n - 1) * Math.min(1, Math.max(0, p));
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}
