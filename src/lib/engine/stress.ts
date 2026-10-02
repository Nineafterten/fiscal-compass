/**
 * Stress tests.
 *
 * The Monte Carlo answers "how often does this work across many random
 * histories". These answer a different and more specific question: "what if
 * *this particular bad thing* happens?" — which is usually the question people
 * actually have, because worry is specific rather than statistical.
 *
 * Each scenario is expressed as a sequence of market shocks and inflation
 * overrides, so none of them require knowing your asset allocation.
 *
 * A note on the shock scale: a shock `z` produces `expectedReturn + volatility
 * × z` for each account. The named percentages below describe what that means
 * for a reference account at 7% expected return and 15% volatility — a
 * conservative account moves less, which is the point of holding one.
 */

import type { Plan, ProjectionResult } from '../../types/plan';
import { project, type ProjectionOptions } from './project';

/** Reference account used to translate a target return into a shock. */
const REFERENCE_RETURN = 0.07;
const REFERENCE_VOLATILITY = 0.15;

/** The shock that produces `targetReturn` on the reference account. */
function shockFor(targetReturn: number): number {
  return (targetReturn - REFERENCE_RETURN) / REFERENCE_VOLATILITY;
}

export interface StressScenario {
  id: string;
  name: string;
  /** One line, plain language — what is happening to you. */
  description: string;
  /** Why this particular shape of bad news matters. */
  rationale: string;
  build: (plan: Plan) => { plan: Plan; options: ProjectionOptions };
}

export interface StressResult {
  scenario: StressScenario;
  projection: ProjectionResult;
  succeeded: boolean;
  depletionAge?: number;
  finalNetWorth: number;
  /** Change in final net worth against the baseline, as a fraction. */
  vsBaseline: number;
}

/** Years from the plan start until the household retires. */
function yearsUntilRetirement(plan: Plan): number {
  const primary = plan.people[0];
  if (!primary) return 0;
  const currentAge = plan.startYear - Number(primary.birthMonth.slice(0, 4));
  return Math.max(0, primary.retirementAge - currentAge);
}

function horizon(plan: Plan): number {
  const youngest = Math.max(...plan.people.map((p) => Number(p.birthMonth.slice(0, 4))));
  return youngest + plan.assumptions.planEndAge - plan.startYear + 1;
}

export const STRESS_SCENARIOS: StressScenario[] = [
  {
    id: 'lost-decade',
    name: 'Lost decade',
    description: 'Markets go roughly nowhere in real terms for ten years, starting now.',
    rationale:
      'It has happened twice in living memory — 1966–1982 and 2000–2013 both delivered about a decade of flat real returns. A plan that only works on an uninterrupted upward line is not a plan.',
    build: (plan) => {
      const n = horizon(plan);
      const flat = shockFor(plan.assumptions.inflation);
      const marketShocks = Array.from({ length: n }, (_, i) => (i < 10 ? flat : 0));
      return { plan, options: { marketShocks } };
    },
  },
  {
    id: 'crash-at-retirement',
    name: 'Crash the year you retire',
    description: 'A 35% drop in the first year of retirement, then a 10% drop, then normal.',
    rationale:
      'The single worst timing for a downturn. Selling into a fall to fund living costs locks in the loss permanently, which is why the same crash is survivable at 45 and devastating at 65. This is sequence-of-returns risk at its sharpest.',
    build: (plan) => {
      const n = horizon(plan);
      const start = yearsUntilRetirement(plan);
      const marketShocks = Array.from({ length: n }, (_, i) => {
        if (i === start) return shockFor(-0.35);
        if (i === start + 1) return shockFor(-0.1);
        return 0;
      });
      return { plan, options: { marketShocks } };
    },
  },
  {
    id: 'bad-first-decade',
    name: 'Bad first decade of retirement',
    description: 'Returns run about four points below expectation for the first ten retirement years.',
    rationale:
      'Less dramatic than a crash and often more dangerous, because it does not feel like an emergency. Withdrawals continue against a portfolio that never recovers its footing.',
    build: (plan) => {
      const n = horizon(plan);
      const start = yearsUntilRetirement(plan);
      const weak = shockFor(0.03);
      const marketShocks = Array.from({ length: n }, (_, i) =>
        i >= start && i < start + 10 ? weak : 0,
      );
      return { plan, options: { marketShocks } };
    },
  },
  {
    id: 'stagflation',
    name: 'Stagflation',
    description: 'Inflation at 6% with weak returns for eight years.',
    rationale:
      'The combination that hurts most: spending rises faster while the portfolio funding it stalls. Fixed income offers no shelter, and the erosion is invisible in nominal terms — the balance still goes up while what it buys goes down.',
    build: (plan) => {
      const n = horizon(plan);
      const weak = shockFor(0.02);
      const marketShocks = Array.from({ length: n }, (_, i) => (i < 8 ? weak : 0));
      const inflationSequence = Array.from({ length: n }, (_, i) =>
        i < 8 ? 0.06 : plan.assumptions.inflation,
      );
      return { plan, options: { marketShocks, inflationSequence } };
    },
  },
  {
    id: 'basket-outruns-cpi',
    name: 'Your basket keeps outrunning CPI',
    description: 'Household costs rise 5.5% a year while the tax code indexes at official CPI.',
    rationale:
      'Headline CPI is a national average across all households; a family with a mortgage escrow, a commute, insurance and a teenager rarely matches it. Because tax brackets and contribution limits are indexed to the official figure, a persistent gap erodes spending power and tax treatment at the same time. Over a long plan it is often the most sensitive assumption of all — more so than raises, returns or retirement age.',
    build: (plan) => ({
      plan: {
        ...plan,
        assumptions: { ...plan.assumptions, householdInflation: 0.055 },
      },
      options: {},
    }),
  },
  {
    id: 'wage-stagnation',
    name: 'Raises keep trailing prices',
    description: 'Pay rises 2% a year while the household basket rises 4.5% — for a decade.',
    rationale:
      'No market event required, and easy to miss because nothing dramatic happens in any single year. Income simply buys less each year, savings capacity erodes with it, and the shortfall only becomes visible once it has compounded for a decade.',
    build: (plan) => ({
      plan: {
        ...plan,
        incomes: plan.incomes.map((income) =>
          income.type === 'salary'
            ? { ...income, nominalGrowthRate: 0.02, realGrowthRate: -0.02 }
            : income,
        ),
      },
      options: {},
    }),
  },
  {
    id: 'job-loss',
    name: 'A year out of work at 50',
    description: 'No salary for twelve months, with contributions paused and spending continuing.',
    rationale:
      'The most common financial shock there is, and the one an emergency fund exists for. The question this answers is not whether the retirement plan survives it, but what it costs — and how much of that cost falls on the portfolio because the cash buffer could not absorb it.',
    build: (plan) => {
      const primary = plan.people[0];
      const currentAge = primary
        ? plan.startYear - Number(primary.birthMonth.slice(0, 4))
        : 40;
      const gapYear = plan.startYear + Math.max(1, 50 - currentAge);
      return {
        // The year out is modeled as lost income, and the raise that year
        // never happens either — so pay resumes a step below where it would
        // have been rather than catching up.
        plan: {
          ...plan,
          incomes: plan.incomes.map((income) =>
            income.type === 'salary'
              ? { ...income, freezeYears: [...(income.freezeYears ?? []), gapYear, gapYear + 1] }
              : income,
          ),
        },
        options: { jobLossYears: [gapYear] },
      };
    },
  },
];

/** Run one scenario and compare it against the untouched plan. */
export function runStress(
  scenario: StressScenario,
  plan: Plan,
  baseline: ProjectionResult,
): StressResult {
  const { plan: stressedPlan, options } = scenario.build(plan);
  const projection = project(stressedPlan, options);

  const depletionRow = projection.depletionYear
    ? projection.rows.find((r) => r.year === projection.depletionYear)
    : undefined;

  return {
    scenario,
    projection,
    succeeded: projection.succeeded,
    depletionAge: depletionRow?.primaryAge,
    finalNetWorth: projection.finalNetWorth,
    vsBaseline:
      baseline.finalNetWorth !== 0
        ? (projection.finalNetWorth - baseline.finalNetWorth) / Math.abs(baseline.finalNetWorth)
        : 0,
  };
}

export function runAllStress(plan: Plan): StressResult[] {
  const baseline = project(plan);
  return STRESS_SCENARIOS.map((scenario) => runStress(scenario, plan, baseline));
}
