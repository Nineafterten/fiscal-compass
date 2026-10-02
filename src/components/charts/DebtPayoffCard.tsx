import { useMemo } from 'react';
import { Card, Group, Stack, Text, ThemeIcon, Timeline, Title } from '@mantine/core';
import { IconCircleCheck, IconPigMoney } from '@tabler/icons-react';
import type { Plan } from '../../types/plan';
import { debtPayoffMilestones } from '../../lib/engine/amortize';
import { formatCurrency } from '../../lib/format';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * When each debt clears and how much monthly cash flow it frees.
 *
 * A payoff isn't only an interest saving — it's the month a committed chunk of
 * cash flow comes back and can go toward savings or breathing room. This makes
 * that liberation visible, with a running total of freed cash flow, rather than
 * leaving it implicit in a declining-balance line.
 */
export function DebtPayoffCard({ plan }: { plan: Plan }) {
  const milestones = useMemo(
    () => debtPayoffMilestones(plan.debts, plan.startYear, plan.startMonth),
    [plan],
  );

  if (!milestones.length) return null;

  const currentAge = plan.people[0]
    ? plan.startYear - Number(plan.people[0].birthMonth.slice(0, 4))
    : undefined;

  let cumulative = 0;
  const rows = milestones.map((m) => {
    cumulative += m.freedMonthly;
    return { ...m, cumulative };
  });

  const totalFreed = cumulative;

  return (
    <Card withBorder padding="lg" radius="md" h="100%">
      <Group justify="space-between" align="flex-start" mb="md" wrap="nowrap">
        <div>
          <Title order={4}>When debts clear</Title>
          <Text size="sm" c="dimmed">
            Each payoff hands its payment back to the budget
          </Text>
        </div>
        <ThemeIcon variant="light" color="teal" size="lg" radius="md">
          <IconPigMoney size={18} />
        </ThemeIcon>
      </Group>

      <Timeline active={-1} bulletSize={22} lineWidth={2}>
        {rows.map((m) => (
          <Timeline.Item
            key={m.debtId}
            bullet={<IconCircleCheck size={13} />}
            title={
              <Group gap={8} justify="space-between" wrap="nowrap">
                <Text size="sm" fw={600}>
                  {m.debtName}
                </Text>
                <Text size="sm" fw={700} c="teal" className="numeric">
                  +{formatCurrency(m.freedMonthly)}/mo
                </Text>
              </Group>
            }
          >
            <Text size="xs" c="dimmed">
              {MONTHS[Math.min(11, Math.max(0, m.month - 1))]} {m.year}
              {currentAge !== undefined && ` · age ${currentAge + (m.year - plan.startYear)}`} ·
              running total {formatCurrency(m.cumulative)}/mo freed
            </Text>
          </Timeline.Item>
        ))}
      </Timeline>

      <Stack gap={2} mt="md">
        <Text size="xs" c="dimmed">
          Freed cash flows into liquid savings first, then investing — the wiggle room a
          payoff is meant to buy. All told, {formatCurrency(totalFreed)}/mo comes back over the
          life of the plan.
        </Text>
      </Stack>
    </Card>
  );
}
