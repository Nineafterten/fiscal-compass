/**
 * Formatting and the nominal/real dollar conversion.
 *
 * Over a 50-year projection, nominal dollars are actively misleading — "$30M
 * at 95" sounds transformative until you notice it buys what $7M buys today.
 * The app therefore defaults to today's dollars, and says which it's showing.
 */

import type { ProjectionResult, YearRow } from '../types/plan';

const currency0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const currency2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number, decimals = false): string {
  if (!Number.isFinite(value)) return '—';
  return decimals ? currency2.format(value) : currency0.format(value);
}

/** Compact form for axis ticks and tight cards: $1.4M, $850k. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

export function formatPercent(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatMonths(months: number): string {
  if (!Number.isFinite(months)) return '—';
  if (months < 1) return `${Math.round(months * 4.345)} weeks`;
  if (months < 24) return `${months.toFixed(1)} months`;
  return `${(months / 12).toFixed(1)} years`;
}

// ---------------------------------------------------------------------------
// Real vs nominal
// ---------------------------------------------------------------------------

/** Every money field on a `YearRow`. Kept explicit so new fields can't slip by unconverted. */
const MONEY_FIELDS = [
  'earnedIncome',
  'selfEmploymentIncome',
  'pensionIncome',
  'socialSecurity',
  'taxableSocialSecurity',
  'otherIncome',
  'windfallIncome',
  'grossIncome',
  'spending',
  'debtInterest',
  'debtPrincipal',
  'federalTax',
  'stateTax',
  'ficaTax',
  'totalTax',
  'contributions',
  'employerMatch',
  'withdrawals',
  'requiredMinimumDistribution',
  'investableAssets',
  'otherAssetValue',
  'debtBalance',
  'netWorth',
  'shortfallAmount',
] as const satisfies readonly (keyof YearRow)[];

/**
 * Restate a projection in the purchasing power of `baseYear`.
 *
 * Non-money fields (ages, rates, flags) pass through untouched.
 */
export function toRealDollars(
  result: ProjectionResult,
  inflation: number,
  baseYear: number,
): ProjectionResult {
  const rows = result.rows.map((row) => {
    const deflator = Math.pow(1 + inflation, row.year - baseYear);
    const next = { ...row } as YearRow;

    for (const field of MONEY_FIELDS) {
      (next[field] as number) = row[field] / deflator;
    }

    next.balancesByAccount = Object.fromEntries(
      Object.entries(row.balancesByAccount).map(([id, v]) => [id, v / deflator]),
    );
    next.balancesByBucket = {
      pretax: row.balancesByBucket.pretax / deflator,
      roth: row.balancesByBucket.roth / deflator,
      taxable: row.balancesByBucket.taxable / deflator,
      tax_free_edu: row.balancesByBucket.tax_free_edu / deflator,
    };
    next.withdrawalsByBucket = {
      pretax: row.withdrawalsByBucket.pretax / deflator,
      roth: row.withdrawalsByBucket.roth / deflator,
      taxable: row.withdrawalsByBucket.taxable / deflator,
      tax_free_edu: row.withdrawalsByBucket.tax_free_edu / deflator,
    };

    return next;
  });

  return {
    ...result,
    rows,
    finalNetWorth: rows[rows.length - 1]?.netWorth ?? 0,
  };
}
