import { nominalRaiseOf, premiumOverCpi } from '../../lib/engine/project';
import { formatPercent } from '../../lib/format';
import type { Income } from '../../types/plan';
import { NumberField } from './NumberField';

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
 * raise is stored as the premium that gives it at the plan's CPI. The field
 * shows the raise to one decimal and, like any {@link NumberField}, saves only a
 * complete number within its limits of -10% to 20%.
 */
export function RaiseInput({ income, cpi, onPatch }: RaiseInputProps) {
  const cpiLinked = income.nominalGrowthRate === undefined;

  return (
    <NumberField
      label="Annual raise"
      description={
        cpiLinked ? `CPI-linked, ${formatPercent(income.realGrowthRate, 1)} real` : 'nominal'
      }
      value={nominalRaiseOf(income, cpi)}
      onSave={(raise) =>
        onPatch(
          cpiLinked
            ? { realGrowthRate: premiumOverCpi(raise, cpi) }
            : { nominalGrowthRate: raise },
        )
      }
      scale={100}
      suffix="%"
      min={MIN_RAISE}
      max={MAX_RAISE}
      step={0.5}
      decimalScale={1}
      size="sm"
    />
  );
}
