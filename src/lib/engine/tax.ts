/**
 * Federal, state, and payroll tax calculation.
 *
 * Every function here is pure and takes its tax table as an argument, so the
 * whole module is trivially testable against hand-computed figures.
 *
 * Scope and honesty: this models the parts that actually move a retirement
 * projection — graduated brackets, the standard deduction, FICA, the taxation
 * of Social Security, and capital-gains stacking. It does NOT model itemized
 * deductions, AMT, NIIT, credits, or IRMAA surcharges. It is a planning
 * approximation, not a tax return.
 */

import {
  SS_TAXATION_THRESHOLDS,
  stateRule,
  type Bracket,
  type FilingStatus,
  type TaxYearTable,
} from '../../data/taxTables';

/**
 * Tax owed on the slice of income between `lo` and `hi`.
 *
 * This is the primitive the rest of the module is built from: capital gains
 * stack on top of ordinary income rather than starting from zero, so "tax on a
 * band" is the operation that actually matters.
 */
export function taxOnBand(lo: number, hi: number, brackets: Bracket[]): number {
  if (hi <= lo) return 0;
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const floor = brackets[i].floor;
    const ceiling = i + 1 < brackets.length ? brackets[i + 1].floor : Infinity;
    // The overlap between [lo, hi) and this bracket's [floor, ceiling).
    const from = Math.max(lo, floor);
    const to = Math.min(hi, ceiling);
    if (to > from) tax += (to - from) * brackets[i].rate;
    if (ceiling >= hi) break;
  }
  return tax;
}

/** Tax on income from zero. */
export function taxOnBrackets(income: number, brackets: Bracket[]): number {
  return taxOnBand(0, Math.max(0, income), brackets);
}

/** The rate that would apply to one more dollar of income. */
export function marginalRate(income: number, brackets: Bracket[]): number {
  let rate = brackets[0]?.rate ?? 0;
  for (const b of brackets) {
    if (income >= b.floor) rate = b.rate;
    else break;
  }
  return rate;
}

// ---------------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------------

/** One person's FICA-taxable earnings. */
export interface Earnings {
  /** W-2 wages. */
  wages: number;
  /** Net self-employment earnings (pays both halves). */
  selfEmployment: number;
}

export interface FicaInput extends Earnings {
  /**
   * The same `wages` and `selfEmployment`, split per person. The Social
   * Security wage base applies to each person separately; without this split
   * the household is treated as a single earner.
   */
  earners?: Earnings[];
  filingStatus: FilingStatus;
  table: TaxYearTable;
}

/**
 * Social Security + Medicare. Self-employment income pays both the employee
 * and employer halves, on 92.35% of net earnings. The Additional Medicare Tax
 * threshold is per return, so it stays on household totals.
 */
export function computeFica({
  wages,
  selfEmployment,
  earners,
  filingStatus,
  table,
}: FicaInput): number {
  const seBase = Math.max(0, selfEmployment) * 0.9235;

  const socialSecurity = (earners ?? [{ wages, selfEmployment }]).reduce(
    (sum, earner) => sum + socialSecurityTax(earner, table),
    0,
  );

  const medicare =
    wages * table.medicareRate + seBase * table.medicareRate * 2;

  const threshold = table.additionalMedicareThreshold[filingStatus];
  const combined = wages + seBase;
  const additional =
    Math.max(0, combined - threshold) * table.additionalMedicareRate;

  return socialSecurity + medicare + additional;
}

function socialSecurityTax({ wages, selfEmployment }: Earnings, table: TaxYearTable): number {
  const seBase = Math.max(0, selfEmployment) * 0.9235;

  // Wages fill the Social Security wage base first.
  const ssWages = Math.min(wages, table.socialSecurityWageBase);
  const ssSelfEmployment = Math.min(seBase, Math.max(0, table.socialSecurityWageBase - wages));
  return ssWages * table.socialSecurityRate + ssSelfEmployment * table.socialSecurityRate * 2;
}

// ---------------------------------------------------------------------------
// Social Security benefit taxation
// ---------------------------------------------------------------------------

/**
 * How much of a Social Security benefit is subject to income tax.
 *
 * Driven by "provisional income" = other income + tax-exempt interest + half
 * the benefit. Because the thresholds are frozen in nominal terms, this share
 * creeps upward over a long projection — which is realistic, not a bug.
 *
 * Returns the taxable portion, capped at 85% of the benefit.
 */
export function taxableSocialSecurity(
  benefit: number,
  otherIncome: number,
  filingStatus: FilingStatus,
): number {
  if (benefit <= 0) return 0;
  const { tier1, tier2 } = SS_TAXATION_THRESHOLDS[filingStatus];
  const provisional = otherIncome + benefit * 0.5;

  if (provisional <= tier1) return 0;

  if (provisional <= tier2) {
    return Math.min(0.5 * (provisional - tier1), 0.5 * benefit);
  }

  const tier1Portion = Math.min(0.5 * (tier2 - tier1), 0.5 * benefit);
  return Math.min(0.85 * benefit, 0.85 * (provisional - tier2) + tier1Portion);
}

// ---------------------------------------------------------------------------
// The full calculation
// ---------------------------------------------------------------------------

export interface TaxInput {
  /** Wages, self-employment, pension, traditional withdrawals, interest. */
  ordinaryIncome: number;
  /** Realized long-term capital gains. */
  longTermGains: number;
  /** Gross Social Security benefit received. */
  socialSecurityBenefit: number;
  /** Pre-tax deferrals (401k, HSA) — reduce taxable ordinary income. */
  pretaxDeferrals: number;
  wages: number;
  selfEmployment: number;
  /** Per-person split of `wages` and `selfEmployment`; see `FicaInput`. */
  earners?: Earnings[];
  filingStatus: FilingStatus;
  stateCode: string;
  table: TaxYearTable;
}

export interface TaxResult {
  federal: number;
  state: number;
  fica: number;
  total: number;
  /** The portion of the SS benefit that ended up taxable. */
  taxableSocialSecurity: number;
  taxableIncome: number;
  marginalRate: number;
  effectiveRate: number;
}

export function computeTaxes(input: TaxInput): TaxResult {
  const {
    ordinaryIncome,
    longTermGains,
    socialSecurityBenefit,
    pretaxDeferrals,
    wages,
    selfEmployment,
    earners,
    filingStatus,
    stateCode,
    table,
  } = input;

  // Pre-tax deferrals come off the top of ordinary income.
  const ordinaryAfterDeferrals = Math.max(0, ordinaryIncome - pretaxDeferrals);

  // Social Security taxability depends on everything else, so it's computed
  // before the deduction is applied.
  const ssTaxable = taxableSocialSecurity(
    socialSecurityBenefit,
    ordinaryAfterDeferrals + longTermGains,
    filingStatus,
  );

  const deduction = table.standardDeduction[filingStatus];
  const grossOrdinary = ordinaryAfterDeferrals + ssTaxable;

  // The deduction is applied to ordinary income first; capital gains are the
  // topmost slice of the stack and keep their preferential rates.
  const ordinaryTaxable = Math.max(0, grossOrdinary - deduction);
  const unusedDeduction = Math.max(0, deduction - grossOrdinary);
  const gainsTaxable = Math.max(0, longTermGains - unusedDeduction);

  const ordinaryBrackets = table.ordinaryBrackets[filingStatus];
  const gainsBrackets = table.longTermGainsBrackets[filingStatus];

  const federalOrdinary = taxOnBrackets(ordinaryTaxable, ordinaryBrackets);
  // Gains sit on top of ordinary taxable income for rate purposes.
  const federalGains = taxOnBand(
    ordinaryTaxable,
    ordinaryTaxable + gainsTaxable,
    gainsBrackets,
  );
  const federal = federalOrdinary + federalGains;

  const fica = computeFica({ wages, selfEmployment, earners, filingStatus, table });

  // State
  const rule = stateRule(stateCode);
  let stateBase = ordinaryAfterDeferrals + longTermGains;
  if (rule.taxesSocialSecurity) stateBase += ssTaxable;
  if (!rule.taxesRetirementIncome) {
    // Approximation: states exempting retirement income generally exempt
    // pension and IRA/401k distributions but still tax wages.
    stateBase = Math.min(stateBase, wages + selfEmployment + longTermGains);
  }
  const state = Math.max(0, stateBase - deduction) * rule.flatRate;

  const totalIncome =
    ordinaryAfterDeferrals + longTermGains + socialSecurityBenefit;
  const total = federal + state + fica;

  return {
    federal,
    state,
    fica,
    total,
    taxableSocialSecurity: ssTaxable,
    taxableIncome: ordinaryTaxable + gainsTaxable,
    marginalRate: marginalRate(ordinaryTaxable, ordinaryBrackets),
    effectiveRate: totalIncome > 0 ? total / totalIncome : 0,
  };
}

// ---------------------------------------------------------------------------
// Withdrawal gross-up
// ---------------------------------------------------------------------------

/**
 * How much must be withdrawn from a taxable-on-withdrawal account to net a
 * target amount after the tax the withdrawal itself triggers.
 *
 * Withdrawing more pushes you into higher brackets, which requires withdrawing
 * more still. Rather than solve that analytically across a stacked bracket
 * schedule, iterate — it converges to the dollar in about three passes.
 */
export function grossUpWithdrawal(
  netNeeded: number,
  taxableFraction: number,
  baseInput: TaxInput,
  passes = 8,
): number {
  if (netNeeded <= 0) return 0;
  if (taxableFraction <= 0) return netNeeded;

  const baseTax = computeTaxes(baseInput).total;
  let gross = netNeeded;

  for (let i = 0; i < passes; i++) {
    const withTax = computeTaxes({
      ...baseInput,
      ordinaryIncome: baseInput.ordinaryIncome + gross * taxableFraction,
    }).total;
    const incrementalTax = withTax - baseTax;
    const next = netNeeded + incrementalTax;
    // Error contracts by roughly the marginal rate each pass, so a cent-level
    // tolerance costs only a couple more iterations of plain arithmetic.
    if (Math.abs(next - gross) < 0.01) return next;
    gross = next;
  }
  return gross;
}
