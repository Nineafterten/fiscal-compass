import { describe, expect, it } from 'vitest';
import { earliestAgeMeeting, retirementAgeCurve, runMonteCarlo, successProbability } from './montecarlo';
import { mulberry32, normalGenerator, percentileOfSorted } from './random';
import type { Plan } from '../../types/plan';

function basePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'mc-test',
    name: 'MC test',
    startYear: 2026,
    people: [
      {
        id: 'p1',
        name: 'Test',
        birthMonth: '1986-01',
        retirementAge: 65,
        ssClaimAge: 67,
        ssMonthlyAtFra: 0,
      },
    ],
    accounts: [
      {
        id: 'acct',
        name: 'Portfolio',
        type: 'taxable',
        balance: 500_000,
        ownerId: 'p1',
        expectedReturn: 0.06,
        volatility: 0.15,
        monthlyContribution: 0,
        costBasisFraction: 1,
      },
    ],
    incomes: [],
    expenses: [{ id: 'e', name: 'Living', category: 'living', monthlyAmount: 2_000 }],
    debts: [],
    assets: [],
    windfalls: [],
    insurance: [],
    assumptions: {
      inflation: 0.02,
      ssHaircut: 1,
      planEndAge: 70,
      successThreshold: 0.85,
      withdrawalOrder: ['taxable', 'pretax', 'roth'],
      safeWithdrawalRate: 0.04,
      emergencyFundMonths: 6,
      retirementSpendingDrift: 0,
      simulationRuns: 200,
      stateCode: 'WA',
      filingStatus: 'single',
    },
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });

  it('produces different streams for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('stays within [0, 1)', () => {
    const next = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('normalGenerator', () => {
  it('approximates a standard normal', () => {
    const next = normalGenerator(123);
    const samples: number[] = [];
    for (let i = 0; i < 20_000; i++) samples.push(next());

    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance =
      samples.reduce((sum, x) => sum + (x - mean) ** 2, 0) / samples.length;

    expect(mean).toBeCloseTo(0, 1);
    expect(Math.sqrt(variance)).toBeCloseTo(1, 1);
  });

  it('is deterministic for a given seed', () => {
    const a = normalGenerator(9);
    const b = normalGenerator(9);
    for (let i = 0; i < 20; i++) expect(a()).toBe(b());
  });
});

describe('percentileOfSorted', () => {
  const sorted = [10, 20, 30, 40, 50];

  it('returns the endpoints at 0 and 1', () => {
    expect(percentileOfSorted(sorted, 0)).toBe(10);
    expect(percentileOfSorted(sorted, 1)).toBe(50);
  });

  it('returns the median at 0.5', () => {
    expect(percentileOfSorted(sorted, 0.5)).toBe(30);
  });

  it('interpolates between ranks', () => {
    // rank = 4 * 0.125 = 0.5, halfway between 10 and 20.
    expect(percentileOfSorted(sorted, 0.125)).toBe(15);
  });

  it('handles a single-element array', () => {
    expect(percentileOfSorted([42], 0.9)).toBe(42);
  });
});

describe('runMonteCarlo', () => {
  it('is reproducible across identical calls', () => {
    const plan = basePlan();
    const a = runMonteCarlo(plan, { runs: 100 });
    const b = runMonteCarlo(plan, { runs: 100 });
    expect(a.successProbability).toBe(b.successProbability);
    expect(a.bands[0].p50).toBe(b.bands[0].p50);
  });

  it('orders its percentile bands', () => {
    const result = runMonteCarlo(basePlan(), { runs: 200 });
    for (const band of result.bands) {
      expect(band.p10).toBeLessThanOrEqual(band.p25);
      expect(band.p25).toBeLessThanOrEqual(band.p50);
      expect(band.p50).toBeLessThanOrEqual(band.p75);
      expect(band.p75).toBeLessThanOrEqual(band.p90);
    }
  });

  it('reports a probability between 0 and 1', () => {
    const result = runMonteCarlo(basePlan(), { runs: 100 });
    expect(result.successProbability).toBeGreaterThanOrEqual(0);
    expect(result.successProbability).toBeLessThanOrEqual(1);
  });

  it('always succeeds when the portfolio dwarfs the spending', () => {
    const plan = basePlan({
      accounts: [
        {
          id: 'acct',
          name: 'Portfolio',
          type: 'taxable',
          balance: 50_000_000,
          ownerId: 'p1',
          expectedReturn: 0.06,
          volatility: 0.15,
          monthlyContribution: 0,
          costBasisFraction: 1,
        },
      ],
    });
    expect(runMonteCarlo(plan, { runs: 100 }).successProbability).toBe(1);
  });

  it('always fails when there is nothing to spend', () => {
    const plan = basePlan({
      accounts: [
        {
          id: 'acct',
          name: 'Portfolio',
          type: 'taxable',
          balance: 100,
          ownerId: 'p1',
          expectedReturn: 0.06,
          volatility: 0.15,
          monthlyContribution: 0,
          costBasisFraction: 1,
        },
      ],
    });
    const result = runMonteCarlo(plan, { runs: 50 });
    expect(result.successProbability).toBe(0);
    expect(result.medianDepletionAge).toBeDefined();
  });

  it('reports a lower probability than the deterministic path suggests', () => {
    // The point of the whole exercise: averaging returns hides
    // sequence-of-returns risk, so a plan that survives the average path can
    // still fail a meaningful share of realistic ones.
    const plan = basePlan({
      accounts: [
        {
          id: 'acct',
          name: 'Portfolio',
          type: 'taxable',
          balance: 700_000,
          ownerId: 'p1',
          expectedReturn: 0.06,
          volatility: 0.18,
          monthlyContribution: 0,
          costBasisFraction: 1,
        },
      ],
      assumptions: { ...basePlan().assumptions, planEndAge: 95 },
    });
    const probability = runMonteCarlo(plan, { runs: 300 }).successProbability;
    expect(probability).toBeGreaterThan(0);
    expect(probability).toBeLessThan(1);
  });

  it('handles a plan with no people', () => {
    const result = runMonteCarlo(basePlan({ people: [] }), { runs: 10 });
    expect(result.runs).toBe(0);
    expect(result.bands).toEqual([]);
  });

  it('reports higher volatility as a wider spread', () => {
    const narrow = runMonteCarlo(
      basePlan({
        accounts: [
          {
            id: 'acct', name: 'P', type: 'taxable', balance: 500_000, ownerId: 'p1',
            expectedReturn: 0.06, volatility: 0.02, monthlyContribution: 0, costBasisFraction: 1,
          },
        ],
      }),
      { runs: 200 },
    );
    const wide = runMonteCarlo(
      basePlan({
        accounts: [
          {
            id: 'acct', name: 'P', type: 'taxable', balance: 500_000, ownerId: 'p1',
            expectedReturn: 0.06, volatility: 0.25, monthlyContribution: 0, costBasisFraction: 1,
          },
        ],
      }),
      { runs: 200 },
    );

    const spread = (r: typeof narrow) =>
      r.finalPercentiles.p90 - r.finalPercentiles.p10;
    expect(spread(wide)).toBeGreaterThan(spread(narrow));
  });
});

describe('retirementAgeCurve', () => {
  const plan = basePlan({
    accounts: [
      {
        id: 'acct', name: 'P', type: 'taxable', balance: 300_000, ownerId: 'p1',
        expectedReturn: 0.06, volatility: 0.15, monthlyContribution: 500, costBasisFraction: 1,
      },
    ],
    incomes: [
      {
        id: 'i', name: 'Salary', type: 'salary', ownerId: 'p1',
        annualGross: 120_000, realGrowthRate: 0, subjectToFica: true,
      },
    ],
    assumptions: { ...basePlan().assumptions, planEndAge: 90 },
  });

  it('rises monotonically with retirement age', () => {
    // Working longer can never lower the probability. The whole read of this
    // chart — and the threshold crossing — depends on it.
    const curve = retirementAgeCurve(plan, { runs: 120, fromAge: 50, toAge: 70, step: 5 });
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].probability).toBeGreaterThanOrEqual(curve[i - 1].probability - 0.02);
    }
  });

  it('covers the requested age range at the requested step', () => {
    const curve = retirementAgeCurve(plan, { runs: 20, fromAge: 55, toAge: 65, step: 5 });
    expect(curve.map((p) => p.age)).toEqual([55, 60, 65]);
  });

  it('returns nothing for a plan with no people', () => {
    expect(retirementAgeCurve(basePlan({ people: [] }), { runs: 10 })).toEqual([]);
  });
});

describe('earliestAgeMeeting', () => {
  const curve = [
    { age: 55, probability: 0.3 },
    { age: 60, probability: 0.6 },
    { age: 65, probability: 0.88 },
    { age: 70, probability: 0.99 },
  ];

  it('finds the first age clearing the threshold', () => {
    expect(earliestAgeMeeting(curve, 0.85)).toBe(65);
    expect(earliestAgeMeeting(curve, 0.5)).toBe(60);
  });

  it('returns undefined when nothing clears it', () => {
    expect(earliestAgeMeeting(curve, 0.999)).toBeUndefined();
  });
});

describe('successProbability', () => {
  it('agrees with the full simulation at the same run count', () => {
    const plan = basePlan();
    const full = runMonteCarlo(plan, { runs: 150 }).successProbability;
    expect(successProbability(plan, { runs: 150 })).toBe(full);
  });
});
