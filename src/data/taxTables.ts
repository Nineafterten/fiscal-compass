/**
 * Tax constants.
 *
 * `BASE_TAX_YEAR` holds real, published figures for one year. Every later year
 * is derived by inflating those figures forward at the plan's assumed inflation
 * rate — which is what actually happens, since the IRS indexes brackets,
 * deductions, and contribution limits annually.
 *
 * ---------------------------------------------------------------------------
 * MAINTENANCE: these are 2026 values (Rev. Proc. 2025-32 / IR-2025-xx).
 * Re-verify each January against irs.gov and bump `BASE_YEAR`. Everything here
 * is also editable at runtime in Settings, so a stale table is a nuisance
 * rather than a wrong answer.
 * ---------------------------------------------------------------------------
 */

export type FilingStatus = 'single' | 'mfj';

/** A marginal bracket: `rate` applies to income above `floor`. */
export interface Bracket {
  floor: number;
  rate: number;
}

export interface TaxYearTable {
  year: number;
  ordinaryBrackets: Record<FilingStatus, Bracket[]>;
  longTermGainsBrackets: Record<FilingStatus, Bracket[]>;
  standardDeduction: Record<FilingStatus, number>;

  // Payroll
  socialSecurityWageBase: number;
  socialSecurityRate: number;
  medicareRate: number;
  additionalMedicareRate: number;
  additionalMedicareThreshold: Record<FilingStatus, number>;

  // Contribution limits
  limit401kEmployee: number;
  limit401kCatchUp: number;
  limitIra: number;
  limitIraCatchUp: number;
  limitHsaFamily: number;
  limitHsaSelfOnly: number;

  // Roth IRA direct-contribution MAGI phaseout
  rothPhaseoutStart: Record<FilingStatus, number>;
  rothPhaseoutEnd: Record<FilingStatus, number>;
}

export const BASE_YEAR = 2026;

export const BASE_TAX_YEAR: TaxYearTable = {
  year: BASE_YEAR,

  ordinaryBrackets: {
    mfj: [
      { floor: 0, rate: 0.1 },
      { floor: 24_800, rate: 0.12 },
      { floor: 100_800, rate: 0.22 },
      { floor: 211_100, rate: 0.24 },
      { floor: 402_800, rate: 0.32 },
      { floor: 512_450, rate: 0.35 },
      { floor: 768_700, rate: 0.37 },
    ],
    single: [
      { floor: 0, rate: 0.1 },
      { floor: 12_400, rate: 0.12 },
      { floor: 50_400, rate: 0.22 },
      { floor: 105_700, rate: 0.24 },
      { floor: 201_775, rate: 0.32 },
      { floor: 256_225, rate: 0.35 },
      { floor: 640_600, rate: 0.37 },
    ],
  },

  longTermGainsBrackets: {
    mfj: [
      { floor: 0, rate: 0 },
      { floor: 99_200, rate: 0.15 },
      { floor: 547_650, rate: 0.2 },
    ],
    single: [
      { floor: 0, rate: 0 },
      { floor: 49_600, rate: 0.15 },
      { floor: 486_700, rate: 0.2 },
    ],
  },

  standardDeduction: { mfj: 32_200, single: 16_100 },

  socialSecurityWageBase: 184_500,
  socialSecurityRate: 0.062,
  medicareRate: 0.0145,
  additionalMedicareRate: 0.009,
  additionalMedicareThreshold: { mfj: 250_000, single: 200_000 },

  limit401kEmployee: 24_500,
  limit401kCatchUp: 8_000,
  limitIra: 7_500,
  limitIraCatchUp: 1_100,
  limitHsaFamily: 8_750,
  limitHsaSelfOnly: 4_400,

  rothPhaseoutStart: { mfj: 242_000, single: 153_000 },
  rothPhaseoutEnd: { mfj: 252_000, single: 168_000 },
};

/**
 * Provisional-income thresholds that decide how much Social Security is taxed.
 *
 * These are NOT inflation-indexed — they've been frozen since 1983 and 1993.
 * That's deliberate on Congress's part and it's why an ever-growing share of
 * retirees owe tax on benefits (the "tax torpedo"). Keeping them fixed here is
 * correct, not an oversight.
 */
export const SS_TAXATION_THRESHOLDS: Record<
  FilingStatus,
  { tier1: number; tier2: number }
> = {
  mfj: { tier1: 32_000, tier2: 44_000 },
  single: { tier1: 25_000, tier2: 34_000 },
};

/**
 * IRS Uniform Lifetime Table (effective 2022+), used for required minimum
 * distributions. Divide the prior year-end pretax balance by the divisor.
 */
export const RMD_DIVISORS: Record<number, number> = {
  73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1,
  80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2,
  87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1,
  94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
  101: 6.0, 102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1,
  108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4, 112: 3.3, 113: 3.1, 114: 3.0,
  115: 2.9,
};

/**
 * Age at which RMDs begin, under SECURE 2.0.
 *
 * 73 for those who turned 72 after 2022; 75 for those who turn 74 after 2032
 * — i.e. anyone born in 1960 or later.
 */
export function rmdStartAge(birthYear: number): number {
  if (birthYear >= 1960) return 75;
  if (birthYear >= 1951) return 73;
  return 72;
}

export function rmdDivisor(age: number): number | undefined {
  if (age < 73) return undefined;
  return RMD_DIVISORS[Math.min(age, 115)];
}

// ---------------------------------------------------------------------------
// State income tax — a deliberately simple pluggable adapter
// ---------------------------------------------------------------------------

export interface StateTaxRule {
  code: string;
  name: string;
  /** Flat rate applied to taxable ordinary income. */
  flatRate: number;
  /** Whether the state taxes Social Security benefits. */
  taxesSocialSecurity: boolean;
  /** Whether the state taxes pension and retirement-account distributions. */
  taxesRetirementIncome: boolean;
  note?: string;
}

/**
 * A flat-rate approximation per state. Graduated state brackets are a
 * refinement worth making later; for states with no income tax the answer is
 * exact.
 */
export const STATE_TAX_RULES: Record<string, StateTaxRule> = {
  WA: {
    code: 'WA',
    name: 'Washington',
    flatRate: 0,
    taxesSocialSecurity: false,
    taxesRetirementIncome: false,
    note:
      'No income tax on wages, pensions, or Social Security. The 7% capital-gains tax applies only above a ~$262k annual threshold and exempts retirement accounts, so it rarely binds for a household drawing down a portfolio.',
  },
  TX: { code: 'TX', name: 'Texas', flatRate: 0, taxesSocialSecurity: false, taxesRetirementIncome: false },
  FL: { code: 'FL', name: 'Florida', flatRate: 0, taxesSocialSecurity: false, taxesRetirementIncome: false },
  NV: { code: 'NV', name: 'Nevada', flatRate: 0, taxesSocialSecurity: false, taxesRetirementIncome: false },
  TN: { code: 'TN', name: 'Tennessee', flatRate: 0, taxesSocialSecurity: false, taxesRetirementIncome: false },
  WY: { code: 'WY', name: 'Wyoming', flatRate: 0, taxesSocialSecurity: false, taxesRetirementIncome: false },
  SD: { code: 'SD', name: 'South Dakota', flatRate: 0, taxesSocialSecurity: false, taxesRetirementIncome: false },
  AK: { code: 'AK', name: 'Alaska', flatRate: 0, taxesSocialSecurity: false, taxesRetirementIncome: false },
  NH: { code: 'NH', name: 'New Hampshire', flatRate: 0, taxesSocialSecurity: false, taxesRetirementIncome: false },
  CA: { code: 'CA', name: 'California', flatRate: 0.093, taxesSocialSecurity: false, taxesRetirementIncome: true },
  OR: { code: 'OR', name: 'Oregon', flatRate: 0.0875, taxesSocialSecurity: false, taxesRetirementIncome: true },
  NY: { code: 'NY', name: 'New York', flatRate: 0.0685, taxesSocialSecurity: false, taxesRetirementIncome: true },
  CO: { code: 'CO', name: 'Colorado', flatRate: 0.044, taxesSocialSecurity: false, taxesRetirementIncome: true },
  IL: { code: 'IL', name: 'Illinois', flatRate: 0.0495, taxesSocialSecurity: false, taxesRetirementIncome: false },
  AZ: { code: 'AZ', name: 'Arizona', flatRate: 0.025, taxesSocialSecurity: false, taxesRetirementIncome: true },
  NC: { code: 'NC', name: 'North Carolina', flatRate: 0.0425, taxesSocialSecurity: false, taxesRetirementIncome: true },
  GA: { code: 'GA', name: 'Georgia', flatRate: 0.0539, taxesSocialSecurity: false, taxesRetirementIncome: true },
  MA: { code: 'MA', name: 'Massachusetts', flatRate: 0.05, taxesSocialSecurity: false, taxesRetirementIncome: true },
  VA: { code: 'VA', name: 'Virginia', flatRate: 0.0575, taxesSocialSecurity: false, taxesRetirementIncome: true },
  NJ: { code: 'NJ', name: 'New Jersey', flatRate: 0.0637, taxesSocialSecurity: false, taxesRetirementIncome: true },
};

export const DEFAULT_STATE_RULE: StateTaxRule = {
  code: 'XX',
  name: 'Other / unknown',
  flatRate: 0.05,
  taxesSocialSecurity: false,
  taxesRetirementIncome: true,
  note: 'Generic 5% placeholder. Set your state in Settings for a closer figure.',
};

export function stateRule(code: string): StateTaxRule {
  return STATE_TAX_RULES[code.toUpperCase()] ?? DEFAULT_STATE_RULE;
}

// ---------------------------------------------------------------------------
// Inflating the table forward
// ---------------------------------------------------------------------------

function inflateBrackets(brackets: Bracket[], factor: number): Bracket[] {
  return brackets.map((b) => ({ floor: Math.round(b.floor * factor), rate: b.rate }));
}

/** Contribution limits move in $500 increments; brackets round to the dollar. */
function roundTo(value: number, increment: number): number {
  return Math.round(value / increment) * increment;
}

/**
 * The tax table for a given year, with every indexed figure inflated forward
 * from `BASE_TAX_YEAR`. Years at or before the base year return it unchanged.
 */
export function taxTableFor(year: number, inflation: number): TaxYearTable {
  const years = year - BASE_YEAR;
  if (years <= 0) return BASE_TAX_YEAR;
  const f = Math.pow(1 + inflation, years);
  const b = BASE_TAX_YEAR;

  return {
    year,
    ordinaryBrackets: {
      mfj: inflateBrackets(b.ordinaryBrackets.mfj, f),
      single: inflateBrackets(b.ordinaryBrackets.single, f),
    },
    longTermGainsBrackets: {
      mfj: inflateBrackets(b.longTermGainsBrackets.mfj, f),
      single: inflateBrackets(b.longTermGainsBrackets.single, f),
    },
    standardDeduction: {
      mfj: roundTo(b.standardDeduction.mfj * f, 50),
      single: roundTo(b.standardDeduction.single * f, 50),
    },
    socialSecurityWageBase: roundTo(b.socialSecurityWageBase * f, 300),
    socialSecurityRate: b.socialSecurityRate,
    medicareRate: b.medicareRate,
    additionalMedicareRate: b.additionalMedicareRate,
    // Not indexed — same freeze as the SS taxation thresholds.
    additionalMedicareThreshold: b.additionalMedicareThreshold,
    limit401kEmployee: roundTo(b.limit401kEmployee * f, 500),
    limit401kCatchUp: roundTo(b.limit401kCatchUp * f, 500),
    limitIra: roundTo(b.limitIra * f, 500),
    limitIraCatchUp: roundTo(b.limitIraCatchUp * f, 100),
    limitHsaFamily: roundTo(b.limitHsaFamily * f, 50),
    limitHsaSelfOnly: roundTo(b.limitHsaSelfOnly * f, 50),
    rothPhaseoutStart: {
      mfj: roundTo(b.rothPhaseoutStart.mfj * f, 1000),
      single: roundTo(b.rothPhaseoutStart.single * f, 1000),
    },
    rothPhaseoutEnd: {
      mfj: roundTo(b.rothPhaseoutEnd.mfj * f, 1000),
      single: roundTo(b.rothPhaseoutEnd.single * f, 1000),
    },
  };
}
