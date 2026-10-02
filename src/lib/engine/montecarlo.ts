/**
 * Monte Carlo simulation.
 *
 * The deterministic projection answers "what happens if returns are exactly
 * average every year", which is a scenario that has never once occurred. This
 * answers the question that actually matters: across many plausible sequences
 * of market conditions, how often does the money last?
 *
 * The difference is **sequence-of-returns risk**. Two retirements with the same
 * average return can end very differently depending on *when* the bad years
 * land — a crash in the first five years of drawdown is far more damaging than
 * the same crash twenty years later, because you sold into it. Averaging hides
 * that completely; this doesn't.
 */

import type { Plan } from '../../types/plan';
import { project, type ProjectionOptions } from './project';
import { normalGenerator, percentileOfSorted } from './random';

/**
 * Fixed by design — see `random.ts`. Every scenario draws the same market
 * conditions so comparisons are apples to apples.
 */
export const DEFAULT_SEED = 0x5eed;

export interface MonteCarloOptions extends ProjectionOptions {
  runs?: number;
  seed?: number;
  /** Called with 0–1 progress, for a worker to forward to the UI. */
  onProgress?: (fraction: number) => void;
}

export interface PercentileBand {
  year: number;
  primaryAge: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface MonteCarloResult {
  runs: number;
  /** Share of runs that funded every year through the end of the plan. */
  successProbability: number;
  /** Investable assets by year, as percentile bands across runs. */
  bands: PercentileBand[];
  /** Median age at which failing runs ran out. */
  medianDepletionAge?: number;
  /** Earliest depletion age seen in any failing run. */
  earliestDepletionAge?: number;
  finalPercentiles: { p10: number; p25: number; p50: number; p75: number; p90: number };
}

/**
 * Build one run's sequence of annual market shocks.
 *
 * A single standard-normal draw per year is applied to every account as
 * `expectedReturn + volatility * z`. That makes risky assets perfectly
 * correlated, which understates diversification and is therefore the
 * conservative direction to be wrong in — and it's honest about the fact that
 * in the crashes that actually threaten a retirement, correlations go to one.
 */
function buildShocks(years: number, nextNormal: () => number): number[] {
  const shocks = new Array<number>(years);
  for (let i = 0; i < years; i++) shocks[i] = nextNormal();
  return shocks;
}

export function runMonteCarlo(
  plan: Plan,
  options: MonteCarloOptions = {},
): MonteCarloResult {
  const runs = options.runs ?? plan.assumptions.simulationRuns ?? 1000;
  const nextNormal = normalGenerator(options.seed ?? DEFAULT_SEED);

  // One deterministic pass establishes the timeline shape.
  const shape = project(plan, options);
  const years = shape.rows.length;
  if (years === 0) {
    return {
      runs: 0,
      successProbability: 0,
      bands: [],
      finalPercentiles: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
    };
  }

  // Column-major: all runs for year 0, then all runs for year 1, ... so each
  // year's slice is contiguous and can be sorted in place for percentiles.
  const samples = new Float64Array(years * runs);
  const depletionAges: number[] = [];
  let successes = 0;

  for (let run = 0; run < runs; run++) {
    const marketShocks = buildShocks(years, nextNormal);
    const result = project(plan, { ...options, marketShocks });

    if (result.succeeded) successes++;
    else if (result.depletionYear !== undefined) {
      const row = result.rows.find((r) => r.year === result.depletionYear);
      if (row) depletionAges.push(row.primaryAge);
    }

    for (let y = 0; y < years; y++) {
      samples[y * runs + run] = result.rows[y]?.investableAssets ?? 0;
    }

    if (options.onProgress && (run & 31) === 0) {
      options.onProgress(run / runs);
    }
  }
  options.onProgress?.(1);

  // Percentile bands per year.
  const bands: PercentileBand[] = [];
  const scratch = new Float64Array(runs);
  for (let y = 0; y < years; y++) {
    scratch.set(samples.subarray(y * runs, y * runs + runs));
    scratch.sort();
    bands.push({
      year: shape.rows[y].year,
      primaryAge: shape.rows[y].primaryAge,
      p10: percentileOfSorted(scratch, 0.1),
      p25: percentileOfSorted(scratch, 0.25),
      p50: percentileOfSorted(scratch, 0.5),
      p75: percentileOfSorted(scratch, 0.75),
      p90: percentileOfSorted(scratch, 0.9),
    });
  }

  depletionAges.sort((a, b) => a - b);
  const last = bands[bands.length - 1];

  return {
    runs,
    successProbability: successes / runs,
    bands,
    medianDepletionAge: depletionAges.length
      ? percentileOfSorted(depletionAges, 0.5)
      : undefined,
    earliestDepletionAge: depletionAges[0],
    finalPercentiles: {
      p10: last.p10,
      p25: last.p25,
      p50: last.p50,
      p75: last.p75,
      p90: last.p90,
    },
  };
}

/**
 * Success probability alone, skipping the percentile bookkeeping.
 *
 * Used by the retirement-age curve, which needs one number per candidate age
 * and would otherwise allocate and sort a full sample matrix per point.
 */
export function successProbability(
  plan: Plan,
  options: MonteCarloOptions = {},
): number {
  const runs = options.runs ?? 500;
  const nextNormal = normalGenerator(options.seed ?? DEFAULT_SEED);
  const years = project(plan, options).rows.length;
  if (years === 0) return 0;

  let successes = 0;
  for (let run = 0; run < runs; run++) {
    const marketShocks = buildShocks(years, nextNormal);
    if (project(plan, { ...options, marketShocks }).succeeded) successes++;
  }
  return successes / runs;
}

export interface RetirementAgePoint {
  age: number;
  probability: number;
}

/**
 * Success probability at each candidate retirement age.
 *
 * This is the chart that actually answers "when can I retire" — a single age
 * hides whether the tradeoff is a cliff or a gentle slope, and that shape is
 * what tells you how much a year of working is really buying.
 */
export function retirementAgeCurve(
  plan: Plan,
  options: MonteCarloOptions & { fromAge?: number; toAge?: number; step?: number } = {},
): RetirementAgePoint[] {
  const primary = plan.people[0];
  if (!primary) return [];

  const currentAge = plan.startYear - Number(primary.birthMonth.slice(0, 4));
  const from = options.fromAge ?? Math.max(currentAge, 45);
  const to = options.toAge ?? 72;
  const step = options.step ?? 1;

  const points: RetirementAgePoint[] = [];
  const total = Math.floor((to - from) / step) + 1;
  let done = 0;

  for (let age = from; age <= to; age += step) {
    points.push({
      age,
      probability: successProbability(plan, {
        ...options,
        onProgress: undefined,
        retirementAgeOverride: age,
      }),
    });
    done++;
    options.onProgress?.(done / total);
  }
  return points;
}

/**
 * The earliest retirement age whose success probability clears the threshold.
 *
 * Probability is monotone in retirement age, so the crossing point is read
 * straight off the curve rather than searched for separately.
 */
export function earliestAgeMeeting(
  curve: RetirementAgePoint[],
  threshold: number,
): number | undefined {
  return curve.find((point) => point.probability >= threshold)?.age;
}
