import { useState } from 'react';
import { NumberInput } from '@mantine/core';
import { nominalRaiseOf, premiumOverCpi } from '../../lib/engine/project';
import { formatPercent } from '../../lib/format';
import type { Income } from '../../types/plan';

const MIN_RAISE = -10;
const MAX_RAISE = 20;

export interface RaiseInputProps {
  income: Income;
  /** The plan's official inflation, which a CPI-linked raise follows. */
  cpi: number;
  onPatch: (patch: Partial<Income>) => void;
}

/**
 * An income's yearly raise, edited as the nominal figure the projection applies.
 *
 * A raise quoted as a premium over CPI stays CPI-linked when edited: the typed
 * raise is stored as the premium that gives it at the plan's CPI. While the
 * field has focus it keeps the text as typed, to one decimal, and saves only a
 * complete number from -10% to 20%; "", "-" and anything out of range save
 * nothing. Leaving the field shows the saved raise again without trimming or
 * clamping what was typed. The arrow keys and chevrons step within the limits.
 */
export function RaiseInput({ income, cpi, onPatch }: RaiseInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cpiLinked = income.nominalGrowthRate === undefined;
  const saved = Number((nominalRaiseOf(income, cpi) * 100).toFixed(1));

  return (
    <NumberInput
      label="Annual raise"
      description={
        cpiLinked ? `CPI-linked, ${formatPercent(income.realGrowthRate, 1)} real` : 'nominal'
      }
      value={draft ?? saved}
      onValueChange={({ value }, { source }) => {
        // Mantine also reports "increment" and "decrement" here, outside the
        // declared type; only "prop" is a change the user didn't make.
        const kind = source as string;
        if (kind === 'prop') return;
        // A step arrives as "4.0"; show it the way a typed 4 reads.
        setDraft(kind === 'event' ? value : String(Number(value)));
        const pct = value.trim() === '' ? NaN : Number(value);
        if (!Number.isFinite(pct) || pct < MIN_RAISE || pct > MAX_RAISE) return;
        const raise = pct / 100;
        onPatch(
          cpiLinked
            ? { realGrowthRate: premiumOverCpi(raise, cpi) }
            : { nominalGrowthRate: raise },
        );
      }}
      onBlur={() => setDraft(null)}
      suffix="%"
      min={MIN_RAISE}
      max={MAX_RAISE}
      clampBehavior="none"
      trimLeadingZeroesOnBlur={false}
      step={0.5}
      decimalScale={1}
      size="sm"
    />
  );
}
