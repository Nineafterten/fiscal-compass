import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Group,
  Loader,
  Menu,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconCopy,
  IconDotsVertical,
  IconInfoCircle,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

import {
  duplicatePlan,
  removePlan,
  renamePlan,
  reseedFromProfile,
  setActivePlan,
} from '../db/database';
import { useActivePlan, useAllPlans, useSettings } from '../db/hooks';
import { project } from '../lib/engine/project';
import { successProbability } from '../lib/engine/montecarlo';
import { computeMetrics, solveEarliestRetirementAge } from '../lib/engine/solve';
import { toRealDollars } from '../lib/format';
import { formatCompact, formatMonths, formatPercent } from '../lib/format';
import {
  ScenarioCompareChart,
  type ScenarioSeries,
} from '../components/charts/ScenarioCompareChart';
import type { Plan } from '../types/plan';

/**
 * Line colors for the comparison chart, in the validated palette order.
 * Beyond five scenarios, colors would have to repeat — so selection is capped
 * rather than cycling hues, which would make two different plans look alike.
 */
const SERIES_COLORS = [
  'var(--fc-series-1)',
  'var(--fc-series-2)',
  'var(--fc-series-3)',
  'var(--fc-series-4)',
  'var(--fc-series-5)',
];

const MAX_COMPARED = SERIES_COLORS.length;

export function Scenarios() {
  const plans = useAllPlans();
  const { plan: activePlan } = useActivePlan();
  const settings = useSettings();
  const showReal = settings?.showRealDollars ?? true;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renameTarget, setRenameTarget] = useState<Plan | undefined>();
  const [draftName, setDraftName] = useState('');
  const [renameOpen, { open: openRename, close: closeRename }] = useDisclosure(false);

  // Every scenario gets a full projection (~0.4ms) plus a short simulation at
  // its own planned retirement age. 200 runs is coarse — about ±3 points — but
  // it's the difference between comparing plans and comparing single lucky
  // paths, and it keeps the whole table under half a second.
  const rows = useMemo(() => {
    if (!plans) return [];
    return plans.map((p) => {
      const nominal = project(p);
      const metrics = computeMetrics(p, nominal);
      const solution = solveEarliestRetirementAge(p);
      const plannedAge = p.people[0]?.retirementAge;
      return {
        plan: p,
        projection: showReal
          ? toRealDollars(nominal, p.assumptions.inflation, p.startYear)
          : nominal,
        metrics,
        plannedAge,
        probability: successProbability(p, { runs: 200 }),
        earliestAge: solution.earliestAge,
        infeasible: solution.infeasible,
      };
    });
  }, [plans, showReal]);

  const effectiveSelection = useMemo(() => {
    // Default to comparing everything until the user picks.
    if (selected.size > 0) return selected;
    return new Set(rows.slice(0, MAX_COMPARED).map((r) => r.plan.id));
  }, [selected, rows]);

  const series = useMemo<ScenarioSeries[]>(
    () =>
      rows
        .filter((r) => effectiveSelection.has(r.plan.id))
        .slice(0, MAX_COMPARED)
        .map((r, i) => ({
          id: r.plan.id,
          name: r.plan.name,
          color: SERIES_COLORS[i],
          projection: r.projection,
        })),
    [rows, effectiveSelection],
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev.size ? prev : effectiveSelection);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_COMPARED) next.add(id);
      else {
        notifications.show({
          message: `Comparing more than ${MAX_COMPARED} scenarios would mean repeating colors — deselect one first.`,
          color: 'yellow',
        });
        return prev;
      }
      return next;
    });
  };

  const handleDuplicate = async (source: Plan) => {
    const copy = await duplicatePlan(source, `${source.name} (copy)`);
    notifications.show({
      message: `Created “${copy.name}” and switched to it.`,
      color: 'teal',
    });
  };

  const handleReseed = async () => {
    const fresh = await reseedFromProfile();
    notifications.show({
      message: `Reloaded “${fresh.name}” from your profile file.`,
      color: 'teal',
    });
  };

  const handleDelete = async (plan: Plan) => {
    const removed = await removePlan(plan.id);
    if (!removed) {
      notifications.show({
        message: 'This is the only scenario — there has to be one left.',
        color: 'yellow',
      });
    }
  };

  const submitRename = async () => {
    if (renameTarget && draftName.trim()) {
      await renamePlan(renameTarget.id, draftName.trim());
    }
    closeRename();
  };

  if (!plans || !activePlan) {
    return (
      <Center h={400}>
        <Loader />
      </Center>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={2}>Scenarios</Title>
          <Text size="sm" c="dimmed">
            Copy a plan, change one thing, and see what it costs
          </Text>
        </div>
        <Group gap="xs">
          <Tooltip
            label="Overwrite the profile-backed plan with what your local profile file currently says. Saved scenarios are left alone."
            multiline
            w={280}
            withArrow
          >
            <Button
              variant="default"
              leftSection={<IconRefresh size={16} />}
              onClick={() => void handleReseed()}
            >
              Reload from profile
            </Button>
          </Tooltip>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => void handleDuplicate(activePlan)}
          >
            Duplicate current
          </Button>
        </Group>
      </Group>

      <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />}>
        Every scenario is projected against the same fixed random seed, so a difference
        between two lines is a difference between the plans — not between the market
        histories they happened to draw. Good things to try: retiring five years earlier,
        a different Social Security assumption, or a higher inflation rate.
      </Alert>

      <Card withBorder padding="lg" radius="md">
        <Title order={4} mb="xs">
          Net worth by scenario
        </Title>
        <ScenarioCompareChart series={series} realDollars={showReal} />
      </Card>

      <Card withBorder padding={0} radius="md">
        <Table highlightOnHover verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={44} />
              <Table.Th>Scenario</Table.Th>
              <Table.Th ta="right">Retires at</Table.Th>
              <Table.Th ta="right">Succeeds</Table.Th>
              <Table.Th ta="right">Earliest (avg returns)</Table.Th>
              <Table.Th ta="right">Savings rate</Table.Th>
              <Table.Th ta="right">Emergency fund</Table.Th>
              <Table.Th ta="right">Ends with</Table.Th>
              <Table.Th w={44} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row) => {
              const isActive = row.plan.id === activePlan.id;
              const isCompared = effectiveSelection.has(row.plan.id);
              const colorIndex = series.findIndex((s) => s.id === row.plan.id);

              return (
                <Table.Tr key={row.plan.id}>
                  <Table.Td>
                    <Checkbox
                      checked={isCompared}
                      onChange={() => toggle(row.plan.id)}
                      aria-label={`Compare ${row.plan.name}`}
                      color={colorIndex >= 0 ? undefined : 'gray'}
                      styles={
                        colorIndex >= 0
                          ? { input: { backgroundColor: SERIES_COLORS[colorIndex], borderColor: SERIES_COLORS[colorIndex] } }
                          : undefined
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Text
                        size="sm"
                        fw={isActive ? 700 : 400}
                        style={{ cursor: 'pointer' }}
                        onClick={() => void setActivePlan(row.plan.id)}
                      >
                        {row.plan.name}
                      </Text>
                      {isActive && (
                        <Badge size="xs" variant="light" color="teal">
                          editing
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right" className="numeric">
                    {row.plannedAge ?? '—'}
                  </Table.Td>
                  <Table.Td ta="right" className="numeric">
                    <Text
                      size="sm"
                      fw={700}
                      c={
                        row.probability >= row.plan.assumptions.successThreshold
                          ? 'teal'
                          : row.probability >= row.plan.assumptions.successThreshold - 0.15
                            ? 'yellow.7'
                            : 'red'
                      }
                    >
                      {formatPercent(row.probability)}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" className="numeric">
                    {row.infeasible ? (
                      <Text size="sm" c="red" fw={600}>
                        never
                      </Text>
                    ) : (
                      `Age ${row.earliestAge}`
                    )}
                  </Table.Td>
                  <Table.Td ta="right" className="numeric">
                    {formatPercent(row.metrics.savingsRate, 1)}
                  </Table.Td>
                  <Table.Td ta="right" className="numeric">
                    {formatMonths(row.metrics.emergencyFundMonths)}
                  </Table.Td>
                  <Table.Td ta="right" className="numeric">
                    {formatCompact(row.projection.finalNetWorth)}
                  </Table.Td>
                  <Table.Td>
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon
                          variant="subtle"
                          color="gray"
                          aria-label={`Actions for ${row.plan.name}`}
                        >
                          <IconDotsVertical size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<IconPencil size={14} />}
                          onClick={() => {
                            setRenameTarget(row.plan);
                            setDraftName(row.plan.name);
                            openRename();
                          }}
                        >
                          Rename
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconCopy size={14} />}
                          onClick={() => void handleDuplicate(row.plan)}
                        >
                          Duplicate
                        </Menu.Item>
                        <Menu.Divider />
                        <Menu.Item
                          color="red"
                          leftSection={<IconTrash size={14} />}
                          disabled={rows.length <= 1}
                          onClick={() => void handleDelete(row.plan)}
                        >
                          Delete
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Card>

      <Text size="xs" c="dimmed">
        Click a scenario name to switch to it — the Dashboard, Plan inputs, and Retirement
        pages all follow whichever one you&apos;re editing. Up to {MAX_COMPARED} can be
        charted at once.
      </Text>

      <Modal opened={renameOpen} onClose={closeRename} title="Rename scenario" centered>
        <Stack>
          <TextInput
            label="Name"
            value={draftName}
            onChange={(e) => setDraftName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitRename();
            }}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeRename}>
              Cancel
            </Button>
            <Button onClick={() => void submitRename()}>Save</Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
