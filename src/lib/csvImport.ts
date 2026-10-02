/**
 * Budget CSV import.
 *
 * The point of this module is narrow and deliberate: **derive a real spending
 * baseline**. Monthly spending is the single most leveraged number in the
 * whole projection — it sets the retirement target, the emergency-fund
 * requirement, and the withdrawal rate — and it is almost always the one
 * that's estimated. Everything else in a budget export is ignored.
 *
 * Nothing here is specific to one product. YNAB register exports work because
 * their columns are auto-detected, not because they're special-cased.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

/**
 * Parse delimited text, honouring quoted fields.
 *
 * Hand-rolled rather than pulled from a dependency: the format is small, and
 * the failure modes that matter here — a comma inside a payee name, an escaped
 * quote — are exactly the ones a naive `split(',')` gets wrong.
 */
export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const delimiter = detectDelimiter(clean);

  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') inQuotes = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows, delimiter };
}

function detectDelimiter(text: string): string {
  const sample = text.slice(0, 4000);
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = 0;

  for (const candidate of candidates) {
    const count = sample.split(candidate).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Column detection
// ---------------------------------------------------------------------------

export interface ColumnMapping {
  date?: number;
  category?: number;
  payee?: number;
  /** A single signed amount column. */
  amount?: number;
  /** Separate outflow/inflow columns, as YNAB and several banks export. */
  outflow?: number;
  inflow?: number;
}

const PATTERNS: { key: keyof ColumnMapping; match: RegExp }[] = [
  { key: 'date', match: /^(date|transaction date|posted|posting date)$/i },
  // Prefer the plain "Category" over "Category Group/Category".
  { key: 'category', match: /^category$/i },
  { key: 'payee', match: /^(payee|description|name|merchant)$/i },
  { key: 'outflow', match: /^(outflow|debit|withdrawal|spent)$/i },
  { key: 'inflow', match: /^(inflow|credit|deposit|received)$/i },
  { key: 'amount', match: /^(amount|value|total)$/i },
];

/** Best-guess column roles from the header row. */
export function detectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};

  for (const { key, match } of PATTERNS) {
    if (mapping[key] !== undefined) continue;
    const index = headers.findIndex((h) => match.test(h.trim()));
    if (index >= 0) mapping[key] = index;
  }

  // Fall back to a looser match for category, which vendors name variously.
  if (mapping.category === undefined) {
    const index = headers.findIndex((h) => /category/i.test(h));
    if (index >= 0) mapping.category = index;
  }

  return mapping;
}

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

/**
 * Parse a currency cell. Handles symbols, thousands separators, and the
 * accounting convention of wrapping negatives in parentheses.
 */
export function parseAmount(raw: string): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  if (!trimmed) return 0;

  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith('-');
  const digits = trimmed.replace(/[^0-9.]/g, '');
  if (!digits) return 0;

  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) return 0;
  return negative ? -value : value;
}

/**
 * Parse a date cell, preferring ISO and falling back to US-style ordering.
 * Returns undefined rather than an Invalid Date so callers can count skips.
 */
export function parseDate(raw: string): Date | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) {
    return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(trimmed);
  if (slash) {
    let [, a, b, y] = slash;
    let year = Number(y);
    if (year < 100) year += 2000;
    // Ambiguous without a locale; assume month-first, but if the first part
    // can only be a day, swap.
    let month = Number(a);
    let day = Number(b);
    if (month > 12) [month, day] = [day, month];
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

// ---------------------------------------------------------------------------
// Summarizing
// ---------------------------------------------------------------------------

/**
 * How a category behaves for planning:
 *  - `recurring`  — a steady monthly bill (utilities, groceries, fuel). These
 *    are what belong in the baseline as itemized lines.
 *  - `discretionary` — lumpy or optional (dining, travel, a concert, a dentist
 *    visit, car repair). Real money, but not a fixed monthly obligation, so it
 *    reads wrong as a permanent line item. Rolled into one aggregate instead.
 */
export type CategoryClass = 'recurring' | 'discretionary';

export interface CategorySummary {
  category: string;
  total: number;
  monthlyAverage: number;
  transactions: number;
  /** Share of total outflow, 0–1. */
  share: number;
  classification: CategoryClass;
}

export interface ImportSummary {
  /** Whole months spanned by the data, at least 1. */
  monthsCovered: number;
  firstDate?: Date;
  lastDate?: Date;
  totalOutflow: number;
  totalInflow: number;
  monthlyAverage: number;
  categories: CategorySummary[];
  transactionCount: number;
  /** Rows that could not be read — bad dates, unparseable amounts. */
  skipped: number;
  warnings: string[];
}

export interface SummarizeOptions {
  /** Only include the most recent N months. */
  trailingMonths?: number;
  /** Categories to exclude — transfers, savings, credit-card payments. */
  excludeCategories?: string[];
}

/**
 * Categories that are movements between your own accounts rather than
 * spending. Counting them would double-count: the money is spent when the
 * card is used, not again when the card is paid.
 */
const DEFAULT_EXCLUDED = [
  /transfer/i,
  /credit card payment/i,
  /^payment/i,
  /reconciliation/i,
  /starting balance/i,
  /^inflow/i,
  /to be budgeted/i,
  /ready to assign/i,
];

function isExcluded(category: string, extra: string[]): boolean {
  if (extra.some((e) => e.toLowerCase() === category.toLowerCase())) return true;
  return DEFAULT_EXCLUDED.some((pattern) => pattern.test(category));
}

/**
 * Steady monthly bills — the categories that belong in the baseline as their
 * own lines. Fuel and utilities count even though the exact amount wobbles,
 * because the *obligation* recurs every month.
 */
const RECURRING_PATTERNS = [
  /electric|power|energy/i,
  /\bgas\b|natural gas|heating/i, // utility gas OR auto fuel — both recur
  /fuel|gasoline/i,
  /water|sewer|sewage/i,
  /trash|garbage|waste|recycl/i,
  /internet|cable|wifi|broadband/i,
  /phone|cell|mobile|wireless|telecom/i,
  /grocer|groceries/i,
  /utilit/i,
  /insurance|premium/i,
  /\brent\b|escrow|\bhoa\b|association dues/i,
  /child care|childcare|daycare|day care/i,
  /transport|transit|commut|parking/i,
  /subscription|streaming|netflix|spotify|membership/i,
  /internet & phone|phone & internet/i,
];

/**
 * Lumpy or optional spending. Real, and it stays in the total — but as a single
 * aggregate line rather than a permanent monthly bill that never happened
 * again. Anything that matches neither list falls here too, which is the safe
 * default: it keeps the total honest without inventing a recurring obligation.
 */
const DISCRETIONARY_PATTERNS = [
  /dining|restaurant|eating out|coffee|fast food|takeout|bar\b/i,
  /entertain|concert|movie|event|ticket|hobby|recreation|\bfun\b|games?/i,
  /travel|vacation|hotel|airfare|flight|trip/i,
  /gift|donation|charit/i,
  /cloth|apparel|shoes|shopping/i,
  /personal care|haircut|salon|beauty|cosmetic|spa/i,
  /medical|dental|dentist|doctor|pharmacy|vision|copay|prescription/i,
  /maintenance|repair/i,
  /home improve|furniture|home goods|decor/i,
  /electronic|gadget|tech\b/i,
  /\bpet\b|pets|veterinar/i,
  /books?|education|course|class/i,
  /misc|other|allowance|spending money|fun money|blow money/i,
];

/**
 * Classify a spending category. Order matters: an explicit discretionary match
 * wins over a loose recurring one (so "Dining" never reads as a utility), and
 * anything unmatched defaults to discretionary — the conservative choice, since
 * it counts toward the total without becoming a fixed monthly line.
 */
export function classifyCategory(category: string): CategoryClass {
  if (DISCRETIONARY_PATTERNS.some((p) => p.test(category))) return 'discretionary';
  if (RECURRING_PATTERNS.some((p) => p.test(category))) return 'recurring';
  return 'discretionary';
}

export function summarize(
  parsed: ParsedCsv,
  mapping: ColumnMapping,
  options: SummarizeOptions = {},
): ImportSummary {
  const warnings: string[] = [];
  const byCategory = new Map<string, { total: number; count: number }>();

  let totalOutflow = 0;
  let totalInflow = 0;
  let skipped = 0;
  let counted = 0;
  let firstDate: Date | undefined;
  let lastDate: Date | undefined;

  // Establish the cutoff from the newest date present, not from today — an
  // export is often a few days or weeks stale.
  let newest: Date | undefined;
  if (mapping.date !== undefined) {
    for (const row of parsed.rows) {
      const date = parseDate(row[mapping.date] ?? '');
      if (date && (!newest || date > newest)) newest = date;
    }
  }
  const cutoff =
    newest && options.trailingMonths
      ? new Date(newest.getFullYear(), newest.getMonth() - options.trailingMonths + 1, 1)
      : undefined;

  for (const row of parsed.rows) {
    const date = mapping.date !== undefined ? parseDate(row[mapping.date] ?? '') : undefined;
    if (mapping.date !== undefined && !date) {
      skipped++;
      continue;
    }
    if (cutoff && date && date < cutoff) continue;

    // Outflow/inflow pair takes precedence over a single signed column.
    let outflow = 0;
    let inflow = 0;
    if (mapping.outflow !== undefined || mapping.inflow !== undefined) {
      outflow = Math.abs(parseAmount(row[mapping.outflow ?? -1] ?? ''));
      inflow = Math.abs(parseAmount(row[mapping.inflow ?? -1] ?? ''));
    } else if (mapping.amount !== undefined) {
      const value = parseAmount(row[mapping.amount] ?? '');
      if (value < 0) outflow = -value;
      else inflow = value;
    } else {
      skipped++;
      continue;
    }

    if (outflow === 0 && inflow === 0) continue;

    const category = (mapping.category !== undefined ? row[mapping.category] : '')?.trim() || 'Uncategorized';
    if (isExcluded(category, options.excludeCategories ?? [])) continue;

    totalInflow += inflow;
    if (outflow > 0) {
      totalOutflow += outflow;
      const entry = byCategory.get(category) ?? { total: 0, count: 0 };
      entry.total += outflow;
      entry.count++;
      byCategory.set(category, entry);
      counted++;
    }

    if (date) {
      if (!firstDate || date < firstDate) firstDate = date;
      if (!lastDate || date > lastDate) lastDate = date;
    }
  }

  const monthsCovered =
    firstDate && lastDate
      ? Math.max(
          1,
          (lastDate.getFullYear() - firstDate.getFullYear()) * 12 +
            (lastDate.getMonth() - firstDate.getMonth()) +
            1,
        )
      : 1;

  // Annual and irregular costs — insurance renewals, property tax, car
  // repairs, holidays — are exactly what a short window misses, and they are
  // also what makes a hand-built budget come out too low. The shorter the
  // window, the more firmly this should say so.
  if (monthsCovered < 3) {
    warnings.push(
      `Only ${monthsCovered} month${monthsCovered === 1 ? '' : 's'} of data. Annual and irregular costs — insurance renewals, property tax, repairs, holidays — are almost certainly missing, so this average will read low. Twelve months is the figure to trust.`,
    );
  } else if (monthsCovered < 12) {
    warnings.push(
      `${monthsCovered} months of data. That is enough for routine spending, but anything billed annually will only appear if it happened to fall in this window — so treat the total as a floor rather than an average.`,
    );
  }
  if (mapping.category === undefined) {
    warnings.push('No category column detected, so everything lands under "Uncategorized". The total is still usable.');
  }
  if (skipped > 0) {
    warnings.push(`${skipped} row${skipped === 1 ? '' : 's'} skipped — unreadable date or amount.`);
  }

  const categories: CategorySummary[] = [...byCategory.entries()]
    .map(([category, { total, count }]) => ({
      category,
      total,
      monthlyAverage: total / monthsCovered,
      transactions: count,
      share: totalOutflow > 0 ? total / totalOutflow : 0,
      classification: classifyCategory(category),
    }))
    .sort((a, b) => b.total - a.total);

  return {
    monthsCovered,
    firstDate,
    lastDate,
    totalOutflow,
    totalInflow,
    monthlyAverage: totalOutflow / monthsCovered,
    categories,
    transactionCount: counted,
    skipped,
    warnings,
  };
}
