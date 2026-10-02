import { describe, expect, it } from 'vitest';
import {
  classifyCategory,
  detectColumns,
  parseAmount,
  parseCsv,
  parseDate,
  summarize,
} from './csvImport';

/** A YNAB register export, including the cases that break naive parsers. */
const YNAB = `"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"
"Checking","","01/15/2026","Trader Joe's, Main St","Everyday: Groceries","Everyday","Groceries","","$182.44","$0.00","Cleared"
"Checking","","01/18/2026","Shell","Everyday: Fuel","Everyday","Fuel","","$71.20","$0.00","Cleared"
"Checking","","01/31/2026","Employer","Inflow: Ready to Assign","Inflow","Ready to Assign","","$0.00","$5,500.00","Cleared"
"Checking","","02/02/2026","Transfer : Savings","","","Transfer","","$300.00","$0.00","Cleared"
"Credit","","02/14/2026","The ""Good"" Diner","Fun: Dining Out","Fun","Dining Out","anniversary","$96.80","$0.00","Uncleared"
"Checking","","02/20/2026","City Power & Light","Home: Utilities","Home","Utilities","","$210.05","$0.00","Cleared"
"Checking","","03/03/2026","Trader Joe's","Everyday: Groceries","Everyday","Groceries","","$204.10","$0.00","Cleared"
"Checking","","03/09/2026","Credit Card Payment","","","Credit Card Payment","","$96.80","$0.00","Cleared"
`;

describe('parseCsv', () => {
  it('reads the header row', () => {
    const parsed = parseCsv(YNAB);
    expect(parsed.headers).toContain('Date');
    expect(parsed.headers).toContain('Outflow');
    expect(parsed.delimiter).toBe(',');
  });

  it('keeps commas inside quoted fields', () => {
    const parsed = parseCsv(YNAB);
    expect(parsed.rows[0][3]).toBe("Trader Joe's, Main St");
    expect(parsed.rows[0]).toHaveLength(parsed.headers.length);
  });

  it('unescapes doubled quotes', () => {
    const parsed = parseCsv(YNAB);
    expect(parsed.rows[4][3]).toBe('The "Good" Diner');
  });

  it('skips blank lines', () => {
    const parsed = parseCsv('a,b\n1,2\n\n\n3,4\n');
    expect(parsed.rows).toHaveLength(2);
  });

  it('handles CRLF line endings', () => {
    const parsed = parseCsv('a,b\r\n1,2\r\n');
    expect(parsed.rows[0]).toEqual(['1', '2']);
  });

  it('strips a UTF-8 byte-order mark', () => {
    const parsed = parseCsv('﻿Date,Amount\n2026-01-01,5\n');
    expect(parsed.headers[0]).toBe('Date');
  });

  it('detects a tab delimiter', () => {
    const parsed = parseCsv('Date\tAmount\n2026-01-01\t5\n');
    expect(parsed.delimiter).toBe('\t');
    expect(parsed.headers).toEqual(['Date', 'Amount']);
  });
});

describe('detectColumns', () => {
  it('finds YNAB columns', () => {
    const parsed = parseCsv(YNAB);
    const mapping = detectColumns(parsed.headers);
    expect(parsed.headers[mapping.date!]).toBe('Date');
    expect(parsed.headers[mapping.outflow!]).toBe('Outflow');
    expect(parsed.headers[mapping.inflow!]).toBe('Inflow');
  });

  it('prefers the plain Category over Category Group/Category', () => {
    const parsed = parseCsv(YNAB);
    const mapping = detectColumns(parsed.headers);
    expect(parsed.headers[mapping.category!]).toBe('Category');
  });

  it('finds a single signed amount column', () => {
    const mapping = detectColumns(['Date', 'Description', 'Amount']);
    expect(mapping.amount).toBe(2);
    expect(mapping.outflow).toBeUndefined();
  });

  it('recognizes bank-style debit and credit headers', () => {
    const mapping = detectColumns(['Posted Date', 'Description', 'Debit', 'Credit']);
    expect(mapping.outflow).toBe(2);
    expect(mapping.inflow).toBe(3);
  });
});

describe('parseAmount', () => {
  it('strips currency symbols and separators', () => {
    expect(parseAmount('$1,234.56')).toBeCloseTo(1234.56, 2);
  });

  it('reads a leading minus as negative', () => {
    expect(parseAmount('-$50.00')).toBeCloseTo(-50, 2);
  });

  it('reads accounting parentheses as negative', () => {
    expect(parseAmount('($50.00)')).toBeCloseTo(-50, 2);
  });

  it('returns zero for blanks and junk', () => {
    expect(parseAmount('')).toBe(0);
    expect(parseAmount('   ')).toBe(0);
    expect(parseAmount('n/a')).toBe(0);
  });
});

describe('parseDate', () => {
  it('reads ISO dates', () => {
    expect(parseDate('2026-03-09')?.getFullYear()).toBe(2026);
    expect(parseDate('2026-03-09')?.getMonth()).toBe(2);
  });

  it('reads US-style dates as month first', () => {
    const date = parseDate('03/09/2026');
    expect(date?.getMonth()).toBe(2);
    expect(date?.getDate()).toBe(9);
  });

  it('swaps when the first part cannot be a month', () => {
    const date = parseDate('25/03/2026');
    expect(date?.getMonth()).toBe(2);
    expect(date?.getDate()).toBe(25);
  });

  it('expands two-digit years', () => {
    expect(parseDate('01/15/26')?.getFullYear()).toBe(2026);
  });

  it('returns undefined for unparseable input', () => {
    expect(parseDate('')).toBeUndefined();
    expect(parseDate('not a date')).toBeUndefined();
  });
});

describe('classifyCategory', () => {
  it('treats standard bills as recurring', () => {
    for (const c of [
      'Electric',
      'Electricity',
      'Water & Sewer',
      'Internet',
      'Phone',
      'Groceries',
      'Fuel',
      'Gas & Electric',
      'Auto Insurance',
      'Trash',
      'Utilities',
    ]) {
      expect(classifyCategory(c)).toBe('recurring');
    }
  });

  it('treats lumpy and optional spending as discretionary', () => {
    for (const c of [
      'Dining Out',
      'Concert Tickets',
      'Entertainment',
      'Travel',
      'Gifts',
      'Clothing',
      'Auto Maintenance',
      'Dentist',
      'Medical',
      'Home Improvement',
      'Fun Money',
    ]) {
      expect(classifyCategory(c)).toBe('discretionary');
    }
  });

  it('defaults an unrecognized category to discretionary', () => {
    // Safe default: it still counts toward the total, just not as a fixed bill.
    expect(classifyCategory('Something Unusual')).toBe('discretionary');
  });

  it("lets an explicit discretionary word win over a loose recurring one", () => {
    // "Dining" must not read as recurring just because a bill keyword is near.
    expect(classifyCategory('Dining & Entertainment')).toBe('discretionary');
  });
});

describe('summarize', () => {
  const parsed = parseCsv(YNAB);
  const mapping = detectColumns(parsed.headers);

  it('tags each category with a classification', () => {
    const summary = summarize(parsed, mapping);
    const groceries = summary.categories.find((c) => c.category === 'Groceries');
    const dining = summary.categories.find((c) => c.category === 'Dining Out');
    expect(groceries?.classification).toBe('recurring');
    expect(dining?.classification).toBe('discretionary');
  });

  it('excludes transfers and credit-card payments', () => {
    const summary = summarize(parsed, mapping);
    const names = summary.categories.map((c) => c.category);
    expect(names).not.toContain('Transfer');
    expect(names).not.toContain('Credit Card Payment');
  });

  it('excludes inflow rows from spending', () => {
    const summary = summarize(parsed, mapping);
    expect(summary.categories.map((c) => c.category)).not.toContain('Ready to Assign');
  });

  it('totals only real outflow', () => {
    const summary = summarize(parsed, mapping);
    // 182.44 + 71.20 + 96.80 + 210.05 + 204.10, with transfers excluded.
    expect(summary.totalOutflow).toBeCloseTo(764.59, 2);
  });

  it('averages over the months the data spans', () => {
    const summary = summarize(parsed, mapping);
    expect(summary.monthsCovered).toBe(3); // January through March
    expect(summary.monthlyAverage).toBeCloseTo(764.59 / 3, 2);
  });

  it('groups repeated categories', () => {
    const summary = summarize(parsed, mapping);
    const groceries = summary.categories.find((c) => c.category === 'Groceries');
    expect(groceries?.transactions).toBe(2);
    expect(groceries?.total).toBeCloseTo(386.54, 2);
  });

  it('sorts categories by size', () => {
    const summary = summarize(parsed, mapping);
    for (let i = 1; i < summary.categories.length; i++) {
      expect(summary.categories[i - 1].total).toBeGreaterThanOrEqual(
        summary.categories[i].total,
      );
    }
  });

  it('warns when the window is too short to see annual costs', () => {
    const summary = summarize(parsed, mapping);
    expect(summary.warnings.some((w) => /month/i.test(w))).toBe(true);
  });

  it('honours a trailing-month window', () => {
    // Only March, measured from the newest date in the file rather than today.
    const summary = summarize(parsed, mapping, { trailingMonths: 1 });
    expect(summary.totalOutflow).toBeCloseTo(204.1, 2);
  });

  it('supports a signed amount column', () => {
    const csv = 'Date,Category,Amount\n2026-01-05,Groceries,-100.00\n2026-01-06,Salary,2000.00\n';
    const simple = parseCsv(csv);
    const summary = summarize(simple, detectColumns(simple.headers));
    expect(summary.totalOutflow).toBeCloseTo(100, 2);
    expect(summary.totalInflow).toBeCloseTo(2000, 2);
  });

  it('handles a file with no category column', () => {
    const csv = 'Date,Amount\n2026-01-05,-100.00\n';
    const simple = parseCsv(csv);
    const summary = summarize(simple, detectColumns(simple.headers));
    expect(summary.categories[0].category).toBe('Uncategorized');
    expect(summary.warnings.some((w) => /category/i.test(w))).toBe(true);
  });

  it('counts unreadable rows as skipped', () => {
    const csv = 'Date,Category,Amount\nnot-a-date,Groceries,-10\n2026-01-05,Groceries,-20\n';
    const simple = parseCsv(csv);
    const summary = summarize(simple, detectColumns(simple.headers));
    expect(summary.skipped).toBe(1);
    expect(summary.totalOutflow).toBeCloseTo(20, 2);
  });
});
