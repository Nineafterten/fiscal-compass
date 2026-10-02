import { describe, expect, it } from 'vitest';
import { SAMPLE_PLAN } from '../../data/profiles/sample';
import { project } from './project';
import { runStress, STRESS_SCENARIOS } from './stress';
import type { Plan } from '../../types/plan';

const basket = STRESS_SCENARIOS.find((s) => s.id === 'basket-outruns-cpi')!;

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
