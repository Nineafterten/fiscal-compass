import { describe, expect, it } from 'vitest';
import {
  computeFica,
  computeTaxes,
  grossUpWithdrawal,
  marginalRate,
  taxOnBand,
  taxOnBrackets,
  taxableSocialSecurity,
} from './tax';
import { BASE_TAX_YEAR } from '../../data/taxTables';

const table = BASE_TAX_YEAR;
const mfjBrackets = table.ordinaryBrackets.mfj;

describe('taxOnBrackets', () => {
  it('taxes income entirely within the first bracket at that rate', () => {
    expect(taxOnBrackets(20_000, mfjBrackets)).toBeCloseTo(2_000, 2);
  });

  it('applies each bracket marginally', () => {
    // 2026 MFJ: 10% on the first 24,800, then 12% to 100,800.
    // 24,800 x .10 = 2,480; 25,200 x .12 = 3,024.
    expect(taxOnBrackets(50_000, mfjBrackets)).toBeCloseTo(2_480 + 3_024, 2);
  });

  it('handles the exact top of a bracket', () => {
    expect(taxOnBrackets(24_800, mfjBrackets)).toBeCloseTo(2_480, 2);
  });

  it('returns zero for zero or negative income', () => {
    expect(taxOnBrackets(0, mfjBrackets)).toBe(0);
    expect(taxOnBrackets(-5_000, mfjBrackets)).toBe(0);
  });
});

describe('taxOnBand', () => {
  it('taxes only the slice between lo and hi', () => {
    // The band 24,800 -> 50,000 sits entirely in the 12% bracket.
    expect(taxOnBand(24_800, 50_000, mfjBrackets)).toBeCloseTo(25_200 * 0.12, 2);
  });

  it('spans multiple brackets correctly', () => {
    // A band from 0 is identical to taxing from zero.
    expect(taxOnBand(0, 150_000, mfjBrackets)).toBeCloseTo(
      taxOnBrackets(150_000, mfjBrackets),
      2,
    );
  });

  it('is additive across adjacent bands', () => {
    const whole = taxOnBand(0, 300_000, mfjBrackets);
    const split = taxOnBand(0, 120_000, mfjBrackets) + taxOnBand(120_000, 300_000, mfjBrackets);
    expect(split).toBeCloseTo(whole, 6);
  });

  it('returns zero when the band is empty or inverted', () => {
    expect(taxOnBand(50_000, 50_000, mfjBrackets)).toBe(0);
    expect(taxOnBand(50_000, 10_000, mfjBrackets)).toBe(0);
  });
});

describe('marginalRate', () => {
  it('finds the bracket the next dollar falls in', () => {
    expect(marginalRate(20_000, mfjBrackets)).toBe(0.1);
    expect(marginalRate(50_000, mfjBrackets)).toBe(0.12);
    expect(marginalRate(150_000, mfjBrackets)).toBe(0.22);
    expect(marginalRate(900_000, mfjBrackets)).toBe(0.37);
  });
});

describe('computeFica', () => {
  it('caps Social Security at the wage base but not Medicare', () => {
    const wages = 300_000;
    const fica = computeFica({ wages, selfEmployment: 0, filingStatus: 'mfj', table });

    const expected =
      table.socialSecurityWageBase * 0.062 + // SS capped
      wages * 0.0145 + // Medicare uncapped
      (wages - 250_000) * 0.009; // additional Medicare over the MFJ threshold

    expect(fica).toBeCloseTo(expected, 2);
  });

  it('charges both halves on self-employment income', () => {
    const employee = computeFica({ wages: 50_000, selfEmployment: 0, filingStatus: 'mfj', table });
    const selfEmployed = computeFica({ wages: 0, selfEmployment: 50_000, filingStatus: 'mfj', table });
    // Both halves on 92.35% of net earnings is ~1.847x the employee-only rate.
    expect(selfEmployed / employee).toBeCloseTo(2 * 0.9235, 3);
  });

  it('is zero with no earned income', () => {
    expect(computeFica({ wages: 0, selfEmployment: 0, filingStatus: 'mfj', table })).toBe(0);
  });

  it('applies the Social Security wage base to each person', () => {
    const salary = table.socialSecurityWageBase + 50_000;
    const fica = computeFica({
      wages: salary,
      selfEmployment: 40_000,
      earners: [
        { wages: salary, selfEmployment: 0 },
        { wages: 0, selfEmployment: 40_000 },
      ],
      filingStatus: 'mfj',
      table,
    });

    const seBase = 40_000 * 0.9235;
    const expected =
      table.socialSecurityWageBase * 0.062 + // the salary caps at its own base
      seBase * 0.124 + // the other person's self-employment still pays both halves
      salary * 0.0145 +
      seBase * 0.029 +
      (salary + seBase - 250_000) * 0.009; // additional Medicare stays per return

    expect(fica).toBeCloseTo(expected, 2);
  });

  it('gives the household result for a single earner', () => {
    const input = {
      wages: table.socialSecurityWageBase - 20_000,
      selfEmployment: 60_000,
      filingStatus: 'mfj' as const,
      table,
    };
    const perPerson = computeFica({
      ...input,
      earners: [{ wages: input.wages, selfEmployment: input.selfEmployment }],
    });

    expect(perPerson).toBeCloseTo(computeFica(input), 6);
  });
});

describe('taxableSocialSecurity', () => {
  it('taxes nothing below the first threshold', () => {
    // Provisional income = 10,000 + 12,000 = 22,000, under the 32,000 tier.
    expect(taxableSocialSecurity(24_000, 10_000, 'mfj')).toBe(0);
  });

  it('taxes up to 50% in the middle tier', () => {
    // Provisional = 28,000 + 12,000 = 40,000; 50% of the 8,000 excess = 4,000.
    expect(taxableSocialSecurity(24_000, 28_000, 'mfj')).toBeCloseTo(4_000, 2);
  });

  it('caps at 85% of the benefit for high provisional income', () => {
    expect(taxableSocialSecurity(40_000, 200_000, 'mfj')).toBeCloseTo(34_000, 2);
  });

  it('returns zero when there is no benefit', () => {
    expect(taxableSocialSecurity(0, 100_000, 'mfj')).toBe(0);
  });
});

describe('computeTaxes', () => {
  const base = {
    ordinaryIncome: 0,
    longTermGains: 0,
    socialSecurityBenefit: 0,
    pretaxDeferrals: 0,
    wages: 0,
    selfEmployment: 0,
    filingStatus: 'mfj' as const,
    stateCode: 'WA',
    table,
  };

  it('owes nothing when income is under the standard deduction', () => {
    const result = computeTaxes({ ...base, ordinaryIncome: 30_000 });
    expect(result.federal).toBe(0);
  });

  it('subtracts pre-tax deferrals before applying brackets', () => {
    const without = computeTaxes({ ...base, ordinaryIncome: 200_000, wages: 200_000 });
    const withDeferral = computeTaxes({
      ...base,
      ordinaryIncome: 200_000,
      wages: 200_000,
      pretaxDeferrals: 24_500,
    });
    expect(withDeferral.federal).toBeLessThan(without.federal);
    // The deferral lands in the 22% bracket at this income.
    expect(without.federal - withDeferral.federal).toBeCloseTo(24_500 * 0.22, 0);
  });

  it('charges no state tax in Washington', () => {
    const result = computeTaxes({ ...base, ordinaryIncome: 200_000, wages: 200_000 });
    expect(result.state).toBe(0);
  });

  it('stacks capital gains on top of ordinary income', () => {
    // Ordinary income sits below the deduction, so gains get the 0% rate
    // until they clear the 0%-bracket ceiling.
    const result = computeTaxes({ ...base, ordinaryIncome: 20_000, longTermGains: 50_000 });
    expect(result.federal).toBe(0);
  });

  it('taxes gains at 15% once the 0% band is used up', () => {
    const result = computeTaxes({
      ...base,
      ordinaryIncome: 150_000,
      wages: 150_000,
      longTermGains: 50_000,
    });
    // Ordinary taxable = 150,000 - 32,200 = 117,800, already above the
    // 99,200 top of the 0% gains band, so all 50,000 is taxed at 15%.
    const ordinaryOnly = computeTaxes({ ...base, ordinaryIncome: 150_000, wages: 150_000 });
    expect(result.federal - ordinaryOnly.federal).toBeCloseTo(50_000 * 0.15, 0);
  });
});

describe('grossUpWithdrawal', () => {
  const base = {
    ordinaryIncome: 40_000,
    longTermGains: 0,
    socialSecurityBenefit: 0,
    pretaxDeferrals: 0,
    wages: 0,
    selfEmployment: 0,
    filingStatus: 'mfj' as const,
    stateCode: 'WA',
    table,
  };

  it('returns the net amount when the withdrawal is not taxable', () => {
    expect(grossUpWithdrawal(50_000, 0, base)).toBe(50_000);
  });

  it('grosses up enough to cover the tax the withdrawal itself creates', () => {
    const net = 50_000;
    const gross = grossUpWithdrawal(net, 1, base);
    expect(gross).toBeGreaterThan(net);

    // Withdrawing `gross` must leave `net` after the incremental tax.
    const baseTax = computeTaxes(base).total;
    const withTax = computeTaxes({ ...base, ordinaryIncome: base.ordinaryIncome + gross }).total;
    expect(gross - (withTax - baseTax)).toBeCloseTo(net, 0);
  });

  it('returns zero for a non-positive need', () => {
    expect(grossUpWithdrawal(0, 1, base)).toBe(0);
    expect(grossUpWithdrawal(-100, 1, base)).toBe(0);
  });
});
