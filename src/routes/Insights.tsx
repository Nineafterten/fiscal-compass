import { useMemo } from 'react';
import {
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconInfoCircle, IconShieldExclamation } from '@tabler/icons-react';

import { useActivePlan, usePlanAnalysis, useSettings } from '../db/hooks';
import { generateInsights, type InsightSeverity } from '../lib/insights';
import { runAllStress } from '../lib/engine/stress';
import { InsightCard } from '../components/insights/InsightCard';
import { formatCompact, formatPercent } from '../lib/format';

const GROUPS: { severity: InsightSeverity; heading: string; blurb: string }[] = [
  {
    severity: 'critical',
    heading: 'Act on this',
    blurb: 'Gaps large enough to change an outcome, not just a number.',
  },
  {
    severity: 'warning',
    heading: 'Worth attention',
    blurb: 'Real, but not urgent — worth understanding before deciding anything.',
  },
  {
    severity: 'opportunity',
    heading: 'Opportunities',
    blurb: 'Money or tax efficiency currently being left on the table.',
  },
  {
    severity: 'ok',
    heading: 'On track',
    blurb: 'Decisions the numbers support — including the ones that look wrong at a glance.',
  },
];

export function Insights() {
  const { plan } = useActivePlan();
  const settings = useSettings();
  const analysis = usePlanAnalysis(plan, settings?.showRealDollars ?? true);

  const insights = useMemo(() => {
    if (!plan || !analysis) return [];
    return generateInsights({
      plan,
      projection: analysis.nominal,
      metrics: analysis.metrics,
    });
  }, [plan, analysis]);

  const stress = useMemo(() => (plan ? runAllStress(plan) : []), [plan]);

  if (!plan || !analysis) {
    return (
      <Center h={400}>
        <Loader />
      </Center>
    );
  }

  const counts = {
    critical: insights.filter((i) => i.severity === 'critical').length,
    warning: insights.filter((i) => i.severity === 'warning').length,
  };
  const failures = stress.filter((s) => !s.succeeded);

  return (
    <Stack gap="xl">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={2}>Insights</Title>
          <Text size="sm" c="dimmed">
            {insights.length} findings, each with the arithmetic it came from
          </Text>
        </div>
        <Group gap="xs">
          {counts.critical > 0 && (
            <Badge color="red" variant="light" size="lg">
              {counts.critical} to act on
            </Badge>
          )}
          {counts.warning > 0 && (
            <Badge color="yellow" variant="light" size="lg">
              {counts.warning} to look at
            </Badge>
          )}
        </Group>
      </Group>

      <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />}>
        These are observations about arithmetic measured against published rules of thumb,
        not advice. Each card names the guideline it uses and shows the numbers behind it, so
        you can disagree with any of them on the merits. Choosing an actual fund, policy or
        account belongs with an advisor who knows the whole picture.
      </Alert>

      {/* ---- Stress tests --------------------------------------------- */}
      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" align="flex-start" mb="xs" wrap="wrap">
          <div>
            <Title order={4}>Stress tests</Title>
            <Text size="sm" c="dimmed">
              Specific bad things, rather than statistical ones — none of these need to know
              your asset allocation
            </Text>
          </div>
          {failures.length > 0 && (
            <Badge color="red" variant="light">
              {failures.length} of {stress.length} break the plan
            </Badge>
          )}
        </Group>

        <Table highlightOnHover verticalSpacing="sm" fz="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Scenario</Table.Th>
              <Table.Th>What happens</Table.Th>
              <Table.Th ta="right">Outcome</Table.Th>
              <Table.Th ta="right">Ends with (today's $)</Table.Th>
              <Table.Th ta="right">vs baseline</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {stress.map((result) => (
              <Table.Tr key={result.scenario.id}>
                <Table.Td>
                  <Tooltip
                    label={result.scenario.rationale}
                    multiline
                    w={340}
                    withArrow
                    position="right"
                  >
                    <Text fw={600} size="sm" style={{ cursor: 'help' }}>
                      {result.scenario.name}
                    </Text>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed">
                    {result.scenario.description}
                  </Text>
                </Table.Td>
                <Table.Td ta="right">
                  {result.succeeded ? (
                    <Text size="sm" c="teal" fw={600}>
                      survives
                    </Text>
                  ) : (
                    <Text size="sm" c="red" fw={700}>
                      runs out at {result.depletionAge}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td ta="right" className="numeric">
                  {formatCompact(result.finalNetWorthToday)}
                </Table.Td>
                <Table.Td ta="right" className="numeric">
                  <Text
                    size="sm"
                    c={result.vsBaseline < -0.5 ? 'red' : result.vsBaseline < -0.2 ? 'yellow.7' : undefined}
                  >
                    {formatPercent(result.vsBaseline, 0)}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>

        <Text size="xs" c="dimmed" mt="sm">
          Hover a scenario name for why that particular shape of bad news matters. Final
          figures are in today's dollars, deflated by each scenario's own prices, so a
          scenario that raises inflation can't look better for inflating the balance.
        </Text>
      </Card>

      {failures.length > 0 && (
        <Alert
          color="red"
          variant="light"
          icon={<IconShieldExclamation size={18} />}
          title={`${failures.length} ${failures.length === 1 ? 'scenario breaks' : 'scenarios break'} the plan`}
        >
          {failures.map((f) => f.scenario.name).join(', ')}. None of these are predictions —
          they are the specific conditions under which this plan stops working, which is
          more useful to know than a single probability.
        </Alert>
      )}

      {/* ---- Findings -------------------------------------------------- */}
      {GROUPS.map((group) => {
        const items = insights.filter((i) => i.severity === group.severity);
        if (!items.length) return null;

        return (
          <Stack gap="sm" key={group.severity}>
            <div>
              <Title order={4}>{group.heading}</Title>
              <Text size="sm" c="dimmed">
                {group.blurb}
              </Text>
            </div>
            {items.map((insight) => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </Stack>
        );
      })}
    </Stack>
  );
}
