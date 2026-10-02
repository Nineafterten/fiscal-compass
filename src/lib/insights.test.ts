import { describe, expect, it } from 'vitest';
import { SAMPLE_PLAN } from '../data/profiles/sample';
import { taxTableFor } from '../data/taxTables';
import { project } from './engine/project';
import { computeMetrics } from './engine/solve';
import { formatCurrency } from './format';
import { generateInsights, type InsightContext } from './insights';
import { isLiquid, type Plan } from '../types/plan';

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

  it('points at the target, not three months, once three months are covered', () => {
    const insight = findById(withLiquid(30_000), 'emergency-fund');
    const gap = insight?.metrics.find((m) => m.label.startsWith('Gap'));
    expect(insight?.action).toContain(
      `the ${SAMPLE_PLAN.assumptions.emergencyFundMonths}-month target needs about ${gap?.value}`,
    );
    expect(findById(withLiquid(2_000), 'emergency-fund')?.action).toMatch(/^Reaching three months/);
  });

  it('only says the portfolio absorbs a bad month when there is a portfolio to absorb it', () => {
    const cashOnly: Plan = {
      ...withLiquid(2_000),
      accounts: withLiquid(2_000).accounts.map((a) => (isLiquid(a.type) ? a : { ...a, balance: 0 })),
    };
    expect(findById(withLiquid(2_000), 'emergency-fund')?.body).toContain('absorbed on paper');
    expect(findById(cashOnly, 'emergency-fund')?.body).not.toContain('absorbed on paper');
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
    expect(insight?.metrics.find((m) => m.label === 'Normal raise')?.value).toBe('4.0%');
  });

  it('uses the raise a salary quoted above CPI actually gets', () => {
    const salary = SAMPLE_PLAN.incomes.find((i) => i.type === 'salary')!;
    const frozen: Plan = {
      ...SAMPLE_PLAN,
      incomes: SAMPLE_PLAN.incomes.map((i) =>
        i.id === salary.id ? { ...i, freezeYears: [SAMPLE_PLAN.startYear + 1] } : i,
      ),
    };
    const raise = (1 + SAMPLE_PLAN.assumptions.inflation) * (1 + salary.realGrowthRate) - 1;
    const insight = findById(frozen, 'raise-freeze');
    const metric = (label: string) => insight?.metrics.find((m) => m.label === label)?.value;
    expect(metric('Normal raise')).toBe(`${(raise * 100).toFixed(1)}%`);
    expect(metric('Salary gap, first year')).toBe(formatCurrency(salary.annualGross * raise));
    // One lost raise leaves later pay at 1/(1 + raise) of the line, not 1 - raise.
    expect(insight?.body).toContain(`sits about ${((raise / (1 + raise)) * 100).toFixed(1)}% below`);
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
    // The STD pays as much as the LTD, so counting it would double the figure.
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
    const salary = SAMPLE_PLAN.incomes
      .filter((i) => i.type === 'salary')
      .reduce((s, i) => s + i.annualGross, 0);
    const insight = findById(plan, 'disability-adequacy');
    const gross = insight?.metrics.find((m) => m.label.includes('replacement'));
    expect(gross?.benchmark).toBe(`${formatCurrency(90_000)}/yr of ${formatCurrency(salary)}`);
    expect(gross?.value).toBe(`${Math.round((90_000 / salary) * 100)}%`);
  });

  const std = (benefitPeriodWeeks?: number): Plan['insurance'][number] => ({
    id: 'std', name: 'STD', type: 'disability', disabilityTerm: 'short',
    coverageAmount: 90_000, insuredPersonId: 'p1', monthlyPremium: 0,
    benefitTaxable: true, eliminationPeriodDays: 7, benefitPeriodWeeks,
  });
  const ltd: Plan['insurance'][number] = {
    id: 'ltd', name: 'LTD', type: 'disability', disabilityTerm: 'long',
    coverageAmount: 90_000, insuredPersonId: 'p1', monthlyPremium: 0,
    benefitTaxable: true, eliminationPeriodDays: 180, monthlyBenefitCap: 7_500,
  };

  it('bridges only when short-term cover lasts until long-term cover starts', () => {
    // 26 weeks from day 7 reaches day 189, past the LTD's day 180. 13 weeks
    // stops at day 98, leaving the first 7 days and days 98-180 unpaid.
    const bridged = findById(withDisability([std(26), ltd]), 'disability-adequacy');
    expect(bridged?.metrics.find((m) => m.label === 'Nothing pays for')?.value).toBe('7 days');
    expect(bridged?.body).toContain('runs until the long-term policy begins');

    const short = findById(withDisability([std(13), ltd]), 'disability-adequacy');
    expect(short?.metrics.find((m) => m.label === 'Days with no benefit')?.value).toBe('89 days');
    expect(short?.body).not.toContain('runs until the long-term policy begins');
  });

  it('agrees with the emergency-fund card on how long nothing pays', () => {
    // The last case has two long-term policies, and the individual one pays first.
    const individual: Plan['insurance'][number] = {
      id: 'idi', name: 'Individual LTD', type: 'disability', disabilityTerm: 'long',
      coverageAmount: 24_000, insuredPersonId: 'p1', monthlyPremium: 0,
      benefitTaxable: false, eliminationPeriodDays: 90,
    };
    const cases: [Plan['insurance'], string][] = [
      [[std(26), ltd], '7 days'],
      [[std(13), ltd], '89 days'],
      [[std(), ltd], '180 days'],
      [[{ ...ltd, ownOccupationMonths: 24 }, individual], '90 days'],
    ];
    const cardLabels = ['Nothing pays for', 'Days with no benefit', 'Counted as unpaid'];
    for (const [policies, days] of cases) {
      const plan = withDisability(policies);
      const fund = findById(plan, 'emergency-fund')?.metrics.find((m) => /disability/i.test(m.label));
      const card = findById(plan, 'disability-adequacy')?.metrics.find((m) =>
        cardLabels.includes(m.label),
      );
      expect(fund?.value).toBe(days);
      expect(card?.value).toBe(days);
    }
  });

  it('does not count on a short-term benefit period that is not recorded', () => {
    const insight = findById(withDisability([std(), ltd]), 'disability-adequacy');
    expect(insight?.metrics.find((m) => m.label === 'Counted as unpaid')?.value).toBe('180 days');
    expect(insight?.body).toContain('benefit period is not recorded');
  });

  it('does not call a warning "nothing urgent"', () => {
    // Two earners and a bridged gap: the cap is the only thing to watch.
    const calm = findById(withDisability([std(26), ltd]), 'disability-adequacy');
    expect(calm?.severity).toBe('opportunity');
    expect(calm?.action).toMatch(/^Nothing urgent\. /);

    const oneEarner: Plan = {
      ...withDisability([ltd]),
      incomes: SAMPLE_PLAN.incomes.filter((i) => i.ownerId === 'p1'),
    };
    const warning = findById(oneEarner, 'disability-adequacy');
    expect(warning?.severity).toBe('warning');
    expect(warning?.action).toMatch(/cap does not index/);
    expect(warning?.action).not.toMatch(/Nothing urgent/);
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

  it('credits the payoff with filling the emergency fund only when the fund fills after it', () => {
    // The sample's fund reaches its target before the auto loan clears; on one
    // income it gets there afterwards.
    expect(findById(SAMPLE_PLAN, 'debt-payoff')?.body).not.toContain('carries the emergency fund');
    const oneIncome: Plan = {
      ...SAMPLE_PLAN,
      incomes: SAMPLE_PLAN.incomes.filter((i) => i.ownerId === 'p1'),
    };
    expect(findById(oneIncome, 'debt-payoff')?.body).toContain('carries the emergency fund');
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
    // The sample's own Roth IRA is already under the limit, so check the
    // shortfall this override produces rather than that the card appears.
    const nearLimit: Plan = {
      ...SAMPLE_PLAN,
      accounts: SAMPLE_PLAN.accounts.map((a) =>
        a.type === 'roth_ira' ? { ...a, monthlyContribution: 580 } : a,
      ),
    };
    const { limitIra } = taxTableFor(SAMPLE_PLAN.startYear, SAMPLE_PLAN.assumptions.inflation);
    const roth = findById(nearLimit, 'contribution-headroom')?.metrics.find(
      (m) => m.label === 'Roth IRA',
    );
    expect(roth?.value).toBe(`${formatCurrency(limitIra - 580 * 12)}/yr short`);
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
