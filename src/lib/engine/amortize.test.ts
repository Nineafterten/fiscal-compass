import { describe, expect, it } from 'vitest';
import {
  amortizeDebt,
  buildDebtSchedules,
  debtPayoffMilestones,
  extraPaymentImpact,
} from './amortize';
import type { Debt } from '../../types/plan';

/**
 * A textbook 30-year, $300k mortgage at 6%. The exact payment is $1,798.6516;
 * rounded up to the cent it retires within 360 payments.
 */
const mortgage: Debt = {
  id: 'm',
  name: 'Mortgage',
  type: 'mortgage',
  balance: 300_000,
  apr: 0.06,
  monthlyPayment: 1_798.66,
  extraMonthlyPayment: 0,
};

describe('amortizeDebt', () => {
  it('retires a standard 30-year loan in year 30', () => {
    const schedule = amortizeDebt(mortgage, 2026);
    expect(schedule.payoffYear).toBe(2055); // 2026 + 29
    expect(schedule.payoffMonth).toBe(12);
    expect(schedule.neverAmortizes).toBe(false);
  });

  it('needs a stub payment when the payment is rounded down', () => {
    // Paying $1,798.65 instead of $1,798.6516 leaves a few dollars standing
    // after 360 payments — so a 361st payment lands in January of year 31.
    // Real servicers behave the same way; the schedule should too.
    const schedule = amortizeDebt({ ...mortgage, monthlyPayment: 1_798.65 }, 2026);
    expect(schedule.payoffYear).toBe(2056);
    expect(schedule.payoffMonth).toBe(1);
  });

  it('matches the published total interest for this loan', () => {
    // A $300,000 30-year loan at 6% costs $347,515 in interest. This is the
    // known-answer check against an external reference, not against ourselves.
    const schedule = amortizeDebt(mortgage, 2026);
    expect(schedule.totalInterest).toBeCloseTo(347_515, -2);
  });

  it("computes the first year's split correctly", () => {
    const schedule = amortizeDebt(mortgage, 2026);
    const first = schedule.byYear.get(2026)!;
    // Month one: 300,000 x 0.005 = 1,500 interest, 298.65 principal.
    expect(first.interest).toBeGreaterThan(first.principal);
    expect(first.interest + first.principal).toBeCloseTo(first.payments, 6);
    expect(first.payments).toBeCloseTo(1_798.66 * 12, 2);
  });

  it('never pays more than the outstanding balance on the last payment', () => {
    const schedule = amortizeDebt(mortgage, 2026);
    const final = schedule.byYear.get(schedule.payoffYear!)!;
    expect(final.endingBalance).toBe(0);

    const totalPrincipal = [...schedule.byYear.values()].reduce(
      (s, y) => s + y.principal,
      0,
    );
    expect(totalPrincipal).toBeCloseTo(300_000, 2);
  });

  it('flags a loan whose payment cannot cover the interest', () => {
    const underwater = amortizeDebt(
      { ...mortgage, monthlyPayment: 100, extraMonthlyPayment: 0 },
      2026,
    );
    expect(underwater.neverAmortizes).toBe(true);
    expect(underwater.payoffYear).toBeUndefined();
  });

  it('pays off a zero-interest loan in exactly balance / payment months', () => {
    const schedule = amortizeDebt(
      { ...mortgage, balance: 12_000, apr: 0, monthlyPayment: 1_000 },
      2026,
    );
    expect(schedule.payoffYear).toBe(2026);
    expect(schedule.payoffMonth).toBe(12);
    expect(schedule.totalInterest).toBeCloseTo(0, 6);
  });
});

describe('mid-year start', () => {
  const auto: Debt = {
    id: 'a',
    name: 'Auto',
    type: 'auto',
    balance: 24_000,
    apr: 0.06,
    monthlyPayment: 700,
    extraMonthlyPayment: 100,
  };

  it('reports the payoff in the right calendar month', () => {
    // $800 a month against $24,000 at 6% takes 32.6 payments by the standard
    // amortization formula, so the 33rd, counted from July 2026, is March 2029.
    const schedule = amortizeDebt(auto, 2026, 7);
    expect(schedule.payoffYear).toBe(2029);
    expect(schedule.payoffMonth).toBe(3);
  });

  it('moves the payoff date but not the payment count per year', () => {
    // The whole point of separating these: a stub first year would understate
    // first-year spending and every metric derived from it.
    const january = amortizeDebt(auto, 2026, 1);
    const july = amortizeDebt(auto, 2026, 7);

    expect(july.byYear.get(2026)!.payments).toBeCloseTo(
      january.byYear.get(2026)!.payments,
      6,
    );
    expect(july.totalInterest).toBeCloseTo(january.totalInterest, 6);
    // Same schedule, later calendar date.
    expect(january.payoffYear).toBe(2028);
    expect(january.payoffMonth).toBe(9);
  });

  it('defaults to January when no start month is given', () => {
    const implicit = amortizeDebt(auto, 2026);
    const explicit = amortizeDebt(auto, 2026, 1);
    expect(implicit.payoffYear).toBe(explicit.payoffYear);
    expect(implicit.payoffMonth).toBe(explicit.payoffMonth);
  });
});

describe('extra payments', () => {
  it('retires the loan sooner and saves interest', () => {
    const withExtra = amortizeDebt({ ...mortgage, extraMonthlyPayment: 300 }, 2026);
    const without = amortizeDebt(mortgage, 2026);

    expect(withExtra.payoffYear!).toBeLessThan(without.payoffYear!);
    expect(withExtra.totalInterest).toBeLessThan(without.totalInterest);
  });

  it('reports the impact of the extra payment', () => {
    const impact = extraPaymentImpact({ ...mortgage, extraMonthlyPayment: 300 }, 2026);
    expect(impact.interestSaved).toBeGreaterThan(0);
    expect(impact.monthsSaved).toBeGreaterThan(0);
  });

  it('reports no impact when there is no extra payment', () => {
    const impact = extraPaymentImpact(mortgage, 2026);
    expect(impact).toEqual({ interestSaved: 0, monthsSaved: 0 });
  });
});

describe('buildDebtSchedules', () => {
  const auto: Debt = {
    id: 'a',
    name: 'Auto',
    type: 'auto',
    balance: 29_000,
    apr: 0.06,
    monthlyPayment: 947,
    extraMonthlyPayment: 200,
  };

  it('sums payments across debts for a given year', () => {
    const schedules = buildDebtSchedules([mortgage, auto], 2026);
    const combined = schedules.paymentsIn(2026);
    expect(combined).toBeCloseTo((1_798.65 + 947 + 200) * 12, 0);
  });

  it('drops a debt from the totals after it is paid off', () => {
    const schedules = buildDebtSchedules([auto], 2026);
    const autoSchedule = schedules.schedules[0];
    const afterPayoff = autoSchedule.payoffYear! + 1;
    expect(schedules.paymentsIn(afterPayoff)).toBe(0);
    expect(schedules.balanceAt(afterPayoff)).toBe(0);
  });

  it('reports a declining balance over time', () => {
    const schedules = buildDebtSchedules([mortgage], 2026);
    expect(schedules.balanceAt(2030)).toBeLessThan(schedules.balanceAt(2027));
    expect(schedules.balanceAt(2027)).toBeLessThan(300_000);
  });

  it('handles an empty debt list', () => {
    const schedules = buildDebtSchedules([], 2026);
    expect(schedules.paymentsIn(2026)).toBe(0);
    expect(schedules.balanceAt(2026)).toBe(0);
  });
});

describe('debtPayoffMilestones', () => {
  const auto: Debt = {
    id: 'a',
    name: 'Auto',
    type: 'auto',
    balance: 24_000,
    apr: 0.06,
    monthlyPayment: 700,
    extraMonthlyPayment: 100,
  };

  it('reports the freed cash flow as the full payment plus extra', () => {
    const [m] = debtPayoffMilestones([auto], 2026, 7);
    // The whole $800 stops leaving the budget, not just the interest.
    expect(m.freedMonthly).toBeCloseTo(800, 2);
    expect(m.year).toBe(2029);
    expect(m.month).toBe(3);
  });

  it('sorts multiple debts by payoff date', () => {
    const milestones = debtPayoffMilestones([mortgage, auto], 2026, 7);
    expect(milestones[0].debtName).toBe('Auto'); // clears first
    expect(milestones[1].debtName).toBe('Mortgage');
    expect(milestones[0].year).toBeLessThanOrEqual(milestones[1].year);
  });

  it('omits a debt that never amortizes', () => {
    const underwater: Debt = { ...auto, monthlyPayment: 10, extraMonthlyPayment: 0 };
    expect(debtPayoffMilestones([underwater], 2026)).toHaveLength(0);
  });
});
