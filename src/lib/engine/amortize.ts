/**
 * Debt amortization.
 *
 * The projection runs annually, but debts are amortized *monthly and exactly*
 * here, then bucketed by year. That keeps payoff dates precise — an extra $200
 * a month can pull a payoff forward by more than a year, and that freed-up
 * cash flow is often the single biggest near-term swing in a plan — without
 * making the Monte Carlo pay for 12× the iterations.
 */

import type { Debt } from '../../types/plan';

export interface AmortizationYear {
  year: number;
  interest: number;
  principal: number;
  /** Total cash out the door: interest + principal. */
  payments: number;
  /** Balance remaining at the end of this year. */
  endingBalance: number;
}

export interface AmortizationSchedule {
  debtId: string;
  byYear: Map<number, AmortizationYear>;
  /** Calendar year the debt is retired, or `undefined` if it never is. */
  payoffYear?: number;
  /** 1-based month within `payoffYear`. */
  payoffMonth?: number;
  totalInterest: number;
  /** True when the payment doesn't cover the interest — a negative-am loan. */
  neverAmortizes: boolean;
}

/** Safety valve: 50 years of monthly payments. */
const MAX_MONTHS = 600;

/**
 * Build the year-by-year schedule for one debt.
 *
 * Payments begin in `startMonth` of `startYear` (default January). Getting the
 * starting month right is what makes computed payoff dates agree with a real
 * loan statement.
 */
export function amortizeDebt(
  debt: Debt,
  startYear: number,
  startMonth = 1,
): AmortizationSchedule {
  const byYear = new Map<number, AmortizationYear>();
  const monthlyRate = debt.apr / 12;
  const totalPayment = debt.monthlyPayment + debt.extraMonthlyPayment;

  let balance = debt.balance;
  let totalInterest = 0;
  let payoffYear: number | undefined;
  let payoffMonth: number | undefined;

  const ensureYear = (year: number): AmortizationYear => {
    let row = byYear.get(year);
    if (!row) {
      row = { year, interest: 0, principal: 0, payments: 0, endingBalance: balance };
      byYear.set(year, row);
    }
    return row;
  };

  // A payment that doesn't cover the first month's interest never retires the
  // debt. Record it and bail rather than looping to the cap.
  if (balance > 0 && totalPayment <= balance * monthlyRate) {
    const row = ensureYear(startYear);
    row.interest = balance * monthlyRate * 12;
    row.payments = totalPayment * 12;
    row.endingBalance = balance;
    return {
      debtId: debt.id,
      byYear,
      totalInterest: row.interest,
      neverAmortizes: true,
    };
  }

  // `startMonth` shifts the *calendar date* a payoff lands on, but not the
  // bucketing: every plan year holds a full twelve payments. Bucketing by
  // calendar year instead would make a mid-year start produce a stub first
  // year, which then drags down first-year spending and every metric derived
  // from it — the payoff date would be right and the budget would be wrong.
  const offset = Math.max(0, startMonth - 1);

  for (let m = 0; m < MAX_MONTHS && balance > 0.005; m++) {
    const year = startYear + Math.floor(m / 12);
    const row = ensureYear(year);

    const interest = balance * monthlyRate;
    // The last payment is partial — never overpay the remaining balance.
    const principal = Math.min(totalPayment - interest, balance);
    const payment = interest + principal;

    balance -= principal;
    totalInterest += interest;

    row.interest += interest;
    row.principal += principal;
    row.payments += payment;
    row.endingBalance = balance;

    if (balance <= 0.005) {
      // Absolute months elapsed since January of `startYear`, so the reported
      // date is a real calendar date rather than a plan-year index.
      const absolute = offset + m;
      payoffYear = startYear + Math.floor(absolute / 12);
      payoffMonth = (absolute % 12) + 1;
      balance = 0;
      row.endingBalance = 0;
    }
  }

  return { debtId: debt.id, byYear, payoffYear, payoffMonth, totalInterest, neverAmortizes: false };
}

export interface DebtSchedules {
  schedules: AmortizationSchedule[];
  /** Combined interest + principal across all debts for a given year. */
  paymentsIn(year: number): number;
  interestIn(year: number): number;
  principalIn(year: number): number;
  balanceAt(year: number): number;
}

export function buildDebtSchedules(
  debts: Debt[],
  startYear: number,
  startMonth = 1,
): DebtSchedules {
  const schedules = debts.map((d) => amortizeDebt(d, startYear, startMonth));

  const sum = (year: number, pick: (r: AmortizationYear) => number): number =>
    schedules.reduce((total, s) => {
      const row = s.byYear.get(year);
      return total + (row ? pick(row) : 0);
    }, 0);

  return {
    schedules,
    paymentsIn: (year) => sum(year, (r) => r.payments),
    interestIn: (year) => sum(year, (r) => r.interest),
    principalIn: (year) => sum(year, (r) => r.principal),
    balanceAt: (year) =>
      schedules.reduce((total, s) => {
        // Years after the last scheduled row mean the debt is gone; years
        // before the schedule starts mean it hasn't been drawn down yet.
        const years = [...s.byYear.keys()];
        if (!years.length) return total;
        const last = Math.max(...years);
        if (year >= last) return total + (s.byYear.get(last)?.endingBalance ?? 0);
        const row = s.byYear.get(year);
        return total + (row ? row.endingBalance : 0);
      }, 0),
  };
}

export interface PayoffMilestone {
  debtId: string;
  debtName: string;
  year: number;
  /** 1-based month within `year`. */
  month: number;
  /**
   * Monthly cash flow freed when the debt clears — the payment plus any extra
   * principal, all of which stops leaving the budget. For a mortgage this is
   * P&I only; escrow is a separate expense that continues.
   */
  freedMonthly: number;
}

/**
 * When each debt is retired and how much monthly cash flow that releases.
 *
 * A debt payoff isn't just an interest saving — it's the date a committed
 * chunk of monthly cash flow comes back and can go somewhere else. That
 * liberation is often the whole point of paying a loan down, and it deserves
 * to be visible rather than buried in a declining-balance line.
 */
export function debtPayoffMilestones(
  debts: Debt[],
  startYear: number,
  startMonth = 1,
): PayoffMilestone[] {
  const { schedules } = buildDebtSchedules(debts, startYear, startMonth);
  return schedules
    .map((s): PayoffMilestone | null => {
      const debt = debts.find((d) => d.id === s.debtId);
      if (!debt || s.payoffYear === undefined) return null;
      return {
        debtId: debt.id,
        debtName: debt.name,
        year: s.payoffYear,
        month: s.payoffMonth ?? 12,
        freedMonthly: debt.monthlyPayment + debt.extraMonthlyPayment,
      };
    })
    .filter((m): m is PayoffMilestone => m !== null)
    .sort((a, b) => a.year - b.year || a.month - b.month);
}

/**
 * Total interest saved by making an extra monthly payment, and how much sooner
 * the debt retires. Feeds the "extra principal vs. invest vs. cash buffer"
 * insight.
 */
export function extraPaymentImpact(
  debt: Debt,
  startYear: number,
  startMonth = 1,
): { interestSaved: number; monthsSaved: number } {
  if (debt.extraMonthlyPayment <= 0) return { interestSaved: 0, monthsSaved: 0 };

  const withExtra = amortizeDebt(debt, startYear, startMonth);
  const without = amortizeDebt({ ...debt, extraMonthlyPayment: 0 }, startYear, startMonth);

  const monthsOf = (s: AmortizationSchedule): number =>
    s.payoffYear === undefined
      ? MAX_MONTHS
      : (s.payoffYear - startYear) * 12 + (s.payoffMonth ?? 12);

  return {
    interestSaved: without.totalInterest - withExtra.totalInterest,
    monthsSaved: monthsOf(without) - monthsOf(withExtra),
  };
}
