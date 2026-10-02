/**
 * The domain model.
 *
 * `Plan` is the single serializable object that drives everything — projection,
 * Monte Carlo, insights, scenario comparison, and JSON export all take it as
 * input. Nothing in the engine reads a hard-coded number; if a value matters,
 * it lives here.
 */

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export interface Person {
  id: string;
  name: string;
  /** ISO `YYYY-MM` — day-level precision is noise at this horizon. */
  birthMonth: string;
  /** Age at which this person stops earning employment income. */
  retirementAge: number;
  /** Age at which Social Security is claimed (62–70). */
  ssClaimAge: number;
  /**
   * Estimated monthly benefit at full retirement age, in today's dollars,
   * from ssa.gov. The plan-level `ssHaircut` is applied on top of this.
   */
  ssMonthlyAtFra?: number;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export type AccountType =
  | '401k_traditional'
  | '401k_roth'
  | 'ira_traditional'
  | 'roth_ira'
  | 'taxable'
  | 'hsa'
  | '529'
  | 'checking'
  | 'savings'
  | 'hysa'
  | 'cash';

/**
 * How withdrawals from an account are taxed. Derived from `AccountType` via
 * `taxBucketOf` — never stored, so the two can't drift apart.
 */
export type TaxBucket = 'pretax' | 'roth' | 'taxable' | 'tax_free_edu';

export const TAX_BUCKET_BY_TYPE: Record<AccountType, TaxBucket> = {
  '401k_traditional': 'pretax',
  ira_traditional: 'pretax',
  '401k_roth': 'roth',
  roth_ira: 'roth',
  hsa: 'roth', // tax-free for qualified medical; treated as Roth-like here
  '529': 'tax_free_edu',
  taxable: 'taxable',
  checking: 'taxable',
  savings: 'taxable',
  hysa: 'taxable',
  cash: 'taxable',
};

export function taxBucketOf(type: AccountType): TaxBucket {
  return TAX_BUCKET_BY_TYPE[type];
}

/**
 * Accounts that can be spent from within days, without penalty or market risk.
 * This is the denominator of the emergency-fund calculation.
 */
export const LIQUID_TYPES: ReadonlySet<AccountType> = new Set<AccountType>([
  'checking',
  'savings',
  'hysa',
  'cash',
]);

export function isLiquid(type: AccountType): boolean {
  return LIQUID_TYPES.has(type);
}

/** Accounts subject to the 59½ early-withdrawal penalty. */
export const RETIREMENT_TYPES: ReadonlySet<AccountType> = new Set<AccountType>([
  '401k_traditional',
  '401k_roth',
  'ira_traditional',
  'roth_ira',
]);

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  /** Person id, or `'joint'`. */
  ownerId: string;
  /** Nominal annual return **before fees**, e.g. 0.08. */
  expectedReturn: number;
  /**
   * All-in annual cost as a fraction — advisory fee plus fund expense ratios
   * plus any product wrapper. Subtracted from `expectedReturn` every year.
   * Defaults to 0. A percentage point here compounds into a large number over
   * a multi-decade horizon, which is exactly why it deserves its own field
   * rather than being folded silently into the return.
   */
  annualFee?: number;
  /** Annual standard deviation of return — drives the Monte Carlo shock. */
  volatility: number;
  /** Recurring contribution the household makes from take-home pay. */
  monthlyContribution: number;
  /**
   * Employer match, expressed the way plans actually state it: a rate applied
   * to your own contributions, capped at some percentage of salary.
   *
   * "50% of the first 6%" is `{ rate: 0.5, limitPctOfSalary: 0.06 }`.
   * A flat "3% of salary regardless" is `{ rate: 1, limitPctOfSalary: 0.03 }`.
   *
   * Modeled this way rather than as a flat percentage so that lowering your
   * own contribution below the cap correctly reduces the match — which is the
   * single most expensive mistake a contribution slider can hide.
   */
  employerMatchRate?: number;
  employerMatchLimitPctOfSalary?: number;
  /**
   * Fraction of a taxable account's balance that is cost basis rather than
   * gain. Only gains are taxed on withdrawal.
   */
  costBasisFraction?: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

export type IncomeType = 'salary' | 'self_employment' | 'pension' | 'other';

export interface Income {
  id: string;
  name: string;
  type: IncomeType;
  ownerId: string;
  /** Gross annual amount in today's dollars. */
  annualGross: number;
  /**
   * Real annual growth *above* official inflation, e.g. 0.01. Used when
   * `nominalGrowthRate` is not set.
   */
  realGrowthRate: number;
  /**
   * Nominal annual growth — the raise as it appears on a payslip, e.g. 0.04.
   *
   * Preferred over `realGrowthRate` when you know the actual number, because
   * it's how raises are experienced and negotiated. It also makes the
   * wage-versus-prices gap visible: a 4% raise against a 5% household basket
   * is a real pay cut, and expressing growth as "inflation plus something"
   * quietly assumes that never happens.
   */
  nominalGrowthRate?: number;
  /**
   * Calendar years in which no raise is applied at all — a freeze, a layoff
   * year, an unpaid gap. Income holds at the prior year's level, and every
   * later year stays permanently one step behind.
   */
  freezeYears?: number[];
  /** Calendar year this income begins. Defaults to the plan start year. */
  startYear?: number;
  /**
   * Calendar year this income ends. When omitted, salary and self-employment
   * end at the owner's retirement age; pensions and `other` run to plan end.
   */
  endYear?: number;
  /** Subject to FICA. True for salary and self-employment. */
  subjectToFica?: boolean;
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

/**
 * A spending line.
 *
 * Expenses are *phased* by calendar year, by the primary person's age, or by
 * retirement status. That combination is what lets the model handle the three
 * cases that matter most:
 *
 *  - college: `startYear`/`endYear`
 *  - the pre-Medicare healthcare bridge: `onlyIfRetired` + `endAge: 65`, so it
 *    appears and resizes automatically as the retirement slider moves
 *  - Medicare premiums: `startAge: 65`
 */
export interface Expense {
  id: string;
  name: string;
  category: string;
  /** Today's dollars; inflated forward by the plan's inflation assumption. */
  monthlyAmount: number;
  startYear?: number;
  endYear?: number;
  /** Applies from this age of the primary person onward. */
  startAge?: number;
  /** Applies until this age of the primary person. */
  endAge?: number;
  /** Only applies once the household has retired (the healthcare bridge). */
  onlyIfRetired?: boolean;
  /**
   * Whether this expense continues in retirement. Commuting and payroll-linked
   * costs typically don't; groceries and utilities do.
   */
  continuesInRetirement?: boolean;
  /** Override the plan-level inflation rate (healthcare usually runs hotter). */
  inflationOverride?: number;
  /**
   * Deducted from gross pay before tax — employer health, dental, and vision
   * premiums under a Section 125 plan. These escape both income tax and FICA,
   * which is why take-home is lower than a naive gross-minus-tax figure but
   * the household is better off than paying the same premium after tax.
   */
  pretaxPayroll?: boolean;
  /**
   * Survive a spending-CSV import rather than being replaced by it. For
   * structural costs that a transaction export tends to miss — escrow buried
   * inside a mortgage payment being the classic case. Phased and pretax lines
   * are preserved automatically; this covers the rest.
   */
  keepOnImport?: boolean;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Debts
// ---------------------------------------------------------------------------

export type DebtType = 'mortgage' | 'auto' | 'student' | 'credit_card' | 'other';

export interface Debt {
  id: string;
  name: string;
  type: DebtType;
  balance: number;
  /** Nominal APR, e.g. 0.0575. */
  apr: number;
  /** Contractual principal + interest payment (excludes escrow). */
  monthlyPayment: number;
  /** Additional principal paid each month. */
  extraMonthlyPayment: number;
  /** Linked asset — a mortgage's house, an auto loan's car. */
  securedByAssetId?: string;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export type AssetType = 'real_estate' | 'vehicle' | 'other';

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  value: number;
  /** Nominal annual change. Negative for vehicles. */
  appreciationRate: number;
  /**
   * Counts toward net worth but NOT toward retirement funding — a primary
   * residence you have no intention of selling generates no income.
   */
  excludeFromRetirementAssets?: boolean;
}

// ---------------------------------------------------------------------------
// Windfalls
// ---------------------------------------------------------------------------

/**
 * An expected one-time inflow — inheritance, a vesting grant, a property sale.
 *
 * Deliberately excluded from the baseline projection unless `included` is set:
 * a plan that only works if someone dies on schedule isn't a plan. Toggling
 * them on shows what they'd accelerate.
 */
export interface Windfall {
  id: string;
  name: string;
  amount: number;
  expectedYear: number;
  /** Subjective 0–1. Surfaced in insights; does not scale the amount. */
  confidence: number;
  included: boolean;
  /** Account the money lands in. Defaults to the first taxable account. */
  destinationAccountId?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Insurance (checked for adequacy; not projected)
// ---------------------------------------------------------------------------

export interface InsurancePolicy {
  id: string;
  name: string;
  type: 'life' | 'disability' | 'umbrella' | 'other';
  /** Death benefit, or annual benefit for disability. */
  coverageAmount: number;
  insuredPersonId: string;
  monthlyPremium: number;
  /**
   * Age the policy expires. Term life that ends while dependants or a
   * mortgage remain is a coverage gap the adequacy check should catch.
   */
  expiresAtAge?: number;
  /**
   * Disability only: whether the benefit is taxable to the recipient.
   * Employer-paid premiums with no imputed income generally make it so.
   */
  benefitTaxable?: boolean;
  /**
   * Disability only: months the policy uses an *own-occupation* definition
   * before switching to *any gainful occupation*. Most group policies switch
   * at 24 — the point at which "can't do your job" becomes "can't do any job
   * you're reasonably fitted for", which is a far harder bar to clear.
   */
  ownOccupationMonths?: number;
  /**
   * Disability only: days that must pass before benefits begin. This sets a
   * hard floor on the emergency fund — nothing arrives until it expires.
   */
  eliminationPeriodDays?: number;
  /**
   * Disability only: a flat monthly ceiling on the benefit, regardless of the
   * stated replacement percentage. Caps are typically not indexed, so the
   * effective replacement rate falls with every raise.
   */
  monthlyBenefitCap?: number;
  /** Disability only: lifetime cap on mental-health / self-reported claims. */
  mentalHealthLimitMonths?: number;
  /**
   * Disability only: short-term vs long-term. Short-term policies bridge the
   * gap before long-term coverage begins, so they matter enormously for the
   * emergency-fund calculation but not for the retirement projection.
   */
  disabilityTerm?: 'short' | 'long';
  /** Disability only: how many weeks a short-term policy pays before it ends. */
  benefitPeriodWeeks?: number;
  /**
   * Coverage that exists only while employed — group life and group
   * disability. It ends with the job, which means it is absent in exactly two
   * situations worth planning for: after retiring, and after a layoff. Worth
   * distinguishing from portable cover you own outright.
   */
  employmentContingent?: boolean;
  /**
   * Coverage expressed as a multiple of salary rather than a fixed sum, as
   * group life usually is. Recorded for clarity; `coverageAmount` still holds
   * the resulting figure.
   */
  salaryMultiple?: number;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Assumptions
// ---------------------------------------------------------------------------

export type WithdrawalOrder = TaxBucket[];

export interface Assumptions {
  /**
   * Official price inflation (CPI), e.g. 0.03.
   *
   * Indexes the things that are legally tied to CPI: tax brackets, the
   * standard deduction, contribution limits, and Social Security COLAs.
   */
  inflation: number;
  /**
   * What *your* basket actually costs more each year. Defaults to `inflation`.
   *
   * Kept separate on purpose. Headline CPI is a national average across all
   * households; a family's own mix of groceries, fuel, insurance and childcare
   * routinely runs hotter. Applying one rate to both the tax code and the
   * shopping bill understates the squeeze — and over a 50-year projection a
   * one-point gap compounds into a different retirement.
   */
  householdInflation?: number;
  /**
   * Fraction of scheduled Social Security benefits assumed to actually arrive.
   * 1.0 = full scheduled benefit; 0.25 = a deeply pessimistic view.
   */
  ssHaircut: number;
  /** Age of the youngest person at which the projection stops. */
  planEndAge: number;
  /** Monte Carlo success threshold, e.g. 0.85. */
  successThreshold: number;
  /** Order accounts are drawn down in retirement. */
  withdrawalOrder: WithdrawalOrder;
  /** Safe withdrawal rate used for the FI-number headline, e.g. 0.04. */
  safeWithdrawalRate: number;
  /** Months of spending the emergency fund should cover. */
  emergencyFundMonths: number;
  /**
   * Real spending drift per year in retirement ("retirement spending smile").
   * Slightly negative is the empirical finding; 0 disables it.
   */
  retirementSpendingDrift: number;
  /** Monte Carlo iterations. */
  simulationRuns: number;
  /** Two-letter state code for the state-tax adapter. */
  stateCode: string;
  filingStatus: 'single' | 'mfj';

  // -------------------------------------------------------------------------
  // Survivor scenario
  //
  // These are judgement calls, not facts, so they live here where they can be
  // seen and changed rather than buried in the insight that uses them. The
  // defaults are deliberately middle-of-the-road: a survivor test is only as
  // honest as its assumptions about what the survivor would actually do, and
  // assuming they do nothing for fifty years manufactures a shortfall.
  // -------------------------------------------------------------------------

  /**
   * Household spending as a fraction of current, after losing one adult.
   * Well above a naive one-third cut — housing, insurance and utilities barely
   * move when a household goes from three people to two.
   */
  survivorSpendingFactor?: number;
  /**
   * Further reduction once dependent children are independent, applied from
   * `dependentsIndependentYear`. Captures the fact that a survivor supports a
   * child for a defined period, not forever.
   */
  survivorSpendingFactorAfterChildren?: number;
  /** Calendar year the last dependent becomes financially independent. */
  dependentsIndependentYear?: number;
  /**
   * What the survivor earns, as a fraction of the deceased's salary, from
   * `survivorReturnToWorkDelayYears` after the death until their retirement
   * age. Zero models a survivor who never works again — a strong assumption
   * that usually drives the result more than the death benefit does.
   */
  survivorEarningsFraction?: number;
  survivorReturnToWorkDelayYears?: number;
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface Plan {
  id: string;
  name: string;
  /** Calendar year the projection starts. */
  startYear: number;
  /**
   * Calendar month the projection starts (1–12, default January).
   *
   * Only debt amortization is month-sensitive, but it matters there: assuming
   * a January start when the balances were read mid-year shifts every payoff
   * date by half a year, and a payoff date that disagrees with the user's own
   * statement undermines confidence in everything else on the page.
   */
  startMonth?: number;
  people: Person[];
  accounts: Account[];
  incomes: Income[];
  expenses: Expense[];
  debts: Debt[];
  assets: Asset[];
  windfalls: Windfall[];
  insurance: InsurancePolicy[];
  assumptions: Assumptions;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Projection output
// ---------------------------------------------------------------------------

/** One year of the projection. The engine emits an array of these. */
export interface YearRow {
  year: number;
  /** Age of each person, keyed by person id. */
  ages: Record<string, number>;
  /** Age of the primary (first) person — convenience for charting. */
  primaryAge: number;
  retired: boolean;
  /**
   * What the household basket costs relative to the start year, along this
   * run's own inflation path. A nominal amount divided by it is in today's
   * dollars.
   */
  householdPriceLevel: number;

  // Income
  earnedIncome: number;
  selfEmploymentIncome: number;
  pensionIncome: number;
  socialSecurity: number;
  /** Portion of `socialSecurity` that is taxable (0–85%). */
  taxableSocialSecurity: number;
  otherIncome: number;
  windfallIncome: number;
  grossIncome: number;

  // Outflows
  spending: number;
  debtInterest: number;
  debtPrincipal: number;
  federalTax: number;
  stateTax: number;
  ficaTax: number;
  totalTax: number;

  // Savings & withdrawals
  contributions: number;
  employerMatch: number;
  withdrawals: number;
  /** Withdrawal amount by tax bucket. */
  withdrawalsByBucket: Record<TaxBucket, number>;
  requiredMinimumDistribution: number;

  // Balances at year end
  balancesByAccount: Record<string, number>;
  balancesByBucket: Record<TaxBucket, number>;
  investableAssets: number;
  /** Home, vehicles, etc. */
  otherAssetValue: number;
  debtBalance: number;
  netWorth: number;

  /** Withdrawals ÷ investable assets at the start of the year. */
  withdrawalRate: number;
  /** True once the plan can no longer fund its spending. */
  shortfall: boolean;
  shortfallAmount: number;
}

export interface ProjectionResult {
  rows: YearRow[];
  /** First year spending could not be funded, if any. */
  depletionYear?: number;
  /** Net worth in the final year. */
  finalNetWorth: number;
  /** True if the plan funded every year through `planEndAge`. */
  succeeded: boolean;
}
