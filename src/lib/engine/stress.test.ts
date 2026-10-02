import { describe, expect, it } from 'vitest';
import { SAMPLE_PLAN } from '../../data/profiles/sample';
import { project } from './project';
import { runStress, STRESS_SCENARIOS } from './stress';
import type { Plan } from '../../types/plan';

const scenario = (id: string) => STRESS_SCENARIOS.find((s) => s.id === id)!;
const basket = scenario('basket-outruns-cpi');
const stagflation = scenario('stagflation');
const wages = scenario('wage-stagnation');

function withInflation(inflation: number, householdInflation?: number): Plan {
  return {
    ...SAMPLE_PLAN,
    assumptions: { ...SAMPLE_PLAN.assumptions, inflation, householdInflation },
  };
}

const stressedBasket = (plan: Plan) => basket.build(plan).plan.assumptions.householdInflation;

describe('basket outruns CPI', () => {
  it('runs the basket at 5.5% while CPI is low', () => {
    expect(stressedBasket(withInflation(0.02))).toBe(0.055);
    expect(stressedBasket(withInflation(0.025))).toBe(0.055);
  });

  it('keeps the basket three points above CPI when CPI is high', () => {
    for (const cpi of [0.04, 0.055, 0.06]) {
      expect(stressedBasket(withInflation(cpi))).toBeCloseTo(cpi + 0.03, 10);
    }
  });

  it("never runs cooler than the plan's own basket", () => {
    expect(stressedBasket(withInflation(0.025, 0.07))).toBe(0.07);
  });

  it('is never a relief against the baseline', () => {
    for (const plan of [withInflation(0.025), withInflation(0.06), withInflation(0.025, 0.07)]) {
      expect(runStress(basket, plan, project(plan)).vsBaseline).toBeLessThanOrEqual(0);
    }
  });
});

describe('stagflation', () => {
  const inflationFor = (plan: Plan) => stagflation.build(plan).options.inflationSequence ?? [];

  it('runs inflation at 6% for eight years while CPI is low', () => {
    const sequence = inflationFor(withInflation(0.025));
    expect(sequence.slice(0, 8)).toEqual(Array.from({ length: 8 }, () => expect.closeTo(0.06, 10)));
    expect(sequence[8]).toBe(0.025);
  });

  it('keeps inflation 3.5 points above CPI when CPI is high', () => {
    const sequence = inflationFor(withInflation(0.06));
    expect(sequence[0]).toBeCloseTo(0.095, 10);
    expect(sequence[7]).toBeCloseTo(0.095, 10);
  });

  it('is never a relief against the baseline', () => {
    // Higher inflation inflates nominal balances; the comparison must see through that.
    for (const plan of [withInflation(0.025), withInflation(0.06)]) {
      expect(runStress(stagflation, plan, project(plan)).vsBaseline).toBeLessThan(0);
    }
  });
});

describe('a year out of work', () => {
  it('leaves pay two raises behind once work resumes', () => {
    // Both sample salaries grow 1% above CPI, the path that used to ignore freezes.
    const { plan, options } = scenario('job-loss').build(SAMPLE_PLAN);
    const resumed = (options.jobLossYears?.[0] ?? 0) + 2;
    const payIn = (rows: ReturnType<typeof project>['rows']) =>
      rows.find((r) => r.year === resumed)?.earnedIncome ?? 0;
    const raise = (1 + SAMPLE_PLAN.assumptions.inflation) * 1.01;
    expect(payIn(project(plan, options).rows)).toBeCloseTo(
      payIn(project(SAMPLE_PLAN).rows) / raise ** 2,
      2,
    );
  });
});

describe('stress comparison', () => {
  it("reports the final net worth in today's dollars", () => {
    const plan = withInflation(0.025);
    const result = runStress(stagflation, plan, project(plan));
    const last = result.projection.rows[result.projection.rows.length - 1];
    expect(last.householdPriceLevel).toBeGreaterThan(1);
    expect(result.finalNetWorthToday).toBeCloseTo(
      result.projection.finalNetWorth / last.householdPriceLevel,
      6,
    );
  });
});

describe('raises trail prices', () => {
  it('caps raises 2.5 points below household costs for ten years', () => {
    expect(wages.build(withInflation(0.025, 0.045)).options.raiseCaps).toEqual(
      Array.from({ length: 11 }, () => expect.closeTo(0.02, 10)),
    );
  });

  it('stops raises rather than cutting pay when costs rise less than 2.5%', () => {
    expect(wages.build(withInflation(0.015)).options.raiseCaps?.[1]).toBe(0);
  });

  it('restates salaries quoted above CPI without changing them', () => {
    // With the caps removed, the restated plan must project exactly as the original.
    const plan = withInflation(0.025);
    const restated = wages.build(plan).plan;
    expect(restated.incomes.every((i) => i.type !== 'salary' || i.nominalGrowthRate !== undefined)).toBe(true);
    expect(project(restated).finalNetWorth).toBeCloseTo(project(plan).finalNetWorth, 0);
  });

  it('restates from official CPI and keeps a raise already given in nominal terms', () => {
    const plan: Plan = {
      ...withInflation(0.025, 0.04),
      incomes: SAMPLE_PLAN.incomes.map((i, n) => (n === 1 ? { ...i, nominalGrowthRate: 0.05 } : i)),
    };
    const [restated, nominal] = wages.build(plan).plan.incomes;
    expect(restated.nominalGrowthRate).toBeCloseTo(1.025 * (1 + restated.realGrowthRate) - 1, 12);
    expect(nominal.nominalGrowthRate).toBe(0.05);
  });

  it('costs the plan something whatever the inflation assumption', () => {
    for (const plan of [withInflation(0.025), withInflation(0.06)]) {
      expect(runStress(wages, plan, project(plan)).vsBaseline).toBeLessThan(0);
    }
  });
});
