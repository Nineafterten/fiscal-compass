import { createTheme } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'teal',
  defaultRadius: 'md',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontFamilyMonospace:
    'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  headings: { fontWeight: '700' },
});

/**
 * Chart series colors, read as CSS custom properties so light and dark are
 * defined once in `index.css`.
 *
 * The declaration order here IS the stacking order of the net-worth chart, and
 * that order is what the palette validator signed off on. Reordering the stack
 * without re-validating breaks the colorblind-safety guarantee.
 */
export const CHART_COLORS = {
  pretax: 'var(--fc-series-1)',
  roth: 'var(--fc-series-2)',
  taxable: 'var(--fc-series-3)',
  education: 'var(--fc-series-4)',
  property: 'var(--fc-series-5)',

  /** Reserved status color — debt and outflows only, never a categorical slot. */
  debt: 'var(--fc-series-danger)',
  spending: 'var(--fc-series-danger)',

  income: 'var(--fc-series-1)',
  tax: 'var(--fc-series-4)',
} as const;

/** Tax-bucket display names, used by charts and tables alike. */
export const BUCKET_LABELS: Record<string, string> = {
  pretax: 'Pre-tax (401k / IRA)',
  roth: 'Roth / HSA',
  taxable: 'Taxable & cash',
  tax_free_edu: '529 education',
};
