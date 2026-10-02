import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Box, Text } from '@mantine/core';
import type { PercentileBand } from '../../lib/engine/montecarlo';
import { CHART_COLORS } from '../../theme';
import { formatCompact, formatCurrency } from '../../lib/format';
import classes from './ChartTooltip.module.css';

export interface FanChartProps {
  bands: PercentileBand[];
  retirementAge?: number;
  realDollars: boolean;
  height?: number;
  dimmed?: boolean;
}

/**
 * Recharts stacks areas rather than supporting a floating range, so each band
 * is drawn as an invisible base plus a visible span sitting on top of it.
 */
interface BandRow {
  age: number;
  year: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  outerBase: number; // p10
  outerSpan: number; // p90 - p10
  innerBase: number; // p25
  innerSpan: number; // p75 - p25
}

function FanTooltip({ active, payload }: { active?: boolean; payload?: { payload?: BandRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  return (
    <div className={classes.tooltip} role="tooltip">
      <div className={classes.label}>
        Age {row.age} · {row.year}
      </div>
      <div className={classes.row}>
        <span className={classes.name}>Good case (90th)</span>
        <span className={classes.amount}>{formatCurrency(row.p90)}</span>
      </div>
      <div className={classes.row}>
        <span className={classes.name}>Median</span>
        <span className={classes.amount}>{formatCurrency(row.p50)}</span>
      </div>
      <div className={classes.row}>
        <span className={classes.name}>Bad case (10th)</span>
        <span className={classes.amount}>{formatCurrency(row.p10)}</span>
      </div>
    </div>
  );
}

/**
 * The range of outcomes across simulated market histories.
 *
 * Deliberately shows bands rather than a bundle of individual paths: the
 * spread is the message. A median line on its own reads as a forecast, and the
 * honest content of this chart is how wide the possibilities are — especially
 * how low the bad case runs, since that's the one you have to survive.
 *
 * Recharts stacks areas, so each band is drawn as a transparent base plus a
 * visible span rather than as a true floating range.
 */
export function FanChart({
  bands,
  retirementAge,
  realDollars,
  height = 320,
  dimmed = false,
}: FanChartProps) {
  const data = useMemo<BandRow[]>(
    () =>
      bands.map((b) => ({
        age: b.primaryAge,
        year: b.year,
        p10: b.p10,
        p25: b.p25,
        p50: b.p50,
        p75: b.p75,
        p90: b.p90,
        outerBase: b.p10,
        outerSpan: Math.max(0, b.p90 - b.p10),
        innerBase: b.p25,
        innerSpan: Math.max(0, b.p75 - b.p25),
      })),
    [bands],
  );

  if (!data.length) return null;

  return (
    <Box style={{ opacity: dimmed ? 0.45 : 1, transition: 'opacity 150ms ease' }}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--fc-grid)" vertical={false} />
          <XAxis
            dataKey="age"
            interval={4}
            tick={{ fontSize: 11, fill: 'var(--mantine-color-dimmed)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--fc-grid)' }}
            label={{
              value: 'Age',
              position: 'insideBottomRight',
              offset: -2,
              fontSize: 11,
              fill: 'var(--mantine-color-dimmed)',
            }}
          />
          <YAxis
            tickFormatter={formatCompact}
            tick={{ fontSize: 11, fill: 'var(--mantine-color-dimmed)' }}
            tickLine={false}
            axisLine={false}
            width={58}
          />

          <Tooltip content={<FanTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            iconType="square"
            iconSize={9}
            payload={[
              { value: '10th–90th percentile', type: 'square', id: 'band', color: CHART_COLORS.pretax },
              { value: 'Median', type: 'line', id: 'median', color: CHART_COLORS.pretax },
            ]}
            formatter={(value: string) => (
              <span style={{ color: 'var(--mantine-color-text)' }}>{value}</span>
            )}
          />

          {/* Outer band: 10th–90th. The range you have to be able to live with. */}
          <Area
            type="monotone"
            dataKey="outerBase"
            stackId="outer"
            stroke="none"
            fill="none"
            isAnimationActive={false}
            legendType="none"
          />
          <Area
            type="monotone"
            dataKey="outerSpan"
            stackId="outer"
            stroke="none"
            fill={CHART_COLORS.pretax}
            fillOpacity={0.15}
            isAnimationActive={false}
            legendType="none"
          />

          {/* Inner band: 25th–75th, the likelier half of outcomes. */}
          <Area
            type="monotone"
            dataKey="innerBase"
            stackId="inner"
            stroke="none"
            fill="none"
            isAnimationActive={false}
            legendType="none"
          />
          <Area
            type="monotone"
            dataKey="innerSpan"
            stackId="inner"
            stroke="none"
            fill={CHART_COLORS.pretax}
            fillOpacity={0.25}
            isAnimationActive={false}
            legendType="none"
          />

          <Line
            type="monotone"
            dataKey="p50"
            name="Median"
            stroke={CHART_COLORS.pretax}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            legendType="none"
          />

          <ReferenceLine y={0} stroke={CHART_COLORS.debt} strokeWidth={1} />

          {retirementAge !== undefined && (
            <ReferenceLine
              x={retirementAge}
              stroke="var(--mantine-color-dimmed)"
              strokeDasharray="4 4"
              label={{
                value: `Retire at ${retirementAge}`,
                position: 'insideTopLeft',
                fontSize: 11,
                fill: 'var(--mantine-color-dimmed)',
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <Text size="xs" c="dimmed" ta="right" mt={2}>
        Investable assets · {realDollars ? "today's dollars" : 'nominal dollars'} · the
        spread is the point, not the median
      </Text>
    </Box>
  );
}
