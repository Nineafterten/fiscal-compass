/**
 * The insights engine.
 *
 * Each rule is a pure function over the plan and its projection, returning
 * either nothing or a single finding with its arithmetic attached.
 *
 * Three principles hold throughout, and they are what separate this from a
 * list of generic financial tips:
 *
 *  1. **Show the math.** Every finding carries the numbers it was derived
 *     from and names the guideline it's measured against, so it can be
 *     argued with rather than just believed.
 *  2. **Affirm as well as warn.** A tool that only ever reports problems
 *     trains you to ignore it. Decisions that are already right are worth
 *     saying out loud — especially the ones that look wrong at a glance.
 *  3. **Don't recommend products.** These are observations about arithmetic.
 *     Choosing an actual fund, policy or account belongs with a licensed
 *     advisor who knows the whole picture.
 */

import { isLiquid, taxBucketOf, type Plan, type ProjectionResult } from '../types/plan';
import { rmdStartAge, taxTableFor } from '../data/taxTables';
import { computeTaxes } from './engine/tax';
import { debtPayoffMilestones, extraPaymentImpact } from './engine/amortize';
import { project } from './engine/project';
import { successProbability } from './engine/montecarlo';
import type { PlanMetrics } from './engine/solve';

export type InsightSeverity = 'critical' | 'warning' | 'opportunity' | 'ok';

export interface InsightMetric {
  label: string;
  value: string;
  /** What it's being measured against. */
  benchmark?: string;
}

export interface Insight {
  id: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  metrics: InsightMetric[];
  /** The published guideline, named so it can be looked up and disputed. */
  ruleOfThumb?: string;
  /** A concrete next step. Never "buy X". */
  action?: string;
  /** Lower sorts first within a severity band. */
  priority: number;
}

export interface InsightContext {
  plan: Plan;
  projection: ProjectionResult;
  metrics: PlanMetrics;
}

/**
 * Restate a future nominal amount in today's purchasing power.
 *
 * Rules deal in both — a balance you hold now and a balance projected for
 * 2060 — and showing them side by side without converting makes the future
 * one look several times more impressive than it is. Everything user-facing
 * goes through here.
 */
function inTodaysMoney(plan: Plan, nominal: number, year: number): number {
  const rate = plan.assumptions.householdInflation ?? plan.assumptions.inflation;
  return nominal / Math.pow(1 + rate, Math.max(0, year - plan.startYear));
}

export type InsightRule = (ctx: InsightContext) => Insight | null;

// ---------------------------------------------------------------------------
// Formatting helpers (local so rules read cleanly)
// ---------------------------------------------------------------------------

const money = (n: number) =>
  n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/**
 * The emergency fund. Usually the highest-severity finding in a plan that is
 * otherwise doing well, because retirement projections are insensitive to it
 * while real life is not.
 */
const emergencyFund: InsightRule = ({ plan, metrics }) => {
  const months = metrics.emergencyFundMonths;
  const monthly = metrics.annualSpending / 12;
  const target = plan.assumptions.emergencyFundMonths;
  if (!Number.isFinite(months) || monthly <= 0) return null;

  const singleEarner =
    plan.incomes.filter((i) => i.type === 'salary' && i.annualGross > 20_000).length <= 1;

  // A disability elimination period is a hard, contractual floor on how much
  // cash is required — more concrete than any rule of thumb, because it is a
  // window during which no benefit arrives at all. The floor is the SOONEST
  // any policy starts paying (the minimum elimination period), since a
  // short-term policy bridges the gap before long-term coverage begins.
  // Taking the maximum instead would badly overstate the requirement.
  const disabilityElims = plan.insurance
    .filter((i) => i.type === 'disability' && i.eliminationPeriodDays !== undefined)
    .map((i) => i.eliminationPeriodDays as number);
  const eliminationDays = disabilityElims.length ? Math.min(...disabilityElims) : 0;
  const eliminationMonths = eliminationDays / 30;

  const severity: InsightSeverity =
    months >= target ? 'ok' : months >= 3 ? 'warning' : 'critical';

  const gapToTarget = Math.max(0, monthly * target - metrics.liquidAssets);
  const investedElsewhere = plan.accounts
    .filter((a) => !isLiquid(a.type) && taxBucketOf(a.type) !== 'tax_free_edu')
    .reduce((s, a) => s + a.balance, 0);
  const milestone = months < 3 ? Math.min(3, target) : target;

  return {
    id: 'emergency-fund',
    severity,
    priority: 0,
    title:
      severity === 'ok'
        ? `Emergency fund covers ${months.toFixed(1)} months`
        : `Emergency fund covers ${months < 1 ? `${Math.round(months * 4.345)} weeks` : `${months.toFixed(1)} months`}`,
    ruleOfThumb:
      'Three to six months of expenses in cash is the conventional range; the upper end applies when income is concentrated in one job.',
    body:
      severity === 'ok'
        ? 'Liquid savings cover the target you set. This is the buffer that stops an ordinary bad month from becoming debt.'
        : `Liquid savings would cover ${months.toFixed(1)} months of spending.${
            singleEarner
              ? ' On a single income the usual guidance is the top of the range rather than the bottom, because there is no second paycheck to absorb a gap.'
              : ''
          }${
            investedElsewhere >= gapToTarget
              ? ' This does not show up in the retirement projection at all — the portfolio is large enough that a bad month gets absorbed on paper. In practice it would be absorbed by a credit card.'
              : ''
          }`,
    metrics: [
      { label: 'Liquid savings', value: money(metrics.liquidAssets) },
      { label: 'Monthly spending', value: money(monthly) },
      { label: 'Months covered', value: months.toFixed(2), benchmark: `${target} target` },
      { label: `Gap to ${target} months`, value: money(gapToTarget) },
      ...(eliminationDays > 0
        ? [
            {
              label: 'Disability pays nothing for',
              value: `${eliminationDays} days`,
              benchmark: `${money(monthly * eliminationMonths)} of cash`,
            },
          ]
        : []),
    ],
    action:
      severity === 'ok'
        ? undefined
        : eliminationDays > 0
          ? `Your disability policy pays nothing for its first ${eliminationDays} days, which turns the usual rule of thumb into a contractual requirement: about ${money(monthly * eliminationMonths)} just to bridge to the first benefit cheque.`
          : `Reaching ${milestone === target ? `the ${target}-month target` : 'three months'} needs about ${money(Math.max(0, monthly * milestone - metrics.liquidAssets))}.`,
  };
};

/**
 * How much the plan's answer moves with the inflation assumption.
 *
 * Included because on most plans this dominates every other lever, while
 * being the input people think about least — it arrives as a default and
 * never gets questioned.
 */
const inflationSensitivity: InsightRule = ({ plan }) => {
  const cpi = plan.assumptions.inflation;
  const household = plan.assumptions.householdInflation ?? cpi;

  const at = (rate: number) =>
    successProbability(
      { ...plan, assumptions: { ...plan.assumptions, householdInflation: rate } },
      { runs: 200 },
    );

  const atCpi = at(cpi);
  const atCurrent = at(household);
  const atHigh = at(household + 0.02);

  const spread = atCpi - atHigh;
  const severity: InsightSeverity = spread > 0.25 ? 'warning' : 'opportunity';

  return {
    id: 'inflation-sensitivity',
    severity,
    priority: 1,
    title: 'Inflation is the assumption this plan turns on',
    ruleOfThumb:
      'Official CPI indexes tax brackets, contribution limits and Social Security. It does not index your groceries.',
    body: `Household spending is currently assumed to rise ${pct(household, 1)} a year against official inflation of ${pct(cpi, 1)}. Moving that one number changes the answer more than a market crash does, because it compounds against every year of spending rather than a handful of them. It is also the number you have the least evidence for — which is the uncomfortable part.`,
    metrics: [
      {
        label: `If your basket tracks CPI (${pct(cpi, 1)})`,
        value: pct(atCpi),
        benchmark: 'success at planned age',
      },
      {
        label: `At your current assumption (${pct(household, 1)})`,
        value: pct(atCurrent),
      },
      {
        label: `If it runs two points hotter (${pct(household + 0.02, 1)})`,
        value: pct(atHigh),
      },
      { label: 'Total swing', value: `${(spread * 100).toFixed(0)} points` },
    ],
    action:
      'Worth tracking your own year-over-year spending once the budget history is imported — it is the only way to replace this guess with a measurement.',
  };
};

/**
 * Debt payoff as a cash-flow-liberation event.
 *
 * The usual framing of an extra payment — "you save $X in interest" — misses
 * the point when the goal is breathing room. Retiring a loan hands back its
 * whole monthly payment, and an extra payment brings that day *forward*. That
 * freed cash flow, not the interest, is often the real prize.
 */
const debtPayoff: InsightRule = ({ plan, projection, metrics }) => {
  const milestones = debtPayoffMilestones(plan.debts, plan.startYear, plan.startMonth);
  if (!milestones.length) return null;

  const monthName = (m: number) =>
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
      Math.min(11, Math.max(0, m - 1))
    ];

  // The soonest payoff is the one that matters for near-term flexibility.
  const soonest = milestones[0];
  const withExtra = plan.debts.find(
    (d) => d.id === soonest.debtId && d.extraMonthlyPayment > 0,
  );
  const impact = withExtra
    ? extraPaymentImpact(withExtra, plan.startYear, plan.startMonth)
    : undefined;

  // Liquid savings after the payoff — proof the freed cash actually lands in
  // the buffer rather than vanishing into the projection.
  const liquidIds = plan.accounts.filter((a) => isLiquid(a.type)).map((a) => a.id);
  const liquidAt = (year: number): number => {
    const row = projection.rows.find((r) => r.year === year);
    if (!row) return 0;
    return liquidIds.reduce((s, id) => s + (row.balancesByAccount[id] ?? 0), 0);
  };
  const target = (metrics.annualSpending / 12) * plan.assumptions.emergencyFundMonths;
  const reachesTargetYear = projection.rows.find(
    (r) => liquidAt(r.year) >= target && target > 0,
  )?.year;

  const metrics_: InsightMetric[] = milestones.slice(0, 3).map((m) => ({
    label: `${m.debtName} clears`,
    value: `${monthName(m.month)} ${m.year}`,
    benchmark: `frees ${money(m.freedMonthly)}/mo`,
  }));
  if (impact && withExtra) {
    metrics_.push({
      label: 'Extra payment pulls it forward',
      value: `${impact.monthsSaved} months`,
      benchmark: `+ ${money(impact.interestSaved)} interest saved`,
    });
  }

  const soonMonthly = soonest.freedMonthly;
  const payoffFillsFund = reachesTargetYear !== undefined && reachesTargetYear >= soonest.year;

  return {
    id: 'debt-payoff',
    severity: 'ok',
    priority: 2,
    title: `The ${soonest.debtName.toLowerCase()} frees ${money(soonMonthly)}/mo in ${monthName(soonest.month)} ${soonest.year}`,
    ruleOfThumb:
      'A retired loan returns its entire monthly payment to the budget. Extra principal buys an earlier payoff — and so an earlier release of that cash flow — on top of the interest it saves.',
    body: `When the ${soonest.debtName.toLowerCase()} clears in ${monthName(soonest.month)} ${soonest.year}, the ${money(soonMonthly)}/mo you're paying now stops leaving the budget entirely.${
      impact
        ? ` Your extra ${money(withExtra!.extraMonthlyPayment)}/mo pulls that forward by about ${impact.monthsSaved} months and saves ${money(impact.interestSaved)} in interest along the way — but the earlier date is the bigger prize, because it's ${impact.monthsSaved} months sooner that ${money(soonMonthly)} a month is back in your hands.`
        : ''
    } In the projection, that freed cash flows first into liquid savings${
      payoffFillsFund
        ? `, which is what carries the emergency fund to its ${plan.assumptions.emergencyFundMonths}-month target by around ${reachesTargetYear}`
        : ''
    }${impact ? ' — exactly the spending wiggle room the extra payment is meant to build' : ''}.${
      impact && payoffFillsFund
        ? " It does little for *today's* cushion, but it is a sound medium-term plan for one."
        : ''
    }${
      milestones.length > 1
        ? ` Further out, the ${milestones[1].debtName.toLowerCase()} frees another ${money(milestones[1].freedMonthly)}/mo in ${milestones[1].year}.`
        : ''
    }`,
    metrics: metrics_,
    action: reachesTargetYear
      ? undefined
      : 'The freed cash helps, but the model does not show the emergency fund reaching target on its own — worth pairing the payoff plan with a direct monthly transfer to liquid savings until it does.',
  };
};

/** Affirm *not* prepaying cheap debt — the decision most likely to be second-guessed. */
const cheapDebtAffirmation: InsightRule = ({ plan }) => {
  const cheap = plan.debts.filter(
    (d) => d.apr < 0.05 && d.extraMonthlyPayment === 0 && d.balance > 10_000,
  );
  if (!cheap.length) return null;

  const debt = cheap.reduce((a, b) => (a.balance > b.balance ? a : b));
  const equityReturn =
    plan.accounts.find((acc) => acc.expectedReturn > 0.05)?.expectedReturn ?? 0.07;

  return {
    id: 'cheap-debt-affirmation',
    severity: 'ok',
    priority: 3,
    title: `Not overpaying the ${pct(debt.apr, 2)} ${debt.name.toLowerCase()} is the right call`,
    ruleOfThumb:
      'Prepaying debt is worth it when the rate beats what the money would otherwise earn, after tax and after accounting for lost liquidity.',
    body: `At ${pct(debt.apr, 2)} this is cheaper than inflation is assumed to run, and well below what the same money is projected to earn invested. Paying it down early would feel productive and would quietly cost you. Money used to overpay is also money you cannot get back without selling the house.`,
    metrics: [
      { label: 'Rate on this debt', value: pct(debt.apr, 2) },
      { label: 'Assumed portfolio return', value: pct(equityReturn, 1) },
      { label: 'Assumed inflation', value: pct(plan.assumptions.inflation, 1) },
      { label: 'Balance', value: money(debt.balance) },
    ],
  };
};

/**
 * Life-insurance adequacy by actually re-running the plan for the survivor,
 * rather than applying a multiple-of-income rule.
 *
 * The rule of thumb exists because this calculation was hard before you had a
 * projection engine sitting right here.
 */
const survivorTest: InsightRule = ({ plan }) => {
  const earner = [...plan.incomes]
    .filter((i) => i.type === 'salary')
    .sort((a, b) => b.annualGross - a.annualGross)[0];
  if (!earner) return null;

  const person = plan.people.find((p) => p.id === earner.ownerId);
  if (!person) return null;

  const lifePolicies = plan.insurance.filter(
    (i) => i.type === 'life' && i.insuredPersonId === person.id,
  );
  const deathBenefit = lifePolicies.reduce((s, i) => s + i.coverageAmount, 0);

  // Group cover ends with the job, so it is absent in exactly the situations
  // where replacing it is hardest. The portable figure is the real floor.
  const portableBenefit = lifePolicies
    .filter((i) => !i.employmentContingent)
    .reduce((s, i) => s + i.coverageAmount, 0);
  const contingentBenefit = deathBenefit - portableBenefit;

  const destination =
    plan.accounts.find((a) => a.type === 'taxable') ??
    plan.accounts.find((a) => a.type === 'hysa');

  const survivors = plan.people.filter((p) => p.id !== person.id);
  if (!survivors.length) return null;

  // A surviving spouse receives the *larger* of their own benefit and the
  // deceased's, not both. Omitting this understates the survivor's position
  // materially — it is often the single biggest income line they have left.
  const survivorBenefit = Math.max(
    survivors[0].ssMonthlyAtFra ?? 0,
    person.ssMonthlyAtFra ?? 0,
  );

  const survivorPeople = survivors.map((p, i) =>
    i === 0 ? { ...p, ssMonthlyAtFra: survivorBenefit } : p,
  );
  const survivor = survivorPeople[0];

  const a = plan.assumptions;
  const spendFactor = a.survivorSpendingFactor ?? 0.82;
  const spendAfterChildren = a.survivorSpendingFactorAfterChildren ?? spendFactor;
  const independentYear = a.dependentsIndependentYear;
  const earningsFraction = a.survivorEarningsFraction ?? 0;
  const workDelay = a.survivorReturnToWorkDelayYears ?? 2;

  /**
   * Build the survivor's plan. `earnings` is separated out so the same
   * scenario can be run with and without the survivor working — the
   * difference between those two is usually larger than the death benefit,
   * and pretending otherwise turns an assumption into a conclusion.
   */
  const buildSurvivorPlan = (benefit: number, earnings: number): Plan => {
    const incomes = plan.incomes.filter((i) => i.ownerId !== person.id);

    if (earnings > 0 && survivor) {
      incomes.push({
        id: 'survivor-earnings',
        name: `${survivor.name} — returning to work`,
        type: 'salary',
        ownerId: survivor.id,
        annualGross: earner.annualGross * earnings,
        realGrowthRate: 0,
        startYear: plan.startYear + workDelay,
        subjectToFica: true,
      });
    }

    return {
      ...plan,
      people: survivorPeople,
      incomes,
      accounts: plan.accounts.map((acc) =>
        acc.id === destination?.id ? { ...acc, balance: acc.balance + benefit } : acc,
      ),
      expenses: plan.expenses.flatMap((e) => {
        // A household of two rather than three spends less, but far from a
        // third less — housing, insurance and utilities barely move.
        if (!independentYear) return [{ ...e, monthlyAmount: e.monthlyAmount * spendFactor }];
        // Split each line in two at the point the child is independent, so
        // the step down is modelled rather than assumed away.
        return [
          {
            ...e,
            id: `${e.id}-dep`,
            monthlyAmount: e.monthlyAmount * spendFactor,
            endYear: Math.min(e.endYear ?? independentYear - 1, independentYear - 1),
          },
          {
            ...e,
            id: `${e.id}-indep`,
            monthlyAmount: e.monthlyAmount * spendAfterChildren,
            startYear: Math.max(e.startYear ?? independentYear, independentYear),
          },
        ];
      }),
      insurance: plan.insurance.filter((i) => i.insuredPersonId !== person.id),
    };
  };

  const survivorPlan = buildSurvivorPlan(deathBenefit, earningsFraction);

  const result = project(survivorPlan);
  const survives = result.succeeded;

  // When a shortfall lands matters as much as whether it does. Running dry at
  // 90 is a different problem from running dry at 55 — the first is decades of
  // warning, the second is a crisis.
  const shortfallRow = result.depletionYear
    ? result.rows.find((r) => r.year === result.depletionYear)
    : undefined;
  const shortfallAge = shortfallRow?.primaryAge;
  const yearsOfCover = result.depletionYear ? result.depletionYear - plan.startYear : undefined;

  const withBenefit = (amount: number, earnings = earningsFraction): boolean =>
    project(buildSurvivorPlan(amount, earnings)).succeeded;

  const withoutCover = withBenefit(0);

  // The assumption that usually dominates: whether the survivor ever works
  // again. Reported explicitly so it can be judged rather than inherited.
  const survivesWithoutWorking = earningsFraction > 0 ? withBenefit(deathBenefit, 0) : survives;

  // And whether the answer holds on portable cover alone — the case that
  // applies after a job change, a layoff, or retirement.
  const survivesPortableOnly =
    contingentBenefit > 0 ? withBenefit(portableBenefit) : survives;

  /**
   * When the test fails, the useful output is not "you are short" but "you are
   * short by roughly this much". More cover is monotonically better, so the
   * threshold can be bisected — about a dozen projections, which is nothing.
   */
  let requiredBenefit: number | undefined;
  if (!survives) {
    let lo = deathBenefit;
    let hi = Math.max(deathBenefit * 2, 1_000_000);
    // Expand until a level that works is found, or give up as unreachable.
    let feasible = false;
    for (let i = 0; i < 6; i++) {
      if (withBenefit(hi)) {
        feasible = true;
        break;
      }
      lo = hi;
      hi *= 2;
    }
    if (feasible) {
      while (hi - lo > 25_000) {
        const mid = Math.round((lo + hi) / 2);
        if (withBenefit(mid)) hi = mid;
        else lo = mid;
      }
      requiredBenefit = hi;
    }
  }

  // Severity follows how much warning there would be, not merely whether a
  // shortfall exists somewhere in a fifty-year projection. Life cover is a
  // bridge that buys a household time to adjust; a gap four decades out is a
  // note, not an emergency.
  const severity: InsightSeverity = survives
    ? 'ok'
    : (yearsOfCover ?? 0) < 10
      ? 'critical'
      : (yearsOfCover ?? 0) < 20
        ? 'warning'
        : 'opportunity';

  return {
    id: 'survivor-test',
    severity,
    priority: 4,
    title: survives
      ? `${money(deathBenefit)} of cover carries the household`
      : yearsOfCover !== undefined
        ? `${money(deathBenefit)} of cover funds about ${yearsOfCover} years`
        : `${money(deathBenefit)} of cover leaves the household short`,
    ruleOfThumb:
      'Commonly quoted as 10–15× income. Tested here by re-running the whole plan without that income instead — which accounts for the assets already accumulated, the years until dependants are independent, and what the survivor would plausibly earn. A multiple accounts for none of those.',
    body: survives
      ? `Removing ${person.name === 'Me' ? 'your' : `${person.name}'s`} income and adding the ${money(deathBenefit)} benefit, the plan still funds every year. The rule-of-thumb multiple would call this underinsured at ${(deathBenefit / earner.annualGross).toFixed(1)}× income; running the actual numbers says otherwise, because the multiple ignores what you have already saved.${withoutCover ? '' : ' The cover is doing real work — without it the plan fails.'}${
          contingentBenefit > 0
            ? survivesPortableOnly
              ? ` ${money(contingentBenefit)} of this ends with the job, but the plan holds on the portable ${money(portableBenefit)} alone — so a job change would not open a gap.`
              : ` Worth noting that ${money(contingentBenefit)} of it ends with the job: on the portable ${money(portableBenefit)} alone the plan does not hold. The group cover is doing necessary work, and it is exactly what disappears in a layoff.`
            : ''
        }`
      : `Removing ${person.name === 'Me' ? 'your' : `${person.name}'s`} income and adding the ${money(deathBenefit)} benefit, the household is funded for roughly ${yearsOfCover} years — to about age ${shortfallAge} — before the money runs out. Treated as a bridge rather than a permanent endowment, that is the relevant number: it covers the years in which the household has no time to adapt, and by the far end of it the child is long independent and the survivor has had decades to rebuild.${
          requiredBenefit
            ? ` Closing the remaining gap entirely would take about ${money(requiredBenefit)}, or ${money(requiredBenefit - deathBenefit)} more than is in place.`
            : ''
        } ${
          earningsFraction > 0
            ? `This already assumes the survivor returns to work at ${pct(earningsFraction)} of the lost salary after ${workDelay} years${survivesWithoutWorking ? '' : ` — without that, the cover runs out considerably sooner`}. That assumption moves the answer more than the death benefit does, which is worth knowing before buying anything on the strength of it.`
            : 'This assumes the survivor never earns again, which is usually the assumption doing the damage rather than the size of the policy.'
        }`,
    metrics: [
      { label: 'Total death benefit', value: money(deathBenefit) },
      ...(contingentBenefit > 0
        ? [
            {
              label: 'Portable (survives a job change)',
              value: money(portableBenefit),
              benchmark: `${money(contingentBenefit)} ends with the job`,
            },
          ]
        : []),
      {
        label: 'As a multiple of income',
        value: `${(deathBenefit / earner.annualGross).toFixed(1)}×`,
        benchmark: '10–15× rule of thumb',
      },
      {
        label: 'Years of cover it buys',
        value: yearsOfCover !== undefined ? `~${yearsOfCover}` : 'Full plan',
        benchmark: shortfallAge ? `to about age ${shortfallAge}` : 'never runs out',
      },
      ...(requiredBenefit
        ? [
            {
              label: 'Cover that would close it fully',
              value: money(requiredBenefit),
              benchmark: `${money(requiredBenefit - deathBenefit)} more than in place`,
            },
          ]
        : []),
      ...(earningsFraction > 0
        ? [
            {
              label: 'If the survivor never works again',
              value: survivesWithoutWorking ? 'Still holds' : 'Runs out sooner',
              benchmark: `assumes ${pct(earningsFraction)} of salary from year ${workDelay}`,
            },
          ]
        : []),
      { label: 'Without any life cover', value: withoutCover ? 'Also survives' : 'Fails' },
      ...(contingentBenefit > 0
        ? [
            {
              label: 'On portable cover alone',
              value: survivesPortableOnly ? 'Still holds' : 'Fails',
            },
          ]
        : []),
      {
        label: 'Survivor Social Security',
        value: `${money(survivorBenefit)}/mo`,
        benchmark: 'higher of the two records',
      },
      {
        label: 'Spending assumed to fall',
        value: pct(1 - spendFactor),
        benchmark: independentYear
          ? `then ${pct(1 - spendAfterChildren)} from ${independentYear}`
          : undefined,
      },
    ],
    action: survives
      ? contingentBenefit > 0 && !survivesPortableOnly
        ? 'The group portion is load-bearing and it is not yours — it ends with the job. Worth knowing before a job change, and worth asking whether it is convertible to an individual policy on leaving, which many group plans allow within a short window.'
        : undefined
      : (yearsOfCover ?? 0) >= 20
        ? `No action implied. Two decades of funding is what a bridge is meant to do, and the gap sits far enough out that earnings, downsizing or a less pessimistic Social Security assumption would each close it. Revisit if the horizon shortens materially.`
        : `Worth pricing roughly ${money((requiredBenefit ?? deathBenefit) - deathBenefit)} of additional term cover — at your age that is usually inexpensive. Before doing so, try the same test with Social Security at a less pessimistic figure and with the survivor downsizing; either might close it without buying anything.`,
  };
};

/** The low-income years between retiring and RMDs starting. */
const rothConversionWindow: InsightRule = ({ plan, projection }) => {
  const primary = plan.people[0];
  if (!primary) return null;

  const birthYear = Number(primary.birthMonth.slice(0, 4));
  const rmdAge = rmdStartAge(birthYear);
  const gapYears = rmdAge - primary.retirementAge;
  if (gapYears < 2) return null;

  const pretaxNow = plan.accounts
    .filter((a) => taxBucketOf(a.type) === 'pretax')
    .reduce((s, a) => s + a.balance, 0);
  if (pretaxNow < 100_000) return null;

  // Bracket space in the first gap year: what could be converted before
  // tipping into the next bracket up.
  const firstGapRow = projection.rows.find((r) => r.primaryAge === primary.retirementAge);
  const table = taxTableFor(firstGapRow?.year ?? plan.startYear, plan.assumptions.inflation);
  const brackets = table.ordinaryBrackets[plan.assumptions.filingStatus];
  const topOf22 = brackets.find((b) => b.rate === 0.24)?.floor ?? 0;
  const taxableThatYear = Math.max(
    0,
    (firstGapRow?.grossIncome ?? 0) - table.standardDeduction[plan.assumptions.filingStatus],
  );
  const spacePerYear = Math.max(0, topOf22 - taxableThatYear);

  const gapYear = firstGapRow?.year ?? plan.startYear;
  const pretaxAtRetirement = inTodaysMoney(
    plan,
    firstGapRow?.balancesByBucket.pretax ?? pretaxNow,
    gapYear,
  );
  const spaceToday = inTodaysMoney(plan, spacePerYear, gapYear);

  return {
    id: 'roth-conversion-window',
    severity: 'opportunity',
    priority: 5,
    title: `${gapYears} low-income years between retiring and RMDs`,
    ruleOfThumb:
      'Required minimum distributions begin at 75 for anyone born in 1960 or later, and are taxed as ordinary income whether or not the money is needed.',
    body: `Retiring at ${primary.retirementAge} with RMDs starting at ${rmdAge} leaves ${gapYears} years in which taxable income is unusually low — roughly ${money(inTodaysMoney(plan, firstGapRow?.grossIncome ?? 0, gapYear))} in the first of them, in today's money. Moving money from pre-tax to Roth during that window is taxed at whatever bracket it fills, and the projection already shows the tax bill jumping sharply once distributions become mandatory at ${rmdAge}. There is roughly ${money(spaceToday)} of room per year below the 24% bracket.`,
    metrics: [
      { label: 'Pre-tax balance today', value: money(pretaxNow) },
      {
        label: 'Projected at retirement',
        value: money(pretaxAtRetirement),
        benchmark: "today's dollars",
      },
      { label: 'Conversion window', value: `${gapYears} years` },
      {
        label: 'Room below 24% (first year)',
        value: money(spaceToday),
        benchmark: "today's dollars",
      },
    ],
    action:
      'A genuinely fiddly area — the interaction with Medicare IRMAA surcharges and capital-gains brackets is not modeled here. Worth raising with your advisor well before you retire, since the window cannot be used retroactively.',
  };
};

/** Contributions sitting just under the statutory limits. */
const contributionHeadroom: InsightRule = ({ plan }) => {
  const table = taxTableFor(plan.startYear, plan.assumptions.inflation);
  const shortfalls: { name: string; annual: number; limit: number; gap: number }[] = [];

  for (const account of plan.accounts) {
    const annual = account.monthlyContribution * 12;
    if (annual <= 0) continue;

    let limit = 0;
    if (account.type === 'roth_ira' || account.type === 'ira_traditional') limit = table.limitIra;
    else if (account.type === '401k_traditional' || account.type === '401k_roth')
      limit = table.limit401kEmployee;
    if (!limit) continue;

    const gap = limit - annual;
    if (gap > 100 && gap < limit * 0.25) {
      shortfalls.push({ name: account.name, annual, limit, gap });
    }
  }

  if (!shortfalls.length) return null;
  const total = shortfalls.reduce((s, x) => s + x.gap, 0);

  return {
    id: 'contribution-headroom',
    severity: 'opportunity',
    priority: 6,
    title: `${money(total)}/yr of unused tax-advantaged room`,
    ruleOfThumb:
      'Contribution limits are use-it-or-lose-it: unused room in a year does not carry forward.',
    body: `Some accounts are contributing close to the statutory limit but not quite at it. The amounts are small, and this is the easiest thing on this page to fix — it is a standing-order adjustment, not a decision.`,
    metrics: shortfalls.map((s) => ({
      label: s.name,
      value: `${money(s.gap)}/yr short`,
      benchmark: `${money(s.annual)} of ${money(s.limit)}`,
    })),
    action: `About ${money(total / 12)} a month across the accounts listed would close it — though not before the emergency fund, if that is still thin.`,
  };
};

/** Where the money sits, for tax purposes. */
const taxDiversification: InsightRule = ({ plan, projection }) => {
  const first = projection.rows[0];
  if (!first) return null;

  const pretax = first.balancesByBucket.pretax;
  const roth = first.balancesByBucket.roth;
  const taxable = first.balancesByBucket.taxable;
  const total = pretax + roth + taxable;
  if (total <= 0) return null;

  const primary = plan.people[0];
  const retiresBefore59 = primary ? primary.retirementAge < 60 : false;
  const taxableShare = taxable / total;

  return {
    id: 'tax-diversification',
    severity: retiresBefore59 && taxableShare < 0.1 ? 'warning' : 'opportunity',
    priority: 7,
    title: `${pct(pretax / total)} of savings is in pre-tax accounts`,
    ruleOfThumb:
      'Money in pre-tax accounts is taxed as ordinary income on withdrawal and is generally locked until 59½; Roth is neither; taxable is reachable at any age and taxed only on gains.',
    body: retiresBefore59
      ? `Retiring at ${primary?.retirementAge} means several years before pre-tax accounts are freely reachable, and taxable savings currently make up ${pct(taxableShare)} of the total. That gap has to be bridged somehow.`
      : `Retiring at ${primary?.retirementAge} sidesteps the early-access problem, so this is about tax flexibility rather than reach. A large pre-tax balance means less control over which bracket a given year's income lands in — the same thing that makes the conversion window above worth using.`,
    metrics: [
      { label: 'Pre-tax', value: money(pretax), benchmark: pct(pretax / total) },
      { label: 'Roth', value: money(roth), benchmark: pct(roth / total) },
      { label: 'Taxable & cash', value: money(taxable), benchmark: pct(taxableShare) },
    ],
  };
};

/** Whether saving more is still necessary, or merely comforting. */
const coastFi: InsightRule = ({ metrics }) => {
  if (metrics.coastAge === undefined) return null;
  const coasting = metrics.coastAge <= metrics.currentAge;

  return {
    id: 'coast-fi',
    severity: coasting ? 'ok' : 'opportunity',
    priority: 8,
    title: coasting
      ? 'On average returns, contributions could already stop'
      : `Contributions are needed until about age ${metrics.coastAge}`,
    ruleOfThumb:
      '"Coast FI" is the point at which existing savings, left alone to compound, reach the retirement target without further contributions.',
    body: coasting
      ? `On the average-return path, what is already invested compounds to the target without another dollar going in — so additional saving is buying margin rather than necessity. Read that carefully, though: it is measured on the single averaged path, not across simulated histories, and the margin it calls optional is exactly what absorbs a bad decade. The honest reading is "you are not behind", not "you can stop".`
      : `Existing balances alone do not reach the target yet. Contributions are doing necessary work, not just building cushion.`,
    metrics: [
      { label: 'Coast age', value: `${metrics.coastAge}` },
      { label: 'Current age', value: `${metrics.currentAge}` },
      { label: 'Saving each year', value: money(metrics.annualSavings) },
      { label: 'Savings rate', value: pct(metrics.savingsRate, 1) },
    ],
  };
};

/** How much of net worth is a house you have no intention of selling. */
const assetConcentration: InsightRule = ({ plan, projection }) => {
  const first = projection.rows[0];
  if (!first || first.netWorth <= 0) return null;

  const property = plan.assets
    .filter((a) => a.type === 'real_estate')
    .reduce((s, a) => s + a.value, 0);
  if (property <= 0) return null;

  const share = property / (first.netWorth + first.debtBalance);
  if (share < 0.35) return null;

  return {
    id: 'asset-concentration',
    severity: share > 0.55 ? 'warning' : 'opportunity',
    priority: 9,
    title: `${pct(share)} of assets is the house`,
    ruleOfThumb:
      'A primary residence produces no income and cannot be partially sold. It counts toward net worth but not toward funding retirement.',
    body: `The house is the largest single asset here. It is not a problem — it is shelter, and it is appreciating — but it is worth being clear that this portion of net worth cannot pay for groceries without moving. The retirement projection already excludes it for exactly that reason, which is why the investable figure is so much smaller than net worth.`,
    metrics: [
      { label: 'Property value', value: money(property) },
      { label: 'Investable assets', value: money(first.investableAssets) },
      { label: 'Share of gross assets', value: pct(share) },
    ],
  };
};

/** Whether the plan is quietly leaning on an inheritance. */
const windfallDependency: InsightRule = ({ plan }) => {
  if (!plan.windfalls.length) return null;

  const without = project(plan, { includeWindfalls: false }).succeeded;
  const withThem = project(plan, { includeWindfalls: true });
  const total = plan.windfalls.reduce((s, w) => s + w.amount, 0);
  const anyIncluded = plan.windfalls.some((w) => w.included);

  return {
    id: 'windfall-dependency',
    severity: without ? 'ok' : 'critical',
    priority: 10,
    title: without
      ? 'The plan works without the inheritances'
      : 'The plan currently depends on an inheritance arriving',
    ruleOfThumb:
      'Expected inheritances are not assets. Timing, amount and whether they arrive at all are outside your control.',
    body: without
      ? `Excluding every expected windfall, the plan still funds itself. That is the right footing: the ${money(total)} becomes an accelerator rather than a dependency, and nothing about the plan requires anyone to die on schedule.${anyIncluded ? ' Note some windfalls are currently switched on in the baseline.' : ''}`
      : `Without the expected windfalls the plan runs out of money. That makes ${money(total)} of someone else's money load-bearing, which is worth knowing explicitly.`,
    metrics: [
      { label: 'Total expected', value: money(total) },
      { label: 'Plan succeeds without them', value: without ? 'Yes' : 'No' },
      {
        label: 'Final net worth with them',
        value: money(
          inTodaysMoney(
            plan,
            withThem.finalNetWorth,
            withThem.rows[withThem.rows.length - 1]?.year ?? plan.startYear,
          ),
        ),
        benchmark: "today's dollars",
      },
    ],
  };
};

/** What assuming Social Security away is costing. */
const socialSecuritySensitivity: InsightRule = ({ plan }) => {
  const haircut = plan.assumptions.ssHaircut;
  if (haircut >= 0.9) return null;
  if (!plan.people.some((p) => (p.ssMonthlyAtFra ?? 0) > 0)) return null;

  const at = (h: number) =>
    successProbability(
      { ...plan, assumptions: { ...plan.assumptions, ssHaircut: h } },
      { runs: 200 },
    );

  const current = at(haircut);
  const trustee = at(0.78);
  const full = at(1);

  return {
    id: 'social-security-sensitivity',
    severity: 'opportunity',
    priority: 11,
    title: `Assuming ${pct(haircut)} of Social Security costs less than it might seem`,
    ruleOfThumb:
      "Social Security's trustees project that, absent any change in law, incoming payroll tax would cover roughly three-quarters of scheduled benefits after the trust fund is depleted.",
    body: `The plan currently assumes only ${pct(haircut)} of scheduled benefits arrive. That is a deliberately pessimistic hedge, and the useful question is what it costs to hold it. The difference between that assumption and a less severe one turns out to be ${Math.abs(Math.round((trustee - current) * 100))} points of success probability — worth knowing, but not the load-bearing assumption inflation is.`,
    metrics: [
      { label: `Your assumption (${pct(haircut)})`, value: pct(current) },
      { label: 'Trustee projection (~78%)', value: pct(trustee) },
      { label: 'Full scheduled benefit', value: pct(full) },
    ],
  };
};

/**
 * Disability cover, judged on what it would actually pay rather than on the
 * headline percentage.
 *
 * Three things routinely make a "60% of income" policy worth much less than
 * it sounds: a flat benefit cap that doesn't index, tax on the benefit when
 * the employer paid the premium, and the switch from own-occupation to any
 * gainful occupation after a couple of years.
 */
const disabilityAdequacy: InsightRule = ({ plan, metrics }) => {
  const allDisability = plan.insurance.filter((i) => i.type === 'disability');
  if (!allDisability.length) return null;

  // A permanent disability is a long-term event, so the replacement figure is
  // built from long-term policies only. Short-term cover matters for the
  // emergency-fund gap (handled in that rule) but would badly overstate the
  // lasting income if counted here.
  const shortTerm = allDisability.filter((p) => p.disabilityTerm === 'short');
  const policies = allDisability.filter((p) => p.disabilityTerm !== 'short');
  if (!policies.length) return null;

  const singleEarner =
    plan.incomes.filter((i) => i.type === 'salary' && i.annualGross > 20_000).length <= 1;

  const salary = plan.incomes
    .filter((i) => i.type === 'salary')
    .reduce((s, i) => s + i.annualGross, 0);
  if (salary <= 0) return null;

  // The group policy carries the terms worth reporting; individual policies
  // are simpler and mostly matter for their tax treatment.
  const detailed =
    policies.find((p) => p.ownOccupationMonths !== undefined) ??
    policies.find((p) => p.eliminationPeriodDays !== undefined);
  const unknowns = policies.filter((p) => p.benefitTaxable === undefined);
  const reviewed = policies.filter((p) => p.benefitTaxable !== undefined);

  const benefitOf = (p: (typeof policies)[number]) =>
    Math.min(p.coverageAmount, (p.monthlyBenefitCap ?? Infinity) * 12);

  const grossBenefit = (reviewed.length ? reviewed : policies).reduce(
    (s, p) => s + benefitOf(p),
    0,
  );

  // Split by tax treatment, because a tax-free dollar of benefit is worth
  // materially more than a taxable one — which is the entire reason an
  // individually-paid policy is a different animal from an employer's.
  const taxableBenefit = reviewed.filter((p) => p.benefitTaxable).reduce((s, p) => s + benefitOf(p), 0);
  const taxFreeBenefit = reviewed.filter((p) => p.benefitTaxable === false).reduce((s, p) => s + benefitOf(p), 0);
  const cappedPolicy = policies.find((p) => p.monthlyBenefitCap !== undefined);
  const capBinds =
    cappedPolicy !== undefined &&
    cappedPolicy.coverageAmount >= (cappedPolicy.monthlyBenefitCap ?? 0) * 12 - 1;

  const replacement = grossBenefit / salary;
  const monthlySpending = metrics.annualSpending / 12;

  // What would actually land in the bank, against what lands there now.
  // Gross replacement percentages are close to meaningless across policies
  // with different tax treatment; this is the comparison that isn't.
  const table = taxTableFor(plan.startYear, plan.assumptions.inflation);
  const taxInput = {
    ordinaryIncome: 0,
    longTermGains: 0,
    socialSecurityBenefit: 0,
    pretaxDeferrals: 0,
    wages: 0,
    selfEmployment: 0,
    filingStatus: plan.assumptions.filingStatus,
    stateCode: plan.assumptions.stateCode,
    table,
  };

  const benefitTax = computeTaxes({ ...taxInput, ordinaryIncome: taxableBenefit }).total;
  const netOnClaim = taxableBenefit - benefitTax + taxFreeBenefit;

  // Current take-home: gross, less tax, less what never reaches the account.
  const pretaxDeferrals = plan.accounts
    .filter((a) => a.type === '401k_traditional' || a.type === 'ira_traditional' || a.type === 'hsa')
    .reduce((s, a) => s + a.monthlyContribution * 12, 0);
  const currentTax = computeTaxes({
    ...taxInput,
    ordinaryIncome: salary,
    wages: salary,
    pretaxDeferrals,
  }).total;
  const currentTakeHome = salary - currentTax - pretaxDeferrals;
  const netReplacement = currentTakeHome > 0 ? netOnClaim / currentTakeHome : 0;

  // A short-term policy bridges to long-term cover only if it is still paying
  // when the long-term elimination period ends, and an unrecorded benefit period
  // is not counted on. Otherwise there are two unpaid windows: before it and after.
  const longElim = detailed?.eliminationPeriodDays;
  const firstShort = shortTerm
    .filter((p) => p.eliminationPeriodDays !== undefined)
    .sort((a, b) => (a.eliminationPeriodDays ?? 0) - (b.eliminationPeriodDays ?? 0))[0];
  const shortElim = firstShort?.eliminationPeriodDays;
  const shortEnds =
    shortElim !== undefined && firstShort?.benefitPeriodWeeks !== undefined
      ? shortElim + firstShort.benefitPeriodWeeks * 7
      : undefined;
  const effectiveElim = Math.min(
    longElim ?? Infinity,
    shortElim ?? Infinity,
  );
  const elimination = Number.isFinite(effectiveElim) ? effectiveElim : undefined;
  const stdPaysFirst = shortElim !== undefined && longElim !== undefined && shortElim < longElim;
  const stdBridges = stdPaysFirst && shortEnds !== undefined && shortEnds >= longElim;
  const unpaidDays =
    stdPaysFirst && !stdBridges ? shortElim + longElim - (shortEnds ?? shortElim) : elimination;
  const monthsUncovered = unpaidDays ? unpaidDays / 30 : 0;
  const cashNeeded = monthsUncovered * monthlySpending;
  const eliminationGap = unpaidDays !== undefined && metrics.emergencyFundMonths < monthsUncovered;

  const metrics_: InsightMetric[] = [
    {
      label: reviewed.length < policies.length ? 'Confirmed replacement' : 'Gross replacement',
      value: pct(replacement),
      benchmark: `${money(grossBenefit)}/yr of ${money(salary)}`,
    },
  ];

  if (taxFreeBenefit > 0 && taxableBenefit > 0) {
    metrics_.push({
      label: 'Taxable / tax-free split',
      value: `${money(taxableBenefit)} / ${money(taxFreeBenefit)}`,
      benchmark: 'group is taxed, individual is not',
    });
  } else if (detailed?.benefitTaxable) {
    metrics_.push({
      label: 'Benefit is taxable',
      value: 'Yes',
      benchmark: 'employer paid the premium',
    });
  }

  metrics_.push({
    label: 'Net vs current take-home',
    value: pct(netReplacement),
    benchmark: `${money(netOnClaim / 12)}/mo vs ${money(currentTakeHome / 12)}/mo`,
  });
  if (cappedPolicy?.monthlyBenefitCap) {
    metrics_.push({
      label: 'Monthly cap',
      value: money(cappedPolicy.monthlyBenefitCap),
      benchmark: capBinds ? 'already binding' : 'headroom remains',
    });
  }
  if (detailed?.ownOccupationMonths) {
    metrics_.push({
      label: 'Own-occupation for',
      value: `${detailed.ownOccupationMonths} months`,
      benchmark: 'then any gainful occupation',
    });
  }
  if (unpaidDays) {
    metrics_.push({
      label:
        !stdPaysFirst || stdBridges
          ? 'Nothing pays for'
          : shortEnds !== undefined
            ? 'Days with no benefit'
            : 'Counted as unpaid',
      value: `${unpaidDays} days`,
      benchmark: stdBridges
        ? `short-term cover then bridges to day ${longElim}`
        : `${money(cashNeeded)} of cash needed`,
    });
  }
  if (detailed?.mentalHealthLimitMonths) {
    metrics_.push({
      label: 'Mental-health claims capped at',
      value: `${detailed.mentalHealthLimitMonths} months`,
      benchmark: 'lifetime, incl. self-reported symptoms',
    });
  }

  const parts: string[] = [];
  if (capBinds && cappedPolicy?.monthlyBenefitCap) {
    const insuredSalary =
      plan.incomes
        .filter((i) => i.type === 'salary' && i.ownerId === cappedPolicy.insuredPersonId)
        .reduce((s, i) => s + i.annualGross, 0) || salary;
    parts.push(
      `The stated percentage is already meeting its flat ${money(cappedPolicy.monthlyBenefitCap)}/mo cap, so it is the most this will ever pay. Because the cap does not index, every raise and every year of inflation lowers the effective replacement rate from here — a raise to ${money(insuredSalary * 1.2)} would quietly turn "${pct(cappedPolicy.coverageAmount / insuredSalary)}" into ${pct((cappedPolicy.monthlyBenefitCap * 12) / (insuredSalary * 1.2))}.`,
    );
  }
  if (taxFreeBenefit > 0 && taxableBenefit > 0) {
    parts.push(
      `The two policies are taxed differently, which is why gross percentages mislead here: the employer's is taxable because the employer pays for it, while the individually-paid one arrives tax-free. Netted out, a long-term claim would deliver about ${money(netOnClaim / 12)} a month against current take-home of ${money(currentTakeHome / 12)} — ${pct(netReplacement)}. The tax-free portion carries more of that than its size suggests: a tax-free dollar of benefit does the work of roughly ${(1 / (1 - 0.25)).toFixed(1)} taxable ones.`,
    );
  } else if (detailed?.benefitTaxable) {
    parts.push(
      `The benefit is taxable because the employer pays the premium, so a claim nets about ${money(netOnClaim / 12)} a month against current take-home of ${money(currentTakeHome / 12)} — ${pct(netReplacement)}. Less brutal than the gross figure suggests, since disability income is taxed at far lower marginal rates than a salary.`,
    );
  }
  if (detailed?.ownOccupationMonths) {
    parts.push(
      `Cover is own-occupation for ${detailed.ownOccupationMonths} months and then switches to *any gainful occupation you are reasonably fitted for* — a far harder test to keep meeting, and the point at which many long claims end.`,
    );
  }
  if (stdBridges && elimination) {
    parts.push(
      `On timing, the pieces fit together better than they first look: short-term cover starts after ${elimination} days and runs until the long-term policy begins around day ${longElim}, so the true no-income window is ${elimination} days rather than ${longElim}. That still needs roughly ${money(cashNeeded)} in cash — the one place this connects to the emergency fund — but it is a ${elimination}-day gap, not a ${longElim}-day one.`,
    );
  } else if (stdPaysFirst && unpaidDays) {
    parts.push(
      shortEnds !== undefined
        ? `On timing, there is a hole between the two policies: short-term cover starts after ${shortElim} days but stops around day ${shortEnds}, and the long-term policy does not begin until around day ${longElim}. That leaves ${unpaidDays} days with no benefit — the first ${shortElim} and another ${longElim - shortEnds} between the two — and bridging them needs roughly ${money(cashNeeded)} in cash against the ${metrics.emergencyFundMonths.toFixed(1)} months currently held.`
        : `Short-term cover starts after ${shortElim} days, but its benefit period is not recorded, so it cannot be counted on to last until the long-term policy begins around day ${longElim}. Counting the full ${longElim} days, bridging needs roughly ${money(cashNeeded)} in cash against the ${metrics.emergencyFundMonths.toFixed(1)} months currently held.`,
    );
  } else if (eliminationGap && elimination) {
    parts.push(
      `The ${elimination}-day elimination period is where this meets the emergency fund: nothing arrives for that whole window, and bridging it needs roughly ${money(cashNeeded)} in cash against the ${metrics.emergencyFundMonths.toFixed(1)} months currently held.`,
    );
  }

  const severity: InsightSeverity =
    eliminationGap && !stdBridges ? 'warning' : capBinds && singleEarner ? 'warning' : 'opportunity';

  return {
    id: 'disability-adequacy',
    severity,
    priority: 12,
    title:
      capBinds && singleEarner
        ? 'The disability cap quietly erodes with every raise'
        : `Disability replaces about ${pct(netReplacement)} of take-home if you can't work`,
    ruleOfThumb:
      'When an employer pays the premium the benefit is generally taxable; when you pay it with after-tax money it generally is not. Flat benefit caps are rarely indexed.',
    body: parts.join(' '),
    metrics: metrics_,
    action: unknowns.length
      ? `Still to confirm on the individually-owned policy: ${unknowns.map((p) => p.name).join(', ')} — specifically its own-occupation definition, which individual policies usually have but the paperwork should state.`
      : capBinds && cappedPolicy?.monthlyBenefitCap
        ? `${severity === 'opportunity' && !eliminationGap ? 'Nothing urgent. ' : ''}The ${money(cappedPolicy.monthlyBenefitCap)}/mo cap does not index, so each raise lowers the share of income it replaces. Worth revisiting the cover after a significant raise.`
        : undefined,
  };
};

/**
 * A skipped raise doesn't cost one year — it lowers the whole curve.
 *
 * The lifetime figure is measured by re-projecting the plan with the freeze
 * removed, which is the only way to capture the compounding rather than the
 * headline one-year gap.
 */
const raiseFreeze: InsightRule = ({ plan }) => {
  const frozen = plan.incomes.filter((i) => (i.freezeYears?.length ?? 0) > 0);
  if (!frozen.length) return null;

  const income = frozen[0];
  const years = income.freezeYears ?? [];
  const growth = income.nominalGrowthRate ?? 0.03;

  const unfrozen: Plan = {
    ...plan,
    incomes: plan.incomes.map((i) => (i.id === income.id ? { ...i, freezeYears: [] } : i)),
  };

  const withFreeze = project(plan);
  const without = project(unfrozen);
  const finalYear = withFreeze.rows[withFreeze.rows.length - 1]?.year ?? plan.startYear;
  const lifetimeCost = inTodaysMoney(
    plan,
    Math.max(0, without.finalNetWorth - withFreeze.finalNetWorth),
    finalYear,
  );
  const annualGap = income.annualGross * growth;

  return {
    id: 'raise-freeze',
    severity: 'warning',
    priority: 13,
    title: `A skipped raise is permanent, not a one-year dip`,
    ruleOfThumb:
      'Raises compound. A year without one lowers every subsequent year by the same proportion, because the next raise is applied to the smaller base.',
    body: `${years.length === 1 ? `No raise in ${years[0]}` : `No raise in ${years.join(', ')}`} means pay never catches back up to where the ${pct(growth)} trend would have put it — every later year sits about ${pct(growth)} below the line it would otherwise have followed. The immediate gap is roughly ${money(annualGap)} of salary; the compounding is what makes it worth raising rather than absorbing.`,
    metrics: [
      { label: 'Frozen year(s)', value: years.join(', ') },
      { label: 'Normal raise', value: pct(growth) },
      { label: 'Salary gap, first year', value: money(annualGap) },
      {
        label: 'Cost by end of plan',
        value: money(lifetimeCost),
        benchmark: "today's dollars",
      },
    ],
    action:
      'Worth noting for the next compensation conversation — the argument for a catch-up adjustment is stronger than for a normal raise, because the gap persists.',
  };
};

/**
 * What the modelled fees cost, measured against a low-cost alternative.
 *
 * Once fees are an explicit input this stops being a hypothetical and can become
 * one of the largest levers on the page: the same portfolio in an index wrapper
 * would keep most of what the advisory fee removes, and over a multi-decade
 * horizon that difference can outweigh much else here.
 */
const INDEX_FUND_COST = 0.0015;
/** Above this, a fee reads as advisory/wrapper cost rather than a cheap fund. */
const ADVISORY_FEE_FLOOR = 0.01;

const feeDrag: InsightRule = ({ plan }) => {
  // Focus on the genuinely expensive accounts — the advisory-fee story — not
  // a low-cost employer 401(k) that happens to sit above an index fund.
  const advisory = plan.accounts.filter(
    (acc) => (acc.annualFee ?? 0) >= ADVISORY_FEE_FLOOR && acc.balance > 0,
  );
  if (!advisory.length) return null;

  const advisoryIds = new Set(advisory.map((a) => a.id));
  const advisoryBalance = advisory.reduce((s, a) => s + a.balance, 0);
  const feeRate =
    advisory.reduce((s, a) => s + (a.annualFee ?? 0) * a.balance, 0) / advisoryBalance;

  // Re-run with just those accounts at index-fund cost, everything else held
  // identical, so the whole gap is attributable to the fee.
  const atIndexCost = project({
    ...plan,
    accounts: plan.accounts.map((a) =>
      advisoryIds.has(a.id) ? { ...a, annualFee: INDEX_FUND_COST } : a,
    ),
  });

  const baseline = project(plan);
  const finalYear = baseline.rows[baseline.rows.length - 1]?.year ?? plan.startYear;
  const lifetimeCost = Math.abs(
    inTodaysMoney(plan, atIndexCost.finalNetWorth - baseline.finalNetWorth, finalYear),
  );
  const annualFeeDollars = advisoryBalance * feeRate;

  return {
    id: 'fee-drag',
    severity: 'opportunity',
    priority: 6,
    title: `The ${pct(feeRate, 1)} advisory fee costs about ${money(lifetimeCost)} over the plan`,
    ruleOfThumb:
      'Advisory fees, fund expenses and product wrappers all come out of the return before you see it. Index funds run around 0.1–0.15%; advisor-managed and insurance-wrapped accounts are frequently 1–1.5%. The gap compounds for as long as the money is invested.',
    body: `The higher-fee accounts are modelled at ${pct(feeRate, 1)} all-in — about ${money(annualFeeDollars)} this year on ${money(advisoryBalance)}, and growing with the balance. The same holdings in index funds at roughly ${pct(INDEX_FUND_COST, 1)} would leave that difference invested to compound. Carried across the full life of the accounts, the gap is worth on the order of ${money(lifetimeCost)} in today's dollars. That is not a verdict on the advisor, who may well earn it through planning, insurance advice and the discipline of not selling in a downturn. It is simply the number to weigh those services against.`,
    metrics: [
      { label: 'Modelled all-in fee', value: pct(feeRate, 1) },
      { label: 'Fee this year', value: money(annualFeeDollars), benchmark: `on ${money(advisoryBalance)}` },
      { label: 'Index-fund alternative', value: `~${pct(INDEX_FUND_COST, 1)}` },
      {
        label: 'Cost by end of plan',
        value: money(lifetimeCost),
        benchmark: "today's dollars, lifetime",
      },
    ],
    action: `Confirm the real figure: the all-in annual cost of each higher-fee account — advisory fee, fund expense ratios, any product wrapper — as a percentage and in dollars. Fees that never appear as a line on a statement are almost always netted out of the balance, not absent. If the true number is well under ${pct(feeRate, 1)} this shrinks; at or above it, it is the first conversation worth having.`,
  };
};

/** Savings rate, for context rather than alarm. */
const savingsRateRule: InsightRule = ({ metrics }) => {
  if (metrics.grossIncome <= 0) return null;
  const rate = metrics.savingsRate;

  return {
    id: 'savings-rate',
    severity: rate >= 0.15 ? 'ok' : rate >= 0.1 ? 'opportunity' : 'warning',
    priority: 14,
    title: `Saving ${pct(rate, 1)} of gross income`,
    ruleOfThumb:
      '10–15% of gross including any employer match is the figure most commonly cited for someone starting in their twenties; starting later requires more.',
    body:
      rate >= 0.15
        ? `Comfortably above the commonly cited range, including the employer match. This is the engine behind everything else in the plan.`
        : `Below the commonly cited range. Worth reading alongside the coast-age finding, which says whether it actually needs to be higher.`,
    metrics: [
      { label: 'Saved per year', value: money(metrics.annualSavings) },
      { label: 'Gross income', value: money(metrics.grossIncome) },
      { label: 'Rate', value: pct(rate, 1), benchmark: '10–15% guideline' },
    ],
  };
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const INSIGHT_RULES: InsightRule[] = [
  emergencyFund,
  inflationSensitivity,
  debtPayoff,
  cheapDebtAffirmation,
  survivorTest,
  rothConversionWindow,
  contributionHeadroom,
  taxDiversification,
  coastFi,
  assetConcentration,
  windfallDependency,
  socialSecuritySensitivity,
  disabilityAdequacy,
  raiseFreeze,
  feeDrag,
  savingsRateRule,
];

const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  critical: 0,
  warning: 1,
  opportunity: 2,
  ok: 3,
};

/**
 * Run every rule and return the findings, most serious first.
 *
 * A rule that throws is skipped rather than taking the page down with it —
 * one bad rule should not cost you the other fourteen.
 */
export function generateInsights(ctx: InsightContext): Insight[] {
  const found: Insight[] = [];

  for (const rule of INSIGHT_RULES) {
    try {
      const insight = rule(ctx);
      if (insight) found.push(insight);
    } catch (error) {
      console.error('Insight rule failed:', error);
    }
  }

  return found.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.priority - b.priority,
  );
}
