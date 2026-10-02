import { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Box, Text } from '@mantine/core';
import type { RetirementAgePoint } from '../../lib/engine/montecarlo';
import { CHART_COLORS } from '../../theme';
import classes from './ChartTooltip.module.css';

export interface RetirementCurveChartProps {
  curve: RetirementAgePoint[];
  /** Success threshold, drawn as the line the curve has to clear. */
  threshold: number;
  /** The age currently planned for, marked on the curve. */
  plannedAge?: number;
  /** First age clearing the threshold. */
  earliestAge?: number;
  height?: number;
  dimmed?: boolean;
}

interface TooltipEntry {
  payload?: { age: number; probability: number };
}

function CurveTooltip({
  active,
  payload,
  threshold,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  threshold: number;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  const clears = point.probability >= threshold;
  return (
    <div className={classes.tooltip} role="tooltip">
      <div className={classes.label}>Retire at {point.age}</div>
      <div className={classes.row}>
        <span className={classes.name}>Plans that last</span>
        <span className={classes.amount}>{(point.probability * 100).toFixed(0)}%</span>
      </div>
      <div className={classes.row}>
        <span className={classes.name} style={{ fontStyle: 'italic' }}>
          {clears ? 'Clears your threshold' : 'Below your threshold'}
        </span>
      </div>
    </div>
  );
}

/**
 * Success probability against retirement age.
 *
 * The single most useful chart in the app. A lone "you can retire at N" hides
 * whether the tradeoff is a cliff or a gentle slope — and it's usually a slope,
 * which means the real question isn't *when you can* retire but *how much
 * certainty each extra year of work is buying*. That's a question you can only
 * answer by looking at the shape.
 */
export function RetirementCurveChart({
  curve,
  threshold,
  plannedAge,
  earliestAge,
  height = 300,
  dimmed = false,
}: RetirementCurveChartProps) {
  const data = useMemo(
    () => curve.map((p) => ({ age: p.age, probability: p.probability })),
    [curve],
  );

  const earliestPoint = useMemo(
    () => (earliestAge ? data.find((d) => d.age === earliestAge) : undefined),
    [data, earliestAge],
  );

  if (!data.length) return null;

  return (
    <Box style={{ opacity: dimmed ? 0.45 : 1, transition: 'opacity 150ms ease' }}>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 12, right: 16, left: 8, bottom: 4 }}>
          <defs>
            <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.pretax} stopOpacity={0.28} />
              <stop offset="100%" stopColor={CHART_COLORS.pretax} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="var(--fc-grid)" vertical={false} />
          <XAxis
            dataKey="age"
            tick={{ fontSize: 11, fill: 'var(--mantine-color-dimmed)' }}
            tickLine={false}
            axisLine={{ stroke: 'var(--fc-grid)' }}
            label={{
              value: 'Retirement age',
              position: 'insideBottom',
              offset: -2,
              fontSize: 11,
              fill: 'var(--mantine-color-dimmed)',
            }}
          />
          <YAxis
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            tick={{ fontSize: 11, fill: 'var(--mantine-color-dimmed)' }}
            tickLine={false}
            axisLine={false}
            width={44}
          />

          <Tooltip content={<CurveTooltip threshold={threshold} />} />

          <Area
            type="monotone"
            dataKey="probability"
            stroke="none"
            fill="url(#curveFill)"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="probability"
            stroke={CHART_COLORS.pretax}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />

          <ReferenceLine
            y={threshold}
            stroke="var(--mantine-color-dimmed)"
            strokeDasharray="5 4"
            label={{
              value: `${Math.round(threshold * 100)}% target`,
              position: 'insideTopLeft',
              fontSize: 11,
              fill: 'var(--mantine-color-dimmed)',
            }}
          />

          {plannedAge !== undefined && (
            <ReferenceLine
              x={plannedAge}
              stroke="var(--mantine-color-dimmed)"
              strokeDasharray="4 4"
              label={{
                value: `Planned ${plannedAge}`,
                position: 'top',
                fontSize: 11,
                fill: 'var(--mantine-color-dimmed)',
              }}
            />
          )}

          {earliestPoint && (
            <ReferenceDot
              x={earliestPoint.age}
              y={earliestPoint.probability}
              r={5}
              fill={CHART_COLORS.pretax}
              stroke="var(--mantine-color-body)"
              strokeWidth={2}
              isFront
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <Text size="xs" c="dimmed" ta="right" mt={2}>
        Share of simulated market histories in which the money lasts to the end of the plan
      </Text>
    </Box>
  );
}
