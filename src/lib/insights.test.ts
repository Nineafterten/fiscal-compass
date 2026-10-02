import { describe, expect, it } from 'vitest';
import { SAMPLE_PLAN } from '../data/profiles/sample';
import { project } from './engine/project';
import { computeMetrics } from './engine/solve';
import { generateInsights, type InsightContext } from './insights';
import type { Plan } from '../types/plan';

/** Tests run against the committed sample so they don't depend on private data. */
function contextFor(plan: Plan): InsightContext {
  const projection = project(plan);
  return { plan, projection, metrics: computeMetrics(plan, projection) };
}

const findById = (plan: Plan, id: string) =>
  generateInsights(contextFor(plan)).find((i) => i.id === id);

describe('generateInsights', () => {
  it('produces findings for the sample household', () => {
    const insights = generateInsights(contextFor(SAMPLE_PLAN));
    expect(insights.length).toBeGreaterThan(5);
  });

  it('orders the most serious first', () => {
    const order = { critical: 0, warning: 1, opportunity: 2, ok: 3 };
    const insights = generateInsights(contextFor(SAMPLE_PLAN));
    for (let i = 1; i < insights.length; i++) {
      expect(order[insights[i].severity]).toBeGreaterThanOrEqual(
        order[insights[i - 1].severity],
      );
    }
  });

  it('gives every finding its arithmetic', () => {
    for (const insight of generateInsights(contextFor(SAMPLE_PLAN))) {
      expect(insight.metrics.length).toBeGreaterThan(0);
      expect(insight.title).toBeTruthy();
      expect(insight.body).toBeTruthy();
    }
  });

  it('uses unique ids', () => {
    const ids = generateInsights(contextFor(SAMPLE_PLAN)).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('survives a rule that throws', () => {
    // A plan with no people, income or accounts is the degenerate case most
    // likely to make a rule reach for something that isn't there.
    const empty: Plan = {
      ...SAMPLE_PLAN,
      people: [],
      incomes: [],
      accounts: [],
      debts: [],
      assets: [],
      insurance: [],
      windfalls: [],
    };
    expect(() => generateInsights(contextFor(empty))).not.toThrow();
  });
});

describe('emergency fund rule', () => {
  const withLiquid = (balance: number): Plan => ({
    ...SAMPLE_PLAN,
    accounts: SAMPLE_PLAN.accounts.map((a) =>
      a.type === 'hysa' ? { ...a, balance } : a,
    ),
  });

  it('is critical below three months', () => {
    expect(findById(withLiquid(2_000), 'emergency-fund')?.severity).toBe('critical');
  });

  it('is a warning between three and the target', () => {
    expect(findById(withLiquid(30_000), 'emergency-fund')?.severity).toBe('warning');
  });

  it('is satisfied at the target', () => {
    expect(findById(withLiquid(200_000), 'emergency-fund')?.severity).toBe('ok');
  });

  it('reports the gap to the target', () => {
    const insight = findById(withLiquid(2_000), 'emergency-fund');
    const gap = insight?.metrics.find((m) => m.label.startsWith('Gap'));
    expect(gap).toBeDefined();
    expect(gap?.value).toMatch(/\$/);
  });
});

describe('cheap debt affirmation', () => {
  it('affirms not prepaying a low-rate mortgage', () => {
    const insight = findById(SAMPLE_PLAN, 'cheap-debt-affirmation');
    expect(insight?.severity).toBe('ok');
  });

  it('stays quiet when extra payments are already being made', () => {
    const prepaying: Plan = {
      ...SAMPLE_PLAN,
      debts: SAMPLE_PLAN.debts.map((d) =>
        d.type === 'mortgage' ? { ...d, extraMonthlyPayment: 500 } : d,
      ),
    };
    expect(findById(prepaying, 'cheap-debt-affirmation')).toBeUndefined();
  });
});

describe('windfall dependency', () => {
  it('says nothing when there are no windfalls', () => {
    expect(findById(SAMPLE_PLAN, 'windfall-dependency')).toBeUndefined();
  });

  it('flags a plan that only works with an inheritance', () => {
    // Balances stripped and spending raised until income alone cannot rebuild
    // a portfolio — the only thing keeping this plan alive is the windfall.
    const dependent: Plan = {
      ...SAMPLE_PLAN,
      accounts: SAMPLE_PLAN.accounts.map((a) => ({
        ...a,
        balance: a.balance * 0.05,
        monthlyContribution: 0,
        employerMatchRate: 0,
      })),
      expenses: [
        ...SAMPLE_PLAN.expenses,
        { id: 'e-heavy', name: 'Heavy spending', category: 'living', monthlyAmount: 6_000 },
      ],
      windfalls: [
        {
          id: 'w',
          name: 'Inheritance',
          amount: 6_000_000,
          expectedYear: SAMPLE_PLAN.startYear + 5,
          confidence: 0.5,
          included: true,
        },
      ],
    };

    // Guard the premise: without the windfall this plan must actually fail,
    // or the assertion below would pass for the wrong reason.
    expect(project(dependent, { includeWindfalls: false }).succeeded).toBe(false);
    expect(findById(dependent, 'windfall-dependency')?.severity).toBe('critical');
  });
});

describe('raise freeze', () => {
  it('says nothing without a freeze', () => {
    expect(findById(SAMPLE_PLAN, 'raise-freeze')).toBeUndefined();
  });

  it('quantifies the cost of a skipped raise', () => {
    const frozen: Plan = {
      ...SAMPLE_PLAN,
      incomes: SAMPLE_PLAN.incomes.map((i) =>
        i.type === 'salary'
          ? { ...i, nominalGrowthRate: 0.04, freezeYears: [SAMPLE_PLAN.startYear + 1] }
          : i,
      ),
    };
    const insight = findById(frozen, 'raise-freeze');
    expect(insight).toBeDefined();
    expect(insight?.severity).toBe('warning');
    expect(insight?.metrics.some((m) => m.label.includes('Salary gap'))).toBe(true);
  });
});

describe('disability adequacy', () => {
  const withDisability = (policies: Plan['insurance']): Plan => ({
    ...SAMPLE_PLAN,
    insurance: [...SAMPLE_PLAN.insurance.filter((i) => i.type !== 'disability'), ...policies],
  });

  it('treats short-term cover as bridging the long-term elimination period', () => {
    // The emergency-fund floor should be the SOONEST any policy pays (7 days),
    // not the long-term elimination period (180) — a short-term policy covers
    // the gap. Taking the max instead overstates the cash requirement ~26x.
    const plan = withDisability([
      {
        id: 'std', name: 'STD', type: 'disability', disabilityTerm: 'short',
        coverageAmount: 90_000, insuredPersonId: 'p1', monthlyPremium: 0,
        benefitTaxable: true, eliminationPeriodDays: 7, benefitPeriodWeeks: 26,
      },
      {
        id: 'ltd', name: 'LTD', type: 'disability', disabilityTerm: 'long',
        coverageAmount: 90_000, insuredPersonId: 'p1', monthlyPremium: 0,
        benefitTaxable: true, eliminationPeriodDays: 180,
      },
    ]);
    const ef = findById(plan, 'emergency-fund');
    const gap = ef?.metrics.find((m) => m.label.includes('pays nothing for'));
    expect(gap?.value).toBe('7 days');
  });

  it('excludes short-term cover from the long-term replacement figure', () => {
    // 60% STD + 60% LTD must not read as 120% replacement.
    const plan = withDisability([
      {
        id: 'std', name: 'STD', type: 'disability', disabilityTerm: 'short',
        coverageAmount: 90_000, insuredPersonId: 'p1', monthlyPremium: 0,
        benefitTaxable: true, eliminationPeriodDays: 7,
      },
      {
        id: 'ltd', name: 'LTD', type: 'disability', disabilityTerm: 'long',
        coverageAmount: 90_000, insuredPersonId: 'p1', monthlyPremium: 0,
        benefitTaxable: true, eliminationPeriodDays: 180, monthlyBenefitCap: 7_500,
      },
    ]);
    const insight = findById(plan, 'disability-adequacy');
    const gross = insight?.metrics.find((m) => m.label.includes('replacement'));
    // The LTD alone; counting the STD too would roughly double this. Whatever
    // the exact percentage, it must be under 100% — the bug being guarded
    // against produced an impossible figure above it.
    const value = Number.parseInt(gross?.value ?? '0', 10);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(100);
  });
});

describe('debt payoff', () => {
  it('frames a payoff by the cash flow it frees, not just interest', () => {
    const insight = findById(SAMPLE_PLAN, 'debt-payoff');
    expect(insight).toBeDefined();
    // The freed monthly cash flow must appear, and it's the full payment.
    expect(insight?.metrics.some((m) => /frees \$/.test(m.benchmark ?? ''))).toBe(true);
    expect(insight?.title).toMatch(/frees \$/);
  });

  it('credits an extra payment with pulling the payoff forward', () => {
    const prepaying: Plan = {
      ...SAMPLE_PLAN,
      debts: SAMPLE_PLAN.debts.map((d) =>
        d.type === 'auto' ? { ...d, extraMonthlyPayment: 250 } : d,
      ),
    };
    const insight = findById(prepaying, 'debt-payoff');
    expect(insight?.metrics.some((m) => m.label.includes('pulls it forward'))).toBe(true);
    expect(insight?.body).toMatch(/back in your hands|bigger prize/);
  });

  it('says nothing when there are no debts', () => {
    expect(findById({ ...SAMPLE_PLAN, debts: [] }, 'debt-payoff')).toBeUndefined();
  });
});

describe('fee drag', () => {
  it('fires only on genuinely expensive accounts', () => {
    const cheap: Plan = {
      ...SAMPLE_PLAN,
      accounts: SAMPLE_PLAN.accounts.map((a) => ({ ...a, annualFee: 0.003 })),
    };
    expect(findById(cheap, 'fee-drag')).toBeUndefined();
  });

  it('quantifies the lifetime cost of an advisory fee', () => {
    const advised: Plan = {
      ...SAMPLE_PLAN,
      accounts: SAMPLE_PLAN.accounts.map((a) =>
        a.expectedReturn > 0.05 ? { ...a, annualFee: 0.015 } : a,
      ),
    };
    const insight = findById(advised, 'fee-drag');
    expect(insight).toBeDefined();
    expect(insight?.metrics.some((m) => m.label.includes('Cost by end of plan'))).toBe(true);
  });
});

describe('contribution headroom', () => {
  it('flags a contribution just under the limit', () => {
    const nearLimit: Plan = {
      ...SAMPLE_PLAN,
      accounts: SAMPLE_PLAN.accounts.map((a) =>
        a.type === 'roth_ira' ? { ...a, monthlyContribution: 580 } : a,
      ),
    };
    expect(findById(nearLimit, 'contribution-headroom')).toBeDefined();
  });

  it('stays quiet when contributions are far below the limit', () => {
    // A large gap means the limit isn't the binding constraint — cash is.
    const wellUnder: Plan = {
      ...SAMPLE_PLAN,
      accounts: SAMPLE_PLAN.accounts.map((a) => ({ ...a, monthlyContribution: 50 })),
    };
    expect(findById(wellUnder, 'contribution-headroom')).toBeUndefined();
  });
});

describe('survivor test', () => {
  it('runs the plan without the earner rather than applying a multiple', () => {
    const insight = findById(SAMPLE_PLAN, 'survivor-test');
    expect(insight).toBeDefined();
    expect(insight?.metrics.some((m) => m.label.includes('Survivor Social Security'))).toBe(
      true,
    );
  });

  it('reports a shortfall when cover is removed entirely', () => {
    const uninsured: Plan = {
      ...SAMPLE_PLAN,
      insurance: SAMPLE_PLAN.insurance.filter((i) => i.type !== 'life'),
      accounts: SAMPLE_PLAN.accounts.map((a) => ({ ...a, balance: a.balance * 0.2 })),
    };
    expect(findById(uninsured, 'survivor-test')?.severity).toBe('critical');
  });

  it('grades severity by how soon the money runs out, not merely whether', () => {
    // Life cover is a bridge. A gap forty years out is a note; one four years
    // out is an emergency. Reporting both as "fails" was the original defect —
    // it hid how long the cover actually lasted.
    const strip = (balanceFactor: number): Plan => ({
      ...SAMPLE_PLAN,
      insurance: SAMPLE_PLAN.insurance.filter((i) => i.type !== 'life'),
      accounts: SAMPLE_PLAN.accounts.map((a) => ({
        ...a,
        balance: a.balance * balanceFactor,
      })),
    });

    const dire = findById(strip(0.02), 'survivor-test');
    const distant = findById(strip(0.6), 'survivor-test');

    // Whatever the exact ages, running dry sooner must never grade as less
    // serious than running dry later.
    const rank = { critical: 0, warning: 1, opportunity: 2, ok: 3 } as const;
    expect(rank[dire!.severity]).toBeLessThanOrEqual(rank[distant!.severity]);
  });

  it('reports how many years of cover the benefit buys', () => {
    const insight = findById(SAMPLE_PLAN, 'survivor-test');
    expect(insight?.metrics.some((m) => m.label.includes('Years of cover'))).toBe(true);
  });

  it('accounts for dependants becoming independent', () => {
    // A survivor supports a child for a defined period, not forever. Ignoring
    // that manufactures a shortfall out of nothing.
    const base: Plan = {
      ...SAMPLE_PLAN,
      insurance: SAMPLE_PLAN.insurance.filter((i) => i.type !== 'life'),
      accounts: SAMPLE_PLAN.accounts.map((a) => ({ ...a, balance: a.balance * 0.25 })),
      assumptions: {
        ...SAMPLE_PLAN.assumptions,
        survivorSpendingFactor: 0.82,
        survivorEarningsFraction: 0,
      },
    };
    const withStepDown: Plan = {
      ...base,
      assumptions: {
        ...base.assumptions,
        survivorSpendingFactorAfterChildren: 0.6,
        dependentsIndependentYear: SAMPLE_PLAN.startYear + 12,
      },
    };

    const rank = { critical: 0, warning: 1, opportunity: 2, ok: 3 } as const;
    expect(rank[findById(withStepDown, 'survivor-test')!.severity]).toBeGreaterThanOrEqual(
      rank[findById(base, 'survivor-test')!.severity],
    );
  });
});
