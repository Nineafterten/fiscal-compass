/**
 * The sample household — entirely fictional.
 *
 * This ships with the repo so the app is usable the moment it's cloned, and so
 * screenshots and demos never contain anyone's real finances. Your own numbers
 * belong in `local.ts`, which is gitignored.
 *
 * The Riveras are deliberately ordinary: two earners in their late thirties,
 * a mortgage, a car loan, a kid heading to college in a decade, and a savings
 * rate that's decent but not heroic.
 */

import type { Plan } from '../../types/plan';

const START_YEAR = new Date().getFullYear();

export const SAMPLE_PLAN: Plan = {
  id: 'sample',
  name: 'Sample household (the Riveras)',
  startYear: START_YEAR,

  people: [
    {
      id: 'p1',
      name: 'Alex Rivera',
      birthMonth: '1986-04',
      retirementAge: 65,
      ssClaimAge: 67,
      ssMonthlyAtFra: 2900,
    },
    {
      id: 'p2',
      name: 'Sam Rivera',
      birthMonth: '1988-09',
      retirementAge: 65,
      ssClaimAge: 67,
      ssMonthlyAtFra: 1500,
    },
  ],

  accounts: [
    {
      id: 'a-401k',
      name: '401(k)',
      type: '401k_traditional',
      balance: 185_000,
      ownerId: 'p1',
      expectedReturn: 0.07,
      volatility: 0.15,
      monthlyContribution: 1_400,
      // Dollar-for-dollar on the first 4% of salary.
      employerMatchRate: 1,
      employerMatchLimitPctOfSalary: 0.04,
    },
    {
      id: 'a-ira',
      name: 'Rollover IRA',
      type: 'ira_traditional',
      balance: 62_000,
      ownerId: 'p2',
      expectedReturn: 0.07,
      volatility: 0.15,
      monthlyContribution: 0,
    },
    {
      id: 'a-roth',
      name: 'Roth IRA',
      type: 'roth_ira',
      balance: 71_000,
      ownerId: 'p1',
      expectedReturn: 0.07,
      volatility: 0.15,
      monthlyContribution: 583,
    },
    {
      id: 'a-brokerage',
      name: 'Taxable brokerage',
      type: 'taxable',
      balance: 24_000,
      ownerId: 'joint',
      expectedReturn: 0.065,
      volatility: 0.14,
      monthlyContribution: 0,
      costBasisFraction: 0.75,
    },
    {
      id: 'a-529',
      name: '529 college fund',
      type: '529',
      balance: 27_000,
      ownerId: 'joint',
      expectedReturn: 0.055,
      volatility: 0.1,
      monthlyContribution: 300,
    },
    {
      id: 'a-hysa',
      name: 'High-yield savings',
      type: 'hysa',
      balance: 22_000,
      ownerId: 'joint',
      expectedReturn: 0.035,
      volatility: 0.01,
      monthlyContribution: 400,
    },
    {
      id: 'a-checking',
      name: 'Checking',
      type: 'checking',
      balance: 4_500,
      ownerId: 'joint',
      expectedReturn: 0,
      volatility: 0,
      monthlyContribution: 0,
    },
  ],

  incomes: [
    {
      id: 'i-salary1',
      name: 'Alex — salary',
      type: 'salary',
      ownerId: 'p1',
      annualGross: 141_500,
      realGrowthRate: 0.01,
      subjectToFica: true,
    },
    {
      id: 'i-salary2',
      name: 'Sam — salary',
      type: 'salary',
      ownerId: 'p2',
      annualGross: 62_000,
      realGrowthRate: 0.01,
      subjectToFica: true,
    },
  ],

  expenses: [
    { id: 'e-escrow', name: 'Property tax & home insurance', category: 'housing', monthlyAmount: 720 },
    { id: 'e-utilities', name: 'Utilities', category: 'housing', monthlyAmount: 390 },
    { id: 'e-groceries', name: 'Groceries', category: 'food', monthlyAmount: 1_150 },
    { id: 'e-dining', name: 'Dining & entertainment', category: 'discretionary', monthlyAmount: 430 },
    { id: 'e-transport', name: 'Fuel & transportation', category: 'transport', monthlyAmount: 330 },
    { id: 'e-insurance', name: 'Auto & umbrella insurance', category: 'insurance', monthlyAmount: 260 },
    {
      id: 'e-health',
      name: 'Health premiums (employer plan)',
      category: 'healthcare',
      monthlyAmount: 480,
      // Employer coverage ends with employment.
      continuesInRetirement: false,
      inflationOverride: 0.045,
    },
    { id: 'e-medical', name: 'Out-of-pocket medical', category: 'healthcare', monthlyAmount: 120, inflationOverride: 0.045 },
    { id: 'e-life', name: 'Life & disability premiums', category: 'insurance', monthlyAmount: 145 },
    { id: 'e-kid', name: 'Child activities & school', category: 'family', monthlyAmount: 280 },
    { id: 'e-subs', name: 'Phone, internet & subscriptions', category: 'discretionary', monthlyAmount: 250 },
    { id: 'e-household', name: 'Household, clothing & misc', category: 'discretionary', monthlyAmount: 520 },
    { id: 'e-irregular', name: 'Irregular & annual expenses', category: 'discretionary', monthlyAmount: 600 },

    // ---- Phased -----------------------------------------------------------
    {
      id: 'e-college',
      name: 'College (in-state, 4 years)',
      category: 'education',
      monthlyAmount: 2_300,
      startYear: START_YEAR + 10,
      endYear: START_YEAR + 13,
      inflationOverride: 0.05,
      notes: 'Drawn from the 529 first; only the shortfall hits cash flow.',
    },
    {
      id: 'e-bridge',
      name: 'Healthcare bridge (retirement → 65)',
      category: 'healthcare',
      monthlyAmount: 1_500,
      onlyIfRetired: true,
      endAge: 65,
      inflationOverride: 0.045,
      notes:
        'Unsubsidized family coverage between the last day of work and Medicare. Appears automatically when retirement is set before 65 — usually the single largest cost of retiring early.',
    },
    {
      id: 'e-medicare',
      name: 'Medicare premiums & supplement',
      category: 'healthcare',
      monthlyAmount: 640,
      startAge: 65,
      inflationOverride: 0.045,
    },
  ],

  debts: [
    {
      id: 'd-mortgage',
      name: 'Mortgage',
      type: 'mortgage',
      balance: 268_000,
      apr: 0.0415,
      monthlyPayment: 1_610,
      extraMonthlyPayment: 0,
      securedByAssetId: 'as-home',
    },
    {
      id: 'd-auto',
      name: 'Auto loan',
      type: 'auto',
      balance: 17_500,
      apr: 0.058,
      monthlyPayment: 540,
      extraMonthlyPayment: 0,
      securedByAssetId: 'as-car',
    },
  ],

  assets: [
    {
      id: 'as-home',
      name: 'Primary residence',
      type: 'real_estate',
      value: 545_000,
      appreciationRate: 0.03,
      excludeFromRetirementAssets: true,
    },
    {
      id: 'as-car',
      name: 'Vehicle',
      type: 'vehicle',
      value: 21_000,
      appreciationRate: -0.12,
      excludeFromRetirementAssets: true,
    },
  ],

  windfalls: [],

  insurance: [
    { id: 'ins-life1', name: 'Term life — Alex', type: 'life', coverageAmount: 750_000, insuredPersonId: 'p1', monthlyPremium: 78 },
    { id: 'ins-life2', name: 'Term life — Sam', type: 'life', coverageAmount: 400_000, insuredPersonId: 'p2', monthlyPremium: 42 },
    { id: 'ins-umbrella', name: 'Umbrella liability', type: 'umbrella', coverageAmount: 1_000_000, insuredPersonId: 'p1', monthlyPremium: 20 },
  ],

  assumptions: {
    inflation: 0.025,
    ssHaircut: 1,
    planEndAge: 95,
    successThreshold: 0.85,
    withdrawalOrder: ['taxable', 'pretax', 'roth'],
    safeWithdrawalRate: 0.04,
    emergencyFundMonths: 6,
    retirementSpendingDrift: 0,
    simulationRuns: 1_000,
    stateCode: 'CO',
    filingStatus: 'mfj',
  },

  updatedAt: new Date().toISOString(),
};
