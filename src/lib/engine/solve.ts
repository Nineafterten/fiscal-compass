/**
 * Derived answers: the headline numbers the dashboard leads with.
 *
 * The central one is "how early can this household stop working and still fund
 * every year through `planEndAge`". Success is monotone in retirement age —
 * working longer never hurts a plan — so a binary search over candidate ages
 * finds the boundary in ~6 projections instead of 40.
 */

import type { Plan, ProjectionResult } from '../../types/plan';
import { project, type ProjectionOptions } from './project';

/** A projection runner — swapped for the Monte Carlo version by the worker. */
export type Evaluator = (plan: Plan, options: ProjectionOptions) => boolean;

/** The deterministic evaluator: did the single projected path survive? */
export const deterministicEvaluator: Evaluator = (plan, options) =>
  project(plan, options).succeeded;

export interface RetirementSolution {
  /** Earliest age the primary earner can retire and still fund the plan. */
  earliestAge?: number;
  /** True when even working to the search ceiling doesn't produce a solution. */
  infeasible: boolean;
  /** Ages actually tested, for the sensitivity chart. */
  searchedFrom: number;
  searchedTo: number;
}

/**
 * Binary-search the earliest workable retirement age.
 *
 * `evaluate` returns whether retiring at a given age funds the plan. Because
 * that's monotone, bisection is exact rather than a heuristic.
 */
export function solveEarliestRetirementAge(
  plan: Plan,
  evaluate: Evaluator = deterministicEvaluator,
  options: ProjectionOptions = {},
): RetirementSolution {
  const primary = plan.people[0];
  if (!primary) return { infeasible: true, searchedFrom: 0, searchedTo: 0 };

  const currentAge = plan.startYear - Number(primary.birthMonth.slice(0, 4));
  const low = Math.max(currentAge, 30);
  const high = 80;

  // If working to the ceiling still fails, no retirement age works.
  if (!evaluate(plan, { ...options, retirementAgeOverride: high })) {
    return { infeasible: true, searchedFrom: low, searchedTo: high };
  }

  // Already there?
  if (evaluate(plan, { ...options, retirementAgeOverride: low })) {
    return { earliestAge: low, infeasible: false, searchedFrom: low, searchedTo: high };
  }

  let lo = low; // known to fail
  let hi = high; // known to succeed
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (evaluate(plan, { ...options, retirementAgeOverride: mid })) hi = mid;
    else lo = mid;
  }

  return { earliestAge: hi, infeasible: false, searchedFrom: low, searchedTo: high };
}

/**
 * Success at every candidate retirement age, for the sensitivity curve. This
 * is the chart that actually answers "when can I retire" — a single number
 * hides how steep or forgiving the tradeoff is.
 */
export function retirementAgeCurve(
  plan: Plan,
  ages: number[],
  score: (plan: Plan, options: ProjectionOptions) => number,
): { age: number; score: number }[] {
  return ages.map((age) => ({
    age,
    score: score(plan, { retirementAgeOverride: age }),
  }));
}

// ---------------------------------------------------------------------------
// Headline metrics
// ---------------------------------------------------------------------------

export interface PlanMetrics {
  currentAge: number;
  netWorth: number;
  investableAssets: number;
  liquidAssets: number;
  /** Annual spending in today's dollars, excluding debt principal. */
  annualSpending: number;
  /** Portfolio needed to fund spending at the safe withdrawal rate. */
  fiNumber: number;
  /** Progress toward `fiNumber`, 0–1. */
  fiProgress: number;
  /** Months of spending covered by liquid accounts. */
  emergencyFundMonths: number;
  /** Savings ÷ gross income, including the employer match. */
  savingsRate: number;
  annualSavings: number;
  grossIncome: number;
  /**
   * Age at which contributions could stop entirely and the plan would still
   * fund itself — the direct measure of whether saving is being overdone.
   */
  coastAge?: number;
}

/**
 * First-year metrics, plus the two derived numbers (FI number and Coast age)
 * that turn a projection into a judgement about the present.
 */
export function computeMetrics(plan: Plan, projection: ProjectionResult): PlanMetrics {
  const primary = plan.people[0];
  const first = projection.rows[0];
  const currentAge = primary
    ? plan.startYear - Number(primary.birthMonth.slice(0, 4))
    : 0;

  const liquidAssets = plan.accounts
    .filter((acc) => ['checking', 'savings', 'hysa', 'cash'].includes(acc.type))
    .reduce((s, acc) => s + acc.balance, 0);

  // Debt principal is repayment, not consumption — it shouldn't inflate the
  // retirement target, since the debt is gone by then.
  const annualSpending = first ? first.spending - first.debtPrincipal : 0;
  const fiNumber =
    plan.assumptions.safeWithdrawalRate > 0
      ? annualSpending / plan.assumptions.safeWithdrawalRate
      : 0;

  const annualSavings = first ? first.contributions + first.employerMatch : 0;
  const grossIncome = first ? first.grossIncome : 0;

  return {
    currentAge,
    netWorth: first?.netWorth ?? 0,
    investableAssets: first?.investableAssets ?? 0,
    liquidAssets,
    annualSpending,
    fiNumber,
    fiProgress: fiNumber > 0 ? (first?.investableAssets ?? 0) / fiNumber : 0,
    emergencyFundMonths: annualSpending > 0 ? liquidAssets / (annualSpending / 12) : 0,
    savingsRate: grossIncome > 0 ? annualSavings / grossIncome : 0,
    annualSavings,
    grossIncome,
    coastAge: solveCoastAge(plan),
  };
}

/**
 * The age at which the household could stop contributing entirely and still
 * fund retirement on schedule — "Coast FI".
 *
 * If that age is already behind them, they are saving more than the plan
 * requires, which is worth knowing before deciding to save still more.
 * Stopping later is never worse than stopping earlier, so this bisects too.
 */
export function solveCoastAge(plan: Plan): number | undefined {
  const primary = plan.people[0];
  if (!primary) return undefined;

  const currentAge = plan.startYear - Number(primary.birthMonth.slice(0, 4));
  const retirementAge = primary.retirementAge;
  const works = (age: number): boolean =>
    project(plan, { contributionsStopAge: age }).succeeded;

  // Contributing right up to retirement is the best case. If even that fails,
  // there's no coast age to find.
  if (!works(retirementAge)) return undefined;
  if (works(currentAge)) return currentAge;

  let lo = currentAge; // known to fail
  let hi = retirementAge; // known to succeed
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (works(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}
