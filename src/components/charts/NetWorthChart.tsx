import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Box, Text } from '@mantine/core';
import type { ProjectionResult } from '../../types/plan';
import { CHART_COLORS } from '../../theme';
import { formatCompact } from '../../lib/format';
import { ChartTooltip } from './ChartTooltip';

/**
 * The stack, bottom to top.
 *
 * This order is the validated palette order — re-run the palette validator
 * before changing it. Both the `<Area>`s and the legend swatches are derived
 * from this one array so they can't drift apart.
 */
const SERIES = [
  { key: 'pretax', name: 'Pre-tax', color: CHART_COLORS.pretax },
  { key: 'roth', name: 'Roth / HSA', color: CHART_COLORS.roth },
  { key: 'taxable', name: 'Taxable & cash', color: CHART_COLORS.taxable },
  { key: 'education', name: '529', color: CHART_COLORS.education },
  { key: 'property', name: 'Property', color: CHART_COLORS.property },
] as const;

export interface NetWorthChartProps {
  projection: ProjectionResult;
  /** Age the household retires — drawn as a reference line. */
  retirementAge?: number;
  realDollars: boolean;
  height?: number;
}

/**
 * Net worth over time, stacked by tax treatment.
 *
 * Stacked rather than a single line because *where* the money sits determines
 * what it's worth: a pre-tax dollar at 65 isn't a Roth dollar, and a dollar of
 * home equity isn't spendable at all without moving house. The composition is
 * the point.
 *
 * Series order matches the validated palette order — see `index.css`.
 */
export function NetWorthChart({
  projection,
  retirementAge,
  realDollars,
  height = 340,
}: NetWorthChartProps) {
  const data = useMemo(
    () =>
      projection.rows.map((row) => ({
        age: row.primaryAge,
        year: row.year,
        pretax: Math.round(row.balancesByBucket.pretax),
        roth: Math.round(row.balancesByBucket.roth),
        taxable: Math.round(row.balancesByBucket.taxable),
        education: Math.round(row.balancesByBucket.tax_free_edu),
        property: Math.round(row.otherAssetValue),
        debt: Math.round(row.debtBalance),
      })),
    [projection],
  );

  const depletionAge = useMemo(() => {
    if (!projection.depletionYear) return undefined;
    return projection.rows.find((r) => r.year === projection.depletionYear)?.primaryAge;
  }, [projection]);

  return (
    <Box>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--fc-grid)" vertical={false} />
          <XAxis
            dataKey="age"
            // ~50 years of data: label every fifth so the axis stays readable.
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

          <Tooltip
            content={
              <ChartTooltip
                showTotal
                labelFormatter={(age) => {
                  const row = data.find((d) => d.age === age);
                  return `Age ${age}${row ? ` · ${row.year}` : ''}`;
                }}
              />
            }
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            iconType="square"
            iconSize={9}
            // The swatch must come from `fill`, not `stroke` — the stroke is
            // deliberately the surface color to cut a 2px gap between stacked
            // bands, which would otherwise render every swatch invisible.
            payload={SERIES.map((s) => ({
              value: s.name,
              type: 'square' as const,
              id: s.key,
              color: s.color,
            }))}
            // Recharts colors legend labels with the series color by default.
            // The swatch carries identity; the text wears text ink.
            formatter={(value: string) => (
              <span style={{ color: 'var(--mantine-color-text)' }}>{value}</span>
            )}
          />

          {SERIES.map((series) => (
            <Area
              key={series.key}
              type="monotone"
              dataKey={series.key}
              name={series.name}
              stackId="nw"
              // Surface-colored stroke = the 2px gap between stacked bands.
              stroke="var(--mantine-color-body)"
              strokeWidth={2}
              fill={series.color}
              fillOpacity={0.9}
              isAnimationActive={false}
            />
          ))}

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

          {depletionAge !== undefined && (
            <ReferenceLine
              x={depletionAge}
              stroke={CHART_COLORS.debt}
              strokeWidth={2}
              label={{
                value: `Runs out at ${depletionAge}`,
                position: 'insideTopRight',
                fontSize: 11,
                fill: CHART_COLORS.debt,
              }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>

      <Text size="xs" c="dimmed" ta="right" mt={2}>
        {realDollars ? "Today's dollars" : 'Nominal (future) dollars'} · property shown
        gross; debt is subtracted from net worth but not drawn as a band
      </Text>
    </Box>
  );
}
