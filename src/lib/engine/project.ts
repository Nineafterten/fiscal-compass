/**
 * The deterministic year-by-year projection.
 *
 * One pass produces a `YearRow` for every year from `plan.startYear` until the
 * youngest person reaches `planEndAge`. The same function serves the live
 * sliders (called synchronously on every drag — it's ~50 iterations) and the
 * Monte Carlo, which calls it once per run with a supplied sequence of market
 * shocks.
 */

import {
  taxBucketOf,
  type Account,
  type Income,
  type Plan,
  type ProjectionResult,
  type TaxBucket,
  type YearRow,
} from '../../types/plan';
import { rmdDivisor, rmdStartAge, taxTableFor } from '../../data/taxTables';
import { buildDebtSchedules } from './amortize';
import { computeTaxes, type Earnings, type TaxInput } from './tax';

export interface ProjectionOptions {
  /**
   * Retire the primary earner at this age instead of the planned one. Other
   * household members shift by the same number of years, so the household
   * still retires together. Used by `solve.ts` to search for the earliest
   * workable retirement age.
   */
  retirementAgeOverride?: number;
  /**
   * One standard-normal market shock per projected year. When absent, every
   * account earns exactly its `expectedReturn` — the deterministic path.
   */
  marketShocks?: number[];
  /** Per-year inflation overrides, same length convention as `marketShocks`. */
  inflationSequence?: number[];
  /**
   * Per-year ceiling on salary raises, same length convention as
   * `marketShocks`. Applies to salaries with a `nominalGrowthRate`; a year
   * without an entry grants the salary's own raise.
   */
  raiseCaps?: number[];
  /** Force windfalls on or off regardless of each one's `included` flag. */
  includeWindfalls?: boolean;
  /**
   * Stop all contributions once the primary earner reaches this age, while
   * income and spending carry on unchanged. This is how Coast FI is measured:
   * the earliest age at which saving could stop and the plan still works.
   */
  contributionsStopAge?: number;
  /**
   * Calendar years with no employment income at all. Spending continues,
   * contributions stop, and the shortfall is funded like any other — which is
   * precisely what an emergency fund is for.
   */
  jobLossYears?: number[];
}

const ALL_BUCKETS: TaxBucket[] = ['pretax', 'roth', 'taxable', 'tax_free_edu'];

function emptyBucketRecord(): Record<TaxBucket, number> {
  return { pretax: 0, roth: 0, taxable: 0, tax_free_edu: 0 };
}

function birthYearOf(birthMonth: string): number {
  return Number(birthMonth.slice(0, 4));
}

/**
 * Benefit multiplier for claiming Social Security away from full retirement
 * age: 5/9 of 1% per month for the first 36 months early, 5/12 of 1% per month
 * beyond that, and 8% per year for delaying past FRA.
 */
export function ssClaimFactor(claimAge: number, fra = 67): number {
  if (claimAge === fra) return 1;
  if (claimAge < fra) {
    const monthsEarly = (fra - claimAge) * 12;
    const first36 = Math.min(monthsEarly, 36);
    const beyond = Math.max(0, monthsEarly - 36);
    return 1 - (first36 * 5) / 900 - (beyond * 5) / 1200;
  }
  return 1 + Math.min(claimAge - fra, 3) * 0.08;
}

/** Mid-year convention: flows earn roughly half a year of growth. */
function grow(startBalance: number, flow: number, rate: number): number {
  const factor = 1 + rate;
  return startBalance * factor + flow * Math.sqrt(Math.max(0, factor));
}

/**
 * How much an income has grown by `year`, as a multiple of its starting value.
 *
 * Growth compounds only in years that actually granted a raise, so a freeze
 * doesn't merely pause income — it leaves every later year permanently a step
 * behind, which is what a skipped cost-of-living adjustment really does.
 * `cpiIndex` is official inflation compounded to each year, 1 at `startYear`.
 */
export function incomeGrowthFactor(
  income: Income,
  year: number,
  startYear: number,
  cpiIndex: readonly number[],
  raiseCaps?: number[],
): number {
  const t = year - startYear;
  const frozen = new Set(income.freezeYears ?? []);

  if (income.nominalGrowthRate === undefined) {
    // Legacy path: growth expressed as a real premium over official inflation.
    // A frozen year grants neither that year's inflation nor the premium.
    let factor = cpiIndex[t] * Math.pow(1 + income.realGrowthRate, t);
    for (const y of frozen) {
      const s = y - startYear;
      if (s >= 1 && s <= t) {
        factor /= (cpiIndex[s] / cpiIndex[s - 1]) * (1 + income.realGrowthRate);
      }
    }
    return factor;
  }

  const growth = income.nominalGrowthRate;
  const caps = income.type === 'salary' ? raiseCaps : undefined;
  let raises = 0;
  let cappedFactor = 1;
  for (let y = startYear + 1; y <= year; y++) {
    if (frozen.has(y)) continue;
    const cap = caps?.[y - startYear];
    if (cap !== undefined && cap < growth) cappedFactor *= 1 + cap;
    else raises++;
  }
  return Math.pow(1 + growth, raises) * cappedFactor;
}

export function project(plan: Plan, options: ProjectionOptions = {}): ProjectionResult {
  const { assumptions: a } = plan;
  const primary = plan.people[0];
  if (!primary) {
    return { rows: [], finalNetWorth: 0, succeeded: false };
  }

  // Retirement-age override shifts the whole household by the same delta.
  const retirementDelta =
    options.retirementAgeOverride !== undefined
      ? options.retirementAgeOverride - primary.retirementAge
      : 0;
  const retirementAgeOf = (personId: string): number => {
    const person = plan.people.find((p) => p.id === personId);
    if (!person) return primary.retirementAge + retirementDelta;
    return person.retirementAge + retirementDelta;
  };

  // Mutable state carried across years.
  const balances = new Map<string, number>();
  for (const acct of plan.accounts) balances.set(acct.id, acct.balance);
  const assetValues = new Map<string, number>();
  for (const asset of plan.assets) assetValues.set(asset.id, asset.value);

  const debtSchedules = buildDebtSchedules(plan.debts, plan.startYear, plan.startMonth);

  const youngestBirthYear = Math.max(
    ...plan.people.map((p) => birthYearOf(p.birthMonth)),
  );
  const endYear = youngestBirthYear + a.planEndAge;
  const includeWindfalls = options.includeWindfalls;

  const rows: YearRow[] = [];
  let depletionYear: number | undefined;

  // Two compounding tracks. Official CPI indexes the tax code, contribution
  // limits and Social Security; household inflation drives the shopping bill.
  // They are usually not the same number, and the gap between them is one of
  // the quieter ways a plan goes wrong.
  const householdRate = a.householdInflation ?? a.inflation;
  let cumulativeInflation = 1;
  let cumulativeHousehold = 1;
  const cpiIndex: number[] = [];

  for (let year = plan.startYear; year <= endYear; year++) {
    const t = year - plan.startYear;
    const yearInflation = options.inflationSequence?.[t] ?? a.inflation;
    if (t > 0) {
      cumulativeInflation *= 1 + yearInflation;
      // A stressed inflation sequence moves the household basket with it,
      // preserving whatever gap the plan assumes between the two.
      cumulativeHousehold *= 1 + yearInflation + (householdRate - a.inflation);
    }
    cpiIndex.push(cumulativeInflation);

    const table = taxTableFor(year, a.inflation);
    const shock = options.marketShocks?.[t];

    // ---- Ages and phase flags -------------------------------------------
    const ages: Record<string, number> = {};
    for (const p of plan.people) ages[p.id] = year - birthYearOf(p.birthMonth);
    const primaryAge = ages[primary.id];
    const householdRetired = plan.people.every(
      (p) => ages[p.id] >= retirementAgeOf(p.id),
    );

    // ---- Income ----------------------------------------------------------
    let earnedIncome = 0;
    let selfEmploymentIncome = 0;
    let pensionIncome = 0;
    let otherIncome = 0;
    const earningsByPerson = new Map<string, Earnings>();

    const outOfWork = options.jobLossYears?.includes(year) ?? false;

    for (const inc of plan.incomes) {
      const startsBy = inc.startYear ?? plan.startYear;
      if (year < startsBy) continue;
      // A job-loss year zeroes employment income but leaves pensions and
      // other income alone.
      if (outOfWork && (inc.type === 'salary' || inc.type === 'self_employment')) continue;

      // Salary and self-employment stop at the owner's retirement; pensions
      // and other income run until an explicit end year.
      const ownerAge = ages[inc.ownerId] ?? primaryAge;
      const employmentEnded =
        (inc.type === 'salary' || inc.type === 'self_employment') &&
        ownerAge >= retirementAgeOf(inc.ownerId);
      if (employmentEnded) continue;
      if (inc.endYear !== undefined && year > inc.endYear) continue;

      const amount =
        inc.annualGross *
        incomeGrowthFactor(inc, year, plan.startYear, cpiIndex, options.raiseCaps);

      if (inc.type === 'salary') earnedIncome += amount;
      else if (inc.type === 'self_employment') selfEmploymentIncome += amount;
      else if (inc.type === 'pension') pensionIncome += amount;
      else otherIncome += amount;

      if (inc.type === 'salary' || inc.type === 'self_employment') {
        const earner = earningsByPerson.get(inc.ownerId) ?? { wages: 0, selfEmployment: 0 };
        if (inc.type === 'salary') earner.wages += amount;
        else earner.selfEmployment += amount;
        earningsByPerson.set(inc.ownerId, earner);
      }
    }

    // Social Security, reduced by the household's assumed haircut.
    let socialSecurity = 0;
    for (const p of plan.people) {
      if (!p.ssMonthlyAtFra || ages[p.id] < p.ssClaimAge) continue;
      socialSecurity +=
        p.ssMonthlyAtFra *
        12 *
        ssClaimFactor(p.ssClaimAge) *
        a.ssHaircut *
        cumulativeInflation;
    }

    // Windfalls are not taxable income — inheritances pass to the recipient
    // free of federal income tax — so they land in an account without
    // touching the tax calculation. Deposited up front so the year's own cash
    // flow can draw on them like any other balance.
    let windfallIncome = 0;
    for (const w of plan.windfalls) {
      const on = includeWindfalls ?? w.included;
      if (!on || w.expectedYear !== year) continue;
      windfallIncome += w.amount;
    }
    if (windfallIncome > 0) routeWindfall(windfallIncome, plan, balances);

    // ---- Debt service ----------------------------------------------------
    const debtInterest = debtSchedules.interestIn(year);
    const debtPrincipal = debtSchedules.principalIn(year);
    const debtPayments = debtSchedules.paymentsIn(year);

    // ---- Spending --------------------------------------------------------
    let spending = 0;
    let educationSpending = 0;
    let pretaxPayrollDeductions = 0;
    for (const exp of plan.expenses) {
      if (exp.startYear !== undefined && year < exp.startYear) continue;
      if (exp.endYear !== undefined && year > exp.endYear) continue;
      // Age-phased windows track the retirement slider, which is what makes
      // the pre-Medicare healthcare bridge resize on its own.
      if (exp.startAge !== undefined && primaryAge < exp.startAge) continue;
      if (exp.endAge !== undefined && primaryAge >= exp.endAge) continue;
      if (exp.onlyIfRetired && !householdRetired) continue;
      if (householdRetired && exp.continuesInRetirement === false) continue;

      // Spending follows the household basket, not the tax code. Categories
      // with their own rate (healthcare, tuition) compound separately again.
      const factor =
        exp.inflationOverride === undefined
          ? cumulativeHousehold
          : Math.pow(1 + exp.inflationOverride, t);
      const amount = exp.monthlyAmount * 12 * factor;
      spending += amount;
      if (exp.category === 'education') educationSpending += amount;
      if (exp.pretaxPayroll) pretaxPayrollDeductions += amount;
    }

    // The retirement spending smile: real spending drifts once work stops.
    if (householdRetired && a.retirementSpendingDrift !== 0) {
      const yearsRetired = primaryAge - retirementAgeOf(primary.id);
      spending *= Math.pow(1 + a.retirementSpendingDrift, Math.max(0, yearsRetired));
    }

    spending += debtPayments;

    // College is funded from the 529 first; only the shortfall competes with
    // everything else for cash.
    let educationCovered = 0;
    if (educationSpending > 0) {
      for (const acct of plan.accounts) {
        if (taxBucketOf(acct.type) !== 'tax_free_edu') continue;
        const available = balances.get(acct.id) ?? 0;
        const draw = Math.min(available, educationSpending - educationCovered);
        if (draw <= 0) continue;
        balances.set(acct.id, available - draw);
        educationCovered += draw;
        if (educationCovered >= educationSpending) break;
      }
      spending -= educationCovered;
    }

    // ---- Contributions ---------------------------------------------------
    let pretaxDeferrals = 0;
    let afterTaxContributions = 0;
    let employerMatch = 0;
    const contributionByAccount = new Map<string, number>();

    const contributionsActive =
      (options.contributionsStopAge === undefined ||
        primaryAge < options.contributionsStopAge) &&
      // No paycheck, no payroll deferrals.
      !outOfWork;

    if (!householdRetired && contributionsActive) {
      let remaining401k = table.limit401kEmployee;
      let remainingIra = table.limitIra;

      for (const acct of plan.accounts) {
        const ownerAge = ages[acct.ownerId] ?? primaryAge;
        if (ownerAge >= retirementAgeOf(acct.ownerId)) continue;
        if (acct.monthlyContribution <= 0) continue;

        let annual = acct.monthlyContribution * 12 * cumulativeInflation;

        // Respect the IRS limits, shared across accounts of the same kind.
        if (acct.type === '401k_traditional' || acct.type === '401k_roth') {
          const catchUp = ownerAge >= 50 ? table.limit401kCatchUp : 0;
          annual = Math.min(annual, remaining401k + catchUp);
          remaining401k = Math.max(0, remaining401k - annual);
        } else if (acct.type === 'ira_traditional' || acct.type === 'roth_ira') {
          const catchUp = ownerAge >= 50 ? table.limitIraCatchUp : 0;
          annual = Math.min(annual, remainingIra + catchUp);
          remainingIra = Math.max(0, remainingIra - annual);
        } else if (acct.type === 'hsa') {
          annual = Math.min(annual, table.limitHsaFamily);
        }

        if (annual <= 0) continue;
        contributionByAccount.set(acct.id, annual);

        if (acct.type === '401k_traditional' || acct.type === 'ira_traditional' || acct.type === 'hsa') {
          pretaxDeferrals += annual;
        } else {
          afterTaxContributions += annual;
        }
      }

      // Employer match: `rate` on your own contributions, capped at
      // `limitPctOfSalary` of pay. Contributing less than the cap forfeits
      // part of the match, which this shape captures and a flat percentage
      // would not.
      for (const acct of plan.accounts) {
        if (!acct.employerMatchRate || !acct.employerMatchLimitPctOfSalary) continue;
        const ownerAge = ages[acct.ownerId] ?? primaryAge;
        if (ownerAge >= retirementAgeOf(acct.ownerId)) continue;

        const ownerSalary = plan.incomes
          .filter((i) => i.ownerId === acct.ownerId && i.type === 'salary')
          .reduce(
            (s, i) =>
              s +
              i.annualGross *
                incomeGrowthFactor(i, year, plan.startYear, cpiIndex, options.raiseCaps),
            0,
          );

        const ownContribution = contributionByAccount.get(acct.id) ?? 0;
        const matchable = Math.min(
          ownContribution,
          ownerSalary * acct.employerMatchLimitPctOfSalary,
        );
        const match = matchable * acct.employerMatchRate;

        employerMatch += match;
        contributionByAccount.set(acct.id, ownContribution + match);
      }
    }

    // ---- Required minimum distributions ----------------------------------
    // The RMD is a forced *movement* out of pretax accounts, not a choice, so
    // it's drained up front and then treated as available cash. Whatever the
    // year doesn't consume flows into taxable via the surplus cascade — which
    // is exactly what happens in practice.
    let rmd = 0;
    for (const p of plan.people) {
      const startAge = rmdStartAge(birthYearOf(p.birthMonth));
      if (ages[p.id] < startAge) continue;
      const divisor = rmdDivisor(ages[p.id]);
      if (!divisor) continue;
      const owned = plan.accounts.filter(
        (acc) => acc.ownerId === p.id && taxBucketOf(acc.type) === 'pretax',
      );
      const pretaxOwned = owned.reduce((s, acc) => s + (balances.get(acc.id) ?? 0), 0);
      const required = pretaxOwned / divisor;
      rmd += drainAccounts(owned, required, balances);
    }

    // ---- Taxes and the withdrawal gap ------------------------------------
    // Withdrawals change the tax bill, which changes how much must be
    // withdrawn. Three passes converge to within a dollar.
    const baseOrdinary =
      earnedIncome + selfEmploymentIncome + pensionIncome + otherIncome + rmd;

    // Windfalls are excluded here on purpose — they were already deposited
    // into an account above, so counting them again as spendable cash would
    // double them.
    const cashBeforeWithdrawals =
      earnedIncome +
      selfEmploymentIncome +
      pensionIncome +
      otherIncome +
      socialSecurity +
      rmd -
      pretaxDeferrals;

    // Section 125 premiums escape income tax and FICA alike, so they come off
    // both the taxable income and the FICA wage base. Expenses have no owner,
    // so the deductions come out of the highest salary first, spilling over to
    // the next if it runs out.
    let payrollDeductionsLeft = pretaxPayrollDeductions;
    const earners = [...earningsByPerson.values()]
      .sort((x, y) => y.wages - x.wages)
      .map((earner) => {
        const deducted = Math.min(earner.wages, payrollDeductionsLeft);
        payrollDeductionsLeft -= deducted;
        return { wages: earner.wages - deducted, selfEmployment: earner.selfEmployment };
      });

    const taxInputBase: TaxInput = {
      ordinaryIncome: baseOrdinary,
      longTermGains: 0,
      socialSecurityBenefit: socialSecurity,
      pretaxDeferrals: pretaxDeferrals + pretaxPayrollDeductions,
      wages: Math.max(0, earnedIncome - pretaxPayrollDeductions),
      selfEmployment: selfEmploymentIncome,
      earners,
      filingStatus: a.filingStatus,
      stateCode: a.stateCode,
      table,
    };

    let plannedDraw = { total: 0, byBucket: emptyBucketRecord(), taxableOrdinary: 0, gains: 0 };
    let taxes = computeTaxes(taxInputBase);
    let gap = 0;

    for (let pass = 0; pass < 4; pass++) {
      taxes = computeTaxes({
        ...taxInputBase,
        ordinaryIncome: baseOrdinary + plannedDraw.taxableOrdinary,
        longTermGains: plannedDraw.gains,
      });
      gap = spending + afterTaxContributions + taxes.total - cashBeforeWithdrawals;
      if (gap <= 0) {
        plannedDraw = { total: 0, byBucket: emptyBucketRecord(), taxableOrdinary: 0, gains: 0 };
        break;
      }
      const next = planWithdrawal(gap, plan, balances, a.withdrawalOrder);
      if (Math.abs(next.total - plannedDraw.total) < 1) {
        plannedDraw = next;
        break;
      }
      plannedDraw = next;
    }

    // ---- Apply flows to accounts -----------------------------------------
    const withdrawalsByBucket = emptyBucketRecord();
    let withdrawals = 0;
    let shortfallAmount = 0;

    if (gap > 0) {
      const applied = applyWithdrawal(gap, plan, balances, a.withdrawalOrder);
      withdrawals = applied.total;
      for (const b of ALL_BUCKETS) withdrawalsByBucket[b] = applied.byBucket[b];
      shortfallAmount = Math.max(0, gap - applied.total);
    }

    // The RMD was already drained above; count it as a withdrawal for
    // reporting so the retirement income chart shows where money came from.
    withdrawalsByBucket.pretax += rmd;
    withdrawals += rmd;

    // Surplus cascade: top up the emergency fund first, then invest the rest.
    // Extra debt principal is already reflected in the amortization schedule.
    const surplus = gap < 0 ? -gap : 0;
    if (surplus > 0) {
      routeSurplus(surplus, plan, balances, spending, a.emergencyFundMonths);
    }

    // ---- Growth ----------------------------------------------------------
    for (const acct of plan.accounts) {
      const start = balances.get(acct.id) ?? 0;
      const contribution = contributionByAccount.get(acct.id) ?? 0;
      const gross =
        shock === undefined
          ? acct.expectedReturn
          : acct.expectedReturn + acct.volatility * shock;
      // Fees come out of the return before it compounds — the same money the
      // account would otherwise have kept and grown, every year.
      const rate = gross - (acct.annualFee ?? 0);
      balances.set(acct.id, Math.max(0, grow(start, contribution, rate)));
    }

    for (const asset of plan.assets) {
      const value = assetValues.get(asset.id) ?? 0;
      assetValues.set(asset.id, Math.max(0, value * (1 + asset.appreciationRate)));
    }

    // ---- Emit ------------------------------------------------------------
    const balancesByAccount: Record<string, number> = {};
    const balancesByBucket = emptyBucketRecord();
    let investableAssets = 0;
    for (const acct of plan.accounts) {
      const balance = balances.get(acct.id) ?? 0;
      balancesByAccount[acct.id] = balance;
      const bucket = taxBucketOf(acct.type);
      balancesByBucket[bucket] += balance;
      // The 529 is earmarked for education, not retirement funding.
      if (bucket !== 'tax_free_edu') investableAssets += balance;
    }

    const otherAssetValue = plan.assets.reduce(
      (s, asset) => s + (assetValues.get(asset.id) ?? 0),
      0,
    );
    const debtBalance = debtSchedules.balanceAt(year);
    const grossIncome =
      earnedIncome +
      selfEmploymentIncome +
      pensionIncome +
      otherIncome +
      socialSecurity +
      windfallIncome;

    const startingInvestable =
      rows.length > 0 ? rows[rows.length - 1].investableAssets : investableAssets;

    const shortfall = shortfallAmount > 0.5;
    if (shortfall && depletionYear === undefined) depletionYear = year;

    rows.push({
      year,
      ages,
      primaryAge,
      retired: householdRetired,
      householdPriceLevel: cumulativeHousehold,
      earnedIncome,
      selfEmploymentIncome,
      pensionIncome,
      socialSecurity,
      taxableSocialSecurity: taxes.taxableSocialSecurity,
      otherIncome,
      windfallIncome,
      grossIncome,
      spending,
      debtInterest,
      debtPrincipal,
      federalTax: taxes.federal,
      stateTax: taxes.state,
      ficaTax: taxes.fica,
      totalTax: taxes.total,
      contributions: pretaxDeferrals + afterTaxContributions,
      employerMatch,
      withdrawals,
      withdrawalsByBucket,
      requiredMinimumDistribution: rmd,
      balancesByAccount,
      balancesByBucket,
      investableAssets,
      otherAssetValue,
      debtBalance,
      netWorth: investableAssets + balancesByBucket.tax_free_edu + otherAssetValue - debtBalance,
      withdrawalRate: startingInvestable > 0 ? withdrawals / startingInvestable : 0,
      shortfall,
      shortfallAmount,
    });
  }

  const finalRow = rows[rows.length - 1];
  return {
    rows,
    depletionYear,
    finalNetWorth: finalRow?.netWorth ?? 0,
    succeeded: depletionYear === undefined,
  };
}

// ---------------------------------------------------------------------------
// Withdrawal helpers
// ---------------------------------------------------------------------------

interface DrawPlan {
  total: number;
  byBucket: Record<TaxBucket, number>;
  /** Portion that lands on the ordinary-income line. */
  taxableOrdinary: number;
  /** Portion taxed at long-term capital-gains rates. */
  gains: number;
}

function accountsInBucket(plan: Plan, bucket: TaxBucket): Account[] {
  return plan.accounts.filter((acc) => taxBucketOf(acc.type) === bucket);
}

/**
 * Work out where a withdrawal would come from, without mutating balances —
 * used by the tax iteration to learn the taxable shape of the draw before
 * committing to it.
 */
function planWithdrawal(
  need: number,
  plan: Plan,
  balances: Map<string, number>,
  order: TaxBucket[],
): DrawPlan {
  const byBucket = emptyBucketRecord();
  let remaining = need;
  let taxableOrdinary = 0;
  let gains = 0;

  for (const bucket of order) {
    if (remaining <= 0) break;
    // The 529 is never a general-purpose retirement source.
    if (bucket === 'tax_free_edu') continue;

    const accounts = accountsInBucket(plan, bucket);
    const available = accounts.reduce((s, acc) => s + (balances.get(acc.id) ?? 0), 0);
    const draw = Math.min(available, remaining);
    if (draw <= 0) continue;

    byBucket[bucket] += draw;
    remaining -= draw;

    if (bucket === 'pretax') {
      taxableOrdinary += draw;
    } else if (bucket === 'taxable') {
      // Only the gain portion is taxed, and at capital-gains rates.
      const weightedBasis =
        accounts.reduce(
          (s, acc) => s + (balances.get(acc.id) ?? 0) * (acc.costBasisFraction ?? 0.7),
          0,
        ) / (available || 1);
      gains += draw * (1 - weightedBasis);
    }
    // Roth withdrawals are tax-free.
  }

  const total = need - Math.max(0, remaining);
  return { total, byBucket, taxableOrdinary, gains };
}

/** Drain accounts proportionally, returning how much was actually taken. */
function drainAccounts(
  accounts: Account[],
  amount: number,
  balances: Map<string, number>,
): number {
  const available = accounts.reduce((s, acc) => s + (balances.get(acc.id) ?? 0), 0);
  if (available <= 0 || amount <= 0) return 0;
  const take = Math.min(amount, available);

  let taken = 0;
  for (const acc of accounts) {
    const balance = balances.get(acc.id) ?? 0;
    if (balance <= 0) continue;
    const share = (balance / available) * take;
    const actual = Math.min(share, balance);
    balances.set(acc.id, balance - actual);
    taken += actual;
  }
  return taken;
}

function applyWithdrawal(
  need: number,
  plan: Plan,
  balances: Map<string, number>,
  order: TaxBucket[],
): { total: number; byBucket: Record<TaxBucket, number> } {
  const byBucket = emptyBucketRecord();
  let remaining = need;

  for (const bucket of order) {
    if (remaining <= 0) break;
    if (bucket === 'tax_free_edu') continue;
    const taken = drainAccounts(accountsInBucket(plan, bucket), remaining, balances);
    byBucket[bucket] += taken;
    remaining -= taken;
  }

  return { total: need - Math.max(0, remaining), byBucket };
}

/**
 * Where leftover cash goes. This cascade is the app's opinion about
 * allocation: refill the emergency fund to its target first, then invest.
 * Extra debt principal is already reflected in the amortization schedule.
 */
function routeSurplus(
  surplus: number,
  plan: Plan,
  balances: Map<string, number>,
  annualSpending: number,
  emergencyFundMonths: number,
): void {
  let remaining = surplus;

  const liquid = plan.accounts.filter((acc) =>
    ['checking', 'savings', 'hysa', 'cash'].includes(acc.type),
  );
  const liquidTotal = liquid.reduce((s, acc) => s + (balances.get(acc.id) ?? 0), 0);
  const target = (annualSpending / 12) * emergencyFundMonths;

  if (liquidTotal < target && liquid.length > 0) {
    const topUp = Math.min(remaining, target - liquidTotal);
    // Prefer the highest-yielding liquid account.
    const destination =
      liquid.find((acc) => acc.type === 'hysa') ??
      liquid.find((acc) => acc.type === 'savings') ??
      liquid[0];
    balances.set(destination.id, (balances.get(destination.id) ?? 0) + topUp);
    remaining -= topUp;
  }

  if (remaining <= 0) return;

  const brokerage =
    plan.accounts.find((acc) => acc.type === 'taxable') ??
    liquid.find((acc) => acc.type === 'hysa') ??
    liquid[0];
  if (brokerage) {
    balances.set(brokerage.id, (balances.get(brokerage.id) ?? 0) + remaining);
  }
}

function routeWindfall(amount: number, plan: Plan, balances: Map<string, number>): void {
  const destination =
    plan.windfalls
      .map((w) => w.destinationAccountId)
      .filter(Boolean)
      .map((id) => plan.accounts.find((acc) => acc.id === id))
      .find(Boolean) ??
    plan.accounts.find((acc) => acc.type === 'taxable') ??
    plan.accounts.find((acc) => acc.type === 'hysa');

  if (destination) {
    balances.set(destination.id, (balances.get(destination.id) ?? 0) + amount);
  }
}
