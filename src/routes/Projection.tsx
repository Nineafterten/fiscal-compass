import { useState } from 'react';
import {
  Badge,
  Card,
  Center,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';

import { useActivePlan, usePlanAnalysis, useSettings } from '../db/hooks';
import { formatCurrency, formatPercent } from '../lib/format';
import type { YearRow } from '../types/plan';

type Density = 'every' | 'five';

/**
 * The year-by-year table.
 *
 * Beyond being useful on its own, this is the non-color reading of the same
 * data the charts show — which is what discharges the contrast relief rule for
 * the lighter series in the palette, and what lets someone check a number
 * rather than estimate it off an axis.
 */
export function Projection() {
  const { plan } = useActivePlan();
  const settings = useSettings();
  const analysis = usePlanAnalysis(plan, settings?.showRealDollars ?? true);
  const [density, setDensity] = useState<Density>('five');

  if (!plan || !analysis) {
    return (
      <Center h={400}>
        <Loader />
      </Center>
    );
  }

  const rows = analysis.projection.rows.filter(
    (row, index) =>
      density === 'every' ||
      index === 0 ||
      row.primaryAge % 5 === 0 ||
      row.shortfall ||
      row.retired !== analysis.projection.rows[index - 1]?.retired,
  );

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={2}>Year by year</Title>
          <Text size="sm" c="dimmed">
            {settings?.showRealDollars
              ? "Today's purchasing power"
              : 'Nominal (future) dollars'}{' '}
            · every figure the projection produced
          </Text>
        </div>
        <SegmentedControl
          size="xs"
          value={density}
          onChange={(v) => setDensity(v as Density)}
          data={[
            { label: 'Milestones', value: 'five' },
            { label: 'Every year', value: 'every' },
          ]}
        />
      </Group>

      <Card withBorder padding={0} radius="md">
        <ScrollArea>
          <Table stickyHeader highlightOnHover striped withColumnBorders={false} fz="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Year</Table.Th>
                <Table.Th>Age</Table.Th>
                <Table.Th ta="right">Income</Table.Th>
                <Table.Th ta="right">Tax</Table.Th>
                <Table.Th ta="right">Spending</Table.Th>
                <Table.Th ta="right">Saved</Table.Th>
                <Table.Th ta="right">Withdrawn</Table.Th>
                <Table.Th ta="right">Investable</Table.Th>
                <Table.Th ta="right">Debt</Table.Th>
                <Table.Th ta="right">Net worth</Table.Th>
                <Table.Th ta="right">W/D rate</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <ProjectionRow key={row.year} row={row} />
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      </Card>

      <Text size="xs" c="dimmed">
        Spending includes debt payments. &ldquo;Withdrawn&rdquo; includes required minimum
        distributions, which are forced out of pre-tax accounts from age 75 whether the cash
        is needed or not — anything left over is swept into taxable savings.
      </Text>
    </Stack>
  );
}

function ProjectionRow({ row }: { row: YearRow }) {
  return (
    <Table.Tr>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          {row.year}
          {row.shortfall && (
            <Badge size="xs" color="red" variant="light">
              short
            </Badge>
          )}
        </Group>
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          {row.primaryAge}
          {row.retired && (
            <Badge size="xs" variant="light" color="teal">
              ret
            </Badge>
          )}
        </Group>
      </Table.Td>
      <Table.Td ta="right" className="numeric">
        {formatCurrency(row.grossIncome)}
      </Table.Td>
      <Table.Td ta="right" className="numeric">
        {formatCurrency(row.totalTax)}
      </Table.Td>
      <Table.Td ta="right" className="numeric">
        {formatCurrency(row.spending)}
      </Table.Td>
      <Table.Td ta="right" className="numeric">
        {formatCurrency(row.contributions + row.employerMatch)}
      </Table.Td>
      <Table.Td ta="right" className="numeric">
        {formatCurrency(row.withdrawals)}
      </Table.Td>
      <Table.Td ta="right" className="numeric">
        {formatCurrency(row.investableAssets)}
      </Table.Td>
      <Table.Td ta="right" className="numeric">
        {formatCurrency(row.debtBalance)}
      </Table.Td>
      <Table.Td ta="right" className="numeric" fw={600}>
        {formatCurrency(row.netWorth)}
      </Table.Td>
      <Table.Td ta="right" className="numeric">
        {row.withdrawalRate > 0 ? formatPercent(row.withdrawalRate, 1) : '—'}
      </Table.Td>
    </Table.Tr>
  );
}
