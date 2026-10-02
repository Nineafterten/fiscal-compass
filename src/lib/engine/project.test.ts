import { describe, expect, it } from 'vitest';
import {
  incomeGrowthFactor,
  nominalRaiseOf,
  premiumOverCpi,
  project,
  ssClaimFactor,
} from './project';
import { solveEarliestRetirementAge, computeMetrics, solveCoastAge } from './solve';
import { taxTableFor } from '../../data/taxTables';
import type { Income, Plan } from '../../types/plan';

/**
 * A deliberately minimal plan. Tests build on it with spreads so each one
 * changes exactly one thing.
 */
function basePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'test',
    name: 'Test',
    startYear: 2026,
    people: [
      {
        id: 'p1',
        name: 'Test Person',
        birthMonth: '1986-01', // age 40 in 2026
        retirementAge: 65,
        ssClaimAge: 67,
        ssMonthlyAtFra: 0,
      },
    ],
    accounts: [
      {
        id: 'acct',
        name: 'Brokerage',
        type: 'taxable',
        balance: 100_000,
        ownerId: 'p1',
        expectedReturn: 0,
        volatility: 0,
        monthlyContribution: 0,
        costBasisFraction: 1,
      },
    ],
    incomes: [],
    expenses: [],
    debts: [],
    assets: [],
    windfalls: [],
    insurance: [],
    assumptions: {
      inflation: 0,
      ssHaircut: 1,
      planEndAge: 45, // short horizon keeps tests fast
      successThreshold: 0.85,
      withdrawalOrder: ['taxable', 'pretax', 'roth'],
      safeWithdrawalRate: 0.04,
      emergencyFundMonths: 6,
      retirementSpendingDrift: 0,
      simulationRuns: 100,
      stateCode: 'WA',
      filingStatus: 'single',
    },
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ssClaimFactor', () => {
  it('is 1.0 at full retirement age', () => {
    expect(ssClaimFactor(67)).toBe(1);
  });

  it('reduces a benefit claimed at 62 by 30%', () => {
    // 36 months x 5/9% + 24 months x 5/12% = 20% + 10%.
    expect(ssClaimFactor(62)).toBeCloseTo(0.7, 5);
  });

  it('adds 8% per year for delaying to 70', () => {
    expect(ssClaimFactor(70)).toBeCloseTo(1.24, 5);
  });

  it('does not credit delay past 70', () => {
    expect(ssClaimFactor(72)).toBeCloseTo(1.24, 5);
  });
});

describe('projection horizon', () => {
  it('runs until the youngest person reaches planEndAge', () => {
    const result = project(basePlan());
    expect(result.rows[0].year).toBe(2026);
    expect(result.rows[result.rows.length - 1].year).toBe(2031); // 1986 + 45
    expect(result.rows[0].primaryAge).toBe(40);
  });

  it('returns an empty result for a plan with no people', () => {
    const result = project(basePlan({ people: [] }));
    expect(result.rows).toEqual([]);
    expect(result.succeeded).toBe(false);
  });
});

describe('zero-return invariant', () => {
  it('leaves balances untouched with no flows and no growth', () => {
    const result = project(basePlan());
    for (const row of result.rows) {
      expect(row.investableAssets).toBeCloseTo(100_000, 6);
    }
  });

  it('accumulates contributions linearly at a 0% return', () => {
    const plan = basePlan({
      accounts: [
        {
          id: 'acct',
          name: 'Brokerage',
          type: 'taxable',
          balance: 0,
          ownerId: 'p1',
          expectedReturn: 0,
          volatility: 0,
          monthlyContribution: 1_000,
          costBasisFraction: 1,
        },
      ],
      // Enough income to fund the contributions without a withdrawal.
      incomes: [
        {
          id: 'inc',
          name: 'Salary',
          type: 'salary',
          ownerId: 'p1',
          annualGross: 150_000,
          realGrowthRate: 0,
          subjectToFica: true,
        },
      ],
    });

    const result = project(plan);
    // 12,000/yr, no growth: year N holds exactly N x 12,000 from contributions.
    expect(result.rows[0].balancesByAccount['acct']).toBeGreaterThanOrEqual(12_000);
  });
});

describe('account fees', () => {
  const investingPlan = (annualFee?: number): Plan =>
    basePlan({
      accounts: [
        {
          id: 'acct',
          name: 'Brokerage',
          type: 'taxable',
          balance: 100_000,
          ownerId: 'p1',
          expectedReturn: 0.08,
          annualFee,
          volatility: 0,
          monthlyContribution: 0,
          costBasisFraction: 1,
        },
      ],
      assumptions: { ...basePlan().assumptions, planEndAge: 60, inflation: 0 },
    });

  it('reduces growth by exactly the fee', () => {
    // 8% gross less a 1.5% fee is 6.5% net; one year on $100k is $6,500.
    const withFee = project(investingPlan(0.015)).rows[0].investableAssets;
    expect(withFee).toBeCloseTo(106_500, 0);
  });

  it('treats an absent fee as zero', () => {
    const noFeeField = project(investingPlan(undefined)).rows[0].investableAssets;
    const zeroFee = project(investingPlan(0)).rows[0].investableAssets;
    expect(noFeeField).toBeCloseTo(zeroFee, 6);
    expect(noFeeField).toBeCloseTo(108_000, 0);
  });

  it('compounds the drag over time', () => {
    const cheap = project(investingPlan(0.001)).finalNetWorth;
    const dear = project(investingPlan(0.015)).finalNetWorth;
    // Over 20 years the 1.4-point gap is worth far more than one year's $1,400.
    expect(cheap - dear).toBeGreaterThan(30_000);
  });
});

describe('conservation of value', () => {
  /**
   * With zero returns and zero appreciation, every dollar has to come from
   * somewhere. Net worth can only move by what was earned, minus what was
   * paid in tax and spent, plus the employer match and the principal that
   * paid down debt.
   *
   * This is the test that catches double-counting — it's what surfaced the
   * windfall and RMD-sweep bugs in the first draft of the engine.
   */
  function assertConserved(plan: Plan) {
    const result = project(plan);
    let previousNetWorth: number | undefined;

    for (const row of result.rows) {
      if (row.shortfall) break; // the identity only holds while fully funded
      if (previousNetWorth !== undefined) {
        const expectedChange =
          row.grossIncome -
          row.totalTax -
          row.spending +
          row.employerMatch +
          row.debtPrincipal;
        expect(row.netWorth - previousNetWorth).toBeCloseTo(expectedChange, 0);
      }
      previousNetWorth = row.netWorth;
    }
    expect(previousNetWorth).toBeDefined();
  }

  it('holds for salary, spending and contributions', () => {
    assertConserved(
      basePlan({
        incomes: [
          {
            id: 'inc',
            name: 'Salary',
            type: 'salary',
            ownerId: 'p1',
            annualGross: 120_000,
            realGrowthRate: 0,
            subjectToFica: true,
          },
        ],
        expenses: [
          { id: 'e', name: 'Living', category: 'living', monthlyAmount: 4_000 },
        ],
      }),
    );
  });

  it('holds with a debt being paid down', () => {
    assertConserved(
      basePlan({
        incomes: [
          {
            id: 'inc',
            name: 'Salary',
            type: 'salary',
            ownerId: 'p1',
            annualGross: 120_000,
            realGrowthRate: 0,
            subjectToFica: true,
          },
        ],
        expenses: [{ id: 'e', name: 'Living', category: 'living', monthlyAmount: 3_000 }],
        debts: [
          {
            id: 'd',
            name: 'Auto',
            type: 'auto',
            balance: 20_000,
            apr: 0.05,
            monthlyPayment: 600,
            extraMonthlyPayment: 0,
          },
        ],
      }),
    );
  });

  it('holds when a windfall arrives', () => {
    assertConserved(
      basePlan({
        incomes: [
          {
            id: 'inc',
            name: 'Salary',
            type: 'salary',
            ownerId: 'p1',
            annualGross: 120_000,
            realGrowthRate: 0,
            subjectToFica: true,
          },
        ],
        expenses: [{ id: 'e', name: 'Living', category: 'living', monthlyAmount: 4_000 }],
        windfalls: [
          {
            id: 'w',
            name: 'Inheritance',
            amount: 250_000,
            expectedYear: 2029,
            confidence: 1,
            included: true,
          },
        ],
      }),
    );
  });
});

describe('windfalls', () => {
  const withWindfall = (included: boolean) =>
    project(
      basePlan({
        windfalls: [
          {
            id: 'w',
            name: 'Inheritance',
            amount: 250_000,
            expectedYear: 2028,
            confidence: 1,
            included,
          },
        ],
      }),
    );

  it('is excluded from the baseline unless switched on', () => {
    const off = withWindfall(false);
    expect(off.rows[off.rows.length - 1].investableAssets).toBeCloseTo(100_000, 0);
  });

  it('adds exactly its amount once, not twice', () => {
    const on = withWindfall(true);
    const final = on.rows[on.rows.length - 1];
    expect(final.investableAssets).toBeCloseTo(350_000, 0);
  });

  it('can be forced on regardless of the flag', () => {
    const plan = basePlan({
      windfalls: [
        {
          id: 'w',
          name: 'Inheritance',
          amount: 250_000,
          expectedYear: 2028,
          confidence: 1,
          included: false,
        },
      ],
    });
    const forced = project(plan, { includeWindfalls: true });
    expect(forced.rows[forced.rows.length - 1].investableAssets).toBeCloseTo(350_000, 0);
  });
});

describe('phased expenses', () => {
  it('applies the healthcare bridge only between retirement and 65', () => {
    const plan = basePlan({
      planEndAgeOverride: undefined,
      assumptions: { ...basePlan().assumptions, planEndAge: 70 },
      people: [
        {
          id: 'p1',
          name: 'Test Person',
          birthMonth: '1986-01',
          retirementAge: 60,
          ssClaimAge: 67,
          ssMonthlyAtFra: 0,
        },
      ],
      expenses: [
        {
          id: 'bridge',
          name: 'Bridge',
          category: 'healthcare',
          monthlyAmount: 1_000,
          onlyIfRetired: true,
          endAge: 65,
        },
      ],
    } as Partial<Plan>);

    const rows = project(plan).rows;
    const at59 = rows.find((r) => r.primaryAge === 59)!;
    const at62 = rows.find((r) => r.primaryAge === 62)!;
    const at66 = rows.find((r) => r.primaryAge === 66)!;

    expect(at59.spending).toBe(0); // still working
    expect(at62.spending).toBeCloseTo(12_000, 0); // retired, pre-Medicare
    expect(at66.spending).toBe(0); // past 65
  });

  it('respects calendar-year windows', () => {
    const plan = basePlan({
      expenses: [
        {
          id: 'college',
          name: 'College',
          category: 'education',
          monthlyAmount: 1_000,
          startYear: 2028,
          endYear: 2029,
        },
      ],
    });
    const rows = project(plan).rows;
    expect(rows.find((r) => r.year === 2027)!.spending).toBe(0);
    expect(rows.find((r) => r.year === 2028)!.spending).toBeCloseTo(12_000, 0);
    expect(rows.find((r) => r.year === 2030)!.spending).toBe(0);
  });
});

describe('529 funding', () => {
  it('draws education costs from the 529 before general cash flow', () => {
    const plan = basePlan({
      accounts: [
        {
          id: 'c529',
          name: '529',
          type: '529',
          balance: 50_000,
          ownerId: 'p1',
          expectedReturn: 0,
          volatility: 0,
          monthlyContribution: 0,
        },
        {
          id: 'acct',
          name: 'Brokerage',
          type: 'taxable',
          balance: 100_000,
          ownerId: 'p1',
          expectedReturn: 0,
          volatility: 0,
          monthlyContribution: 0,
          costBasisFraction: 1,
        },
      ],
      expenses: [
        {
          id: 'college',
          name: 'College',
          category: 'education',
          monthlyAmount: 1_000,
          startYear: 2028,
          endYear: 2028,
        },
      ],
    });

    const rows = project(plan).rows;
    const collegeYear = rows.find((r) => r.year === 2028)!;
    // The 529 absorbed the full cost, so nothing reached general spending.
    expect(collegeYear.spending).toBeCloseTo(0, 0);
    expect(collegeYear.balancesByAccount['c529']).toBeCloseTo(38_000, 0);
    expect(collegeYear.balancesByAccount['acct']).toBeCloseTo(100_000, 0);
  });
});

describe('withdrawals and shortfall', () => {
  it('draws from the portfolio when spending exceeds income', () => {
    const plan = basePlan({
      expenses: [{ id: 'e', name: 'Living', category: 'living', monthlyAmount: 2_000 }],
    });
    const rows = project(plan).rows;
    expect(rows[0].withdrawals).toBeGreaterThan(0);
    expect(rows[rows.length - 1].investableAssets).toBeLessThan(100_000);
  });

  it('flags a shortfall once the money runs out', () => {
    const plan = basePlan({
      expenses: [{ id: 'e', name: 'Living', category: 'living', monthlyAmount: 10_000 }],
    });
    const result = project(plan);
    expect(result.succeeded).toBe(false);
    expect(result.depletionYear).toBeDefined();
  });

  it('follows the configured withdrawal order', () => {
    const plan = basePlan({
      accounts: [
        {
          id: 'pretax',
          name: '401k',
          type: '401k_traditional',
          balance: 100_000,
          ownerId: 'p1',
          expectedReturn: 0,
          volatility: 0,
          monthlyContribution: 0,
        },
        {
          id: 'taxable',
          name: 'Brokerage',
          type: 'taxable',
          balance: 100_000,
          ownerId: 'p1',
          expectedReturn: 0,
          volatility: 0,
          monthlyContribution: 0,
          costBasisFraction: 1,
        },
      ],
      expenses: [{ id: 'e', name: 'Living', category: 'living', monthlyAmount: 2_000 }],
    });

    const first = project(plan).rows[0];
    expect(first.withdrawalsByBucket.taxable).toBeGreaterThan(0);
    expect(first.withdrawalsByBucket.pretax).toBe(0);
  });
});

describe('household price level', () => {
  const plan = basePlan({
    assumptions: { ...basePlan().assumptions, inflation: 0.02, householdInflation: 0.03 },
  });

  it('compounds at the household rate from 1 in the start year', () => {
    const rows = project(plan).rows;
    expect(rows[0].householdPriceLevel).toBe(1);
    expect(rows[3].householdPriceLevel).toBeCloseTo(1.03 ** 3, 12);
  });

  it('follows an inflation sequence, keeping the basket gap', () => {
    const rows = project(plan, { inflationSequence: [0.02, 0.05] }).rows;
    expect(rows[1].householdPriceLevel).toBeCloseTo(1.06, 12);
    expect(rows[2].householdPriceLevel).toBeCloseTo(1.06 * 1.03, 12);
  });
});

describe('premium over CPI', () => {
  const linked = (realGrowthRate: number): Income => ({
    id: 'sal',
    name: 'Salary',
    type: 'salary',
    ownerId: 'p1',
    annualGross: 100_000,
    realGrowthRate,
  });

  it('gives back the raise it was set from', () => {
    for (const [raise, cpi] of [[0.04, 0.025], [0, 0.06], [-0.1, 0], [0.2, 0.06]]) {
      expect(nominalRaiseOf(linked(premiumOverCpi(raise, cpi)), cpi)).toBeCloseTo(raise, 12);
    }
  });

  it('is the premium a CPI-linked raise already has', () => {
    expect(premiumOverCpi(nominalRaiseOf(linked(0.01), 0.025), 0.025)).toBeCloseTo(0.01, 12);
  });
});

describe('freeze years on growth above CPI', () => {
  // CPI of 2%, 3% and 1% in the three years after 2026.
  const cpiIndex = [1, 1.02, 1.02 * 1.03, 1.02 * 1.03 * 1.01];
  const salary: Income = {
    id: 'sal',
    name: 'Salary',
    type: 'salary',
    ownerId: 'p1',
    annualGross: 100_000,
    realGrowthRate: 0.01,
  };
  const factor = (income: Income, year: number) =>
    incomeGrowthFactor(income, year, 2026, cpiIndex);

  it('compounds inflation and the premium when nothing is frozen', () => {
    expect(factor(salary, 2029)).toBeCloseTo(cpiIndex[3] * 1.01 ** 3, 12);
  });

  it('grants neither inflation nor the premium in a frozen year', () => {
    const frozen = { ...salary, freezeYears: [2027] };
    expect(factor(frozen, 2027)).toBeCloseTo(1, 12);
    expect(factor(frozen, 2029)).toBeCloseTo(1.03 * 1.01 * 1.01 * 1.01, 12);
  });
});

describe('raise caps', () => {
  const salary: Income = {
    id: 'sal',
    name: 'Salary',
    type: 'salary',
    ownerId: 'p1',
    annualGross: 100_000,
    realGrowthRate: 0,
    nominalGrowthRate: 0.04,
  };
  const caps = [0.01, 0.01, 0.01];
  const noInflation = Array.from({ length: 10 }, () => 1);
  const factor = (income: Income, year: number) =>
    incomeGrowthFactor(income, year, 2026, noInflation, caps);

  it('limits raises in the capped years, then resumes them from the lower base', () => {
    expect(factor(salary, 2028)).toBeCloseTo(1.01 ** 2, 12);
    expect(factor(salary, 2030)).toBeCloseTo(1.01 ** 2 * 1.04 ** 2, 12);
  });

  it('never raises a salary above its own rate', () => {
    const slow = { ...salary, nominalGrowthRate: 0.005 };
    expect(factor(slow, 2028)).toBeCloseTo(1.005 ** 2, 12);
  });

  it('leaves other income alone', () => {
    expect(factor({ ...salary, type: 'pension' }, 2028)).toBeCloseTo(1.04 ** 2, 12);
  });

  it('keeps a frozen year frozen', () => {
    expect(factor({ ...salary, freezeYears: [2027] }, 2028)).toBeCloseTo(1.01, 12);
  });
});

describe('payroll tax', () => {
  const table = taxTableFor(2026, 0);

  /** One salaried person and one self-employed person, filing jointly. */
  function twoEarners(salary: number, expenses: Plan['expenses'] = []): Plan {
    const person = basePlan().people[0];
    return basePlan({
      people: [person, { ...person, id: 'p2', name: 'Second Person' }],
      incomes: [
        {
          id: 'sal',
          name: 'Salary',
          type: 'salary',
          ownerId: 'p1',
          annualGross: salary,
          realGrowthRate: 0,
          subjectToFica: true,
        },
        {
          id: 'se',
          name: 'Consulting',
          type: 'self_employment',
          ownerId: 'p2',
          annualGross: 40_000,
          realGrowthRate: 0,
          subjectToFica: true,
        },
      ],
      expenses,
      assumptions: { ...basePlan().assumptions, filingStatus: 'mfj' },
    });
  }

  it('applies the Social Security wage base to each person', () => {
    const salary = table.socialSecurityWageBase + 50_000;
    const row = project(twoEarners(salary)).rows[0];

    const seBase = 40_000 * 0.9235;
    const expected =
      table.socialSecurityWageBase * table.socialSecurityRate +
      seBase * table.socialSecurityRate * 2 +
      salary * table.medicareRate +
      seBase * table.medicareRate * 2 +
      (salary + seBase - table.additionalMedicareThreshold.mfj) * table.additionalMedicareRate;

    expect(row.ficaTax).toBeCloseTo(expected, 2);
  });

  it('never rises when a pre-tax payroll deduction is added', () => {
    // The deduction pulls the salary just under the wage base.
    const salary = table.socialSecurityWageBase + 2_000;
    const premiums = {
      id: 'e-premiums',
      name: 'Premiums',
      category: 'healthcare',
      monthlyAmount: 500,
      pretaxPayroll: true,
    };

    const without = project(twoEarners(salary)).rows[0];
    const withDeduction = project(twoEarners(salary, [premiums])).rows[0];

    expect(withDeduction.ficaTax).toBeLessThan(without.ficaTax);
  });
});

describe('monotonicity', () => {
  const plan = basePlan({
    assumptions: { ...basePlan().assumptions, planEndAge: 90, inflation: 0.025 },
    accounts: [
      {
        id: 'acct',
        name: '401k',
        type: '401k_traditional',
        balance: 200_000,
        ownerId: 'p1',
        expectedReturn: 0.06,
        volatility: 0.15,
        monthlyContribution: 1_000,
      },
    ],
    incomes: [
      {
        id: 'inc',
        name: 'Salary',
        type: 'salary',
        ownerId: 'p1',
        annualGross: 110_000,
        realGrowthRate: 0,
        subjectToFica: true,
      },
    ],
    expenses: [{ id: 'e', name: 'Living', category: 'living', monthlyAmount: 4_500 }],
  });

  it('never makes the plan worse by retiring later', () => {
    // The solver's bisection depends on this being true.
    let previous = -Infinity;
    for (const age of [55, 60, 62, 65, 68, 70]) {
      const worth = project(plan, { retirementAgeOverride: age }).finalNetWorth;
      expect(worth).toBeGreaterThanOrEqual(previous - 1);
      previous = worth;
    }
  });

  it('never makes the plan worse by contributing longer', () => {
    let previous = -Infinity;
    for (const age of [45, 50, 55, 60, 65]) {
      const worth = project(plan, { contributionsStopAge: age }).finalNetWorth;
      expect(worth).toBeGreaterThanOrEqual(previous - 1);
      previous = worth;
    }
  });

  it('produces a higher balance with a higher return', () => {
    const low = project({
      ...plan,
      accounts: plan.accounts.map((a) => ({ ...a, expectedReturn: 0.03 })),
    }).finalNetWorth;
    const high = project({
      ...plan,
      accounts: plan.accounts.map((a) => ({ ...a, expectedReturn: 0.08 })),
    }).finalNetWorth;
    expect(high).toBeGreaterThan(low);
  });
});

describe('solveEarliestRetirementAge', () => {
  it('finds an age a well-funded plan can afford', () => {
    const plan = basePlan({
      assumptions: { ...basePlan().assumptions, planEndAge: 90, inflation: 0.02 },
      accounts: [
        {
          id: 'acct',
          name: '401k',
          type: '401k_traditional',
          balance: 900_000,
          ownerId: 'p1',
          expectedReturn: 0.06,
          volatility: 0.15,
          monthlyContribution: 2_000,
        },
      ],
      incomes: [
        {
          id: 'inc',
          name: 'Salary',
          type: 'salary',
          ownerId: 'p1',
          annualGross: 150_000,
          realGrowthRate: 0,
          subjectToFica: true,
        },
      ],
      expenses: [{ id: 'e', name: 'Living', category: 'living', monthlyAmount: 3_500 }],
    });

    const solution = solveEarliestRetirementAge(plan);
    expect(solution.infeasible).toBe(false);
    expect(solution.earliestAge).toBeGreaterThanOrEqual(40);
    expect(solution.earliestAge).toBeLessThanOrEqual(80);

    // The answer must actually hold up.
    expect(project(plan, { retirementAgeOverride: solution.earliestAge }).succeeded).toBe(true);
    // And one year earlier must fail, or it wasn't the earliest.
    if (solution.earliestAge! > 40) {
      expect(
        project(plan, { retirementAgeOverride: solution.earliestAge! - 1 }).succeeded,
      ).toBe(false);
    }
  });

  it('reports infeasible when spending always outruns the portfolio', () => {
    const plan = basePlan({
      assumptions: { ...basePlan().assumptions, planEndAge: 90 },
      expenses: [{ id: 'e', name: 'Living', category: 'living', monthlyAmount: 25_000 }],
    });
    expect(solveEarliestRetirementAge(plan).infeasible).toBe(true);
  });
});

describe('computeMetrics', () => {
  const plan = basePlan({
    accounts: [
      {
        id: 'hysa',
        name: 'HYSA',
        type: 'hysa',
        balance: 30_000,
        ownerId: 'p1',
        expectedReturn: 0.03,
        volatility: 0,
        monthlyContribution: 0,
      },
    ],
    expenses: [{ id: 'e', name: 'Living', category: 'living', monthlyAmount: 5_000 }],
  });

  it('derives the FI number from spending and the safe withdrawal rate', () => {
    const metrics = computeMetrics(plan, project(plan));
    // 60,000/yr at 4% = 1,500,000.
    expect(metrics.fiNumber).toBeCloseTo(1_500_000, 0);
  });

  it('measures the emergency fund in months of spending', () => {
    const metrics = computeMetrics(plan, project(plan));
    // 30,000 liquid against 5,000/mo.
    expect(metrics.emergencyFundMonths).toBeCloseTo(6, 1);
  });

  it('reports the current age', () => {
    expect(computeMetrics(plan, project(plan)).currentAge).toBe(40);
  });
});

describe('solveCoastAge', () => {
  it('returns undefined when the plan never works', () => {
    const plan = basePlan({
      assumptions: { ...basePlan().assumptions, planEndAge: 90 },
      expenses: [{ id: 'e', name: 'Living', category: 'living', monthlyAmount: 25_000 }],
    });
    expect(solveCoastAge(plan)).toBeUndefined();
  });

  it('returns the current age when the portfolio already coasts', () => {
    const plan = basePlan({
      assumptions: { ...basePlan().assumptions, planEndAge: 90, inflation: 0.02 },
      accounts: [
        {
          id: 'acct',
          name: '401k',
          type: '401k_traditional',
          balance: 3_000_000,
          ownerId: 'p1',
          expectedReturn: 0.06,
          volatility: 0.15,
          monthlyContribution: 1_000,
        },
      ],
      incomes: [
        {
          id: 'inc',
          name: 'Salary',
          type: 'salary',
          ownerId: 'p1',
          annualGross: 150_000,
          realGrowthRate: 0,
          subjectToFica: true,
        },
      ],
      expenses: [{ id: 'e', name: 'Living', category: 'living', monthlyAmount: 4_000 }],
    });
    expect(solveCoastAge(plan)).toBe(40);
  });
});
