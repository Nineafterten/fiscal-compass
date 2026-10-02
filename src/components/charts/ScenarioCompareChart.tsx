import { useMemo } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Box, Text } from '@mantine/core';
import type { ProjectionResult } from '../../types/plan';
import { formatCompact } from '../../lib/format';
import { ChartTooltip } from './ChartTooltip';

export interface ScenarioSeries {
  id: string;
  name: string;
  color: string;
  projection: ProjectionResult;
}

export interface ScenarioCompareChartProps {
  series: ScenarioSeries[];
  realDollars: boolean;
  height?: number;
}

/**
 * Net worth for several scenarios on one axis.
 *
 * Lines rather than stacked areas: the comparison is between whole plans, so
 * composition would be noise here. Every scenario is simulated against the
 * same fixed random seed, which is what makes the gaps between these lines
 * attributable to the plans rather than to luck.
 */
export function ScenarioCompareChart({
  series,
  realDollars,
  height = 340,
}: ScenarioCompareChartProps) {
  // Merge on age so scenarios with different horizons still line up.
  const data = useMemo(() => {
    const byAge = new Map<number, Record<string, number>>();
    for (const s of series) {
      for (const row of s.projection.rows) {
        const entry = byAge.get(row.primaryAge) ?? { age: row.primaryAge };
        entry[s.id] = Math.round(row.netWorth);
        byAge.set(row.primaryAge, entry);
      }
    }
    return [...byAge.values()].sort((a, b) => a.age - b.age);
  }, [series]);

  const depletionAges = useMemo(
    () =>
      series
        .map((s) => {
          if (!s.projection.depletionYear) return undefined;
          const row = s.projection.rows.find(
            (r) => r.year === s.projection.depletionYear,
          );
          return row ? { id: s.id, name: s.name, age: row.primaryAge, color: s.color } : undefined;
        })
        .filter(Boolean) as { id: string; name: string; age: number; color: string }[],
    [series],
  );

  if (!series.length || !data.length) return null;

  return (
    <Box>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
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

          <Tooltip
            content={<ChartTooltip labelFormatter={(age) => `Age ${age}`} />}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            iconType="line"
            iconSize={12}
            formatter={(value: string) => (
              <span style={{ color: 'var(--mantine-color-text)' }}>{value}</span>
            )}
          />

          {series.map((s) => (
            <Line
              key={s.id}
              type="monotone"
              dataKey={s.id}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}

          {depletionAges.map((d) => (
            <ReferenceLine
              key={d.id}
              x={d.age}
              stroke={d.color}
              strokeDasharray="3 3"
              label={{
                value: `${d.name} runs out`,
                position: 'top',
                fontSize: 10,
                fill: d.color,
              }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <Text size="xs" c="dimmed" ta="right" mt={2}>
        Net worth · {realDollars ? "today's dollars" : 'nominal dollars'}
      </Text>
    </Box>
  );
}
