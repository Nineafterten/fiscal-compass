import { formatCurrency } from '../../lib/format';
import classes from './ChartTooltip.module.css';

interface Payload {
  name?: string;
  dataKey?: string | number;
  value?: number | string;
  color?: string;
  payload?: Record<string, unknown>;
}

export interface ChartTooltipProps {
  active?: boolean;
  payload?: Payload[];
  label?: string | number;
  /** Render the axis label; defaults to showing it verbatim. */
  labelFormatter?: (label: string | number) => string;
  /** Add a summed total row — useful on stacked charts. */
  showTotal?: boolean;
  /** Hide series whose value rounds to zero, so the tooltip stays readable. */
  hideZero?: boolean;
}

/**
 * A themed replacement for Recharts' default tooltip, which renders its own
 * DOM and so ignores Mantine's color scheme entirely.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  showTotal = false,
  hideZero = true,
}: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const rows = payload.filter((entry) => {
    if (!hideZero) return true;
    const value = typeof entry.value === 'number' ? entry.value : 0;
    return Math.abs(value) >= 0.5;
  });

  if (!rows.length) return null;

  const total = rows.reduce(
    (sum, entry) => sum + (typeof entry.value === 'number' ? entry.value : 0),
    0,
  );

  return (
    <div className={classes.tooltip} role="tooltip">
      <div className={classes.label}>
        {labelFormatter && label !== undefined ? labelFormatter(label) : label}
      </div>

      {rows.map((entry) => (
        <div className={classes.row} key={String(entry.dataKey ?? entry.name)}>
          <span className={classes.name}>
            <span className={classes.swatch} style={{ background: entry.color }} />
            {entry.name}
          </span>
          <span className={classes.amount}>
            {typeof entry.value === 'number' ? formatCurrency(entry.value) : entry.value}
          </span>
        </div>
      ))}

      {showTotal && rows.length > 1 && (
        <div className={`${classes.row} ${classes.total}`}>
          <span className={classes.name}>Total</span>
          <span className={classes.amount}>{formatCurrency(total)}</span>
        </div>
      )}
    </div>
  );
}
