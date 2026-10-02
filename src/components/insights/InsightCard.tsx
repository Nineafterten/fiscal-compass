import { Badge, Card, Group, SimpleGrid, Text } from '@mantine/core';
import {
  IconAlertTriangle,
  IconBulb,
  IconCircleCheck,
  IconExclamationCircle,
} from '@tabler/icons-react';
import type { Insight, InsightSeverity } from '../../lib/insights';
import classes from './InsightCard.module.css';

const SEVERITY: Record<
  InsightSeverity,
  { label: string; color: string; icon: typeof IconAlertTriangle }
> = {
  critical: { label: 'Act on this', color: 'red', icon: IconExclamationCircle },
  warning: { label: 'Worth attention', color: 'yellow', icon: IconAlertTriangle },
  opportunity: { label: 'Opportunity', color: 'blue', icon: IconBulb },
  ok: { label: 'On track', color: 'teal', icon: IconCircleCheck },
};

/**
 * One finding, with its arithmetic attached.
 *
 * The metrics grid is the point of the component: a conclusion you can't
 * check is just an opinion, and the whole design here is that you should be
 * able to disagree with any of these on the numbers.
 */
export function InsightCard({ insight }: { insight: Insight }) {
  const meta = SEVERITY[insight.severity];
  const Icon = meta.icon;

  return (
    <Card withBorder radius="md" padding="lg" className={classes[insight.severity]}>
      <Group justify="space-between" wrap="nowrap" align="flex-start" mb="xs" gap="sm">
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Icon size={19} className={classes.icon} />
          <Text fw={700} size="md" lh={1.3}>
            {insight.title}
          </Text>
        </Group>
        <Badge color={meta.color} variant="light" size="sm" style={{ flexShrink: 0 }}>
          {meta.label}
        </Badge>
      </Group>

      <Text size="sm" c="dimmed" mb="md" lh={1.6}>
        {insight.body}
      </Text>

      {insight.metrics.length > 0 && (
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs" mb={insight.action ? 'md' : 0}>
          {insight.metrics.map((metric) => (
            <div key={metric.label} className={classes.metric}>
              <Text size="xs" c="dimmed" lh={1.3}>
                {metric.label}
              </Text>
              <Text fw={700} className="numeric" lh={1.3}>
                {metric.value}
              </Text>
              {metric.benchmark && (
                <Text size="xs" c="dimmed" fs="italic" lh={1.3}>
                  {metric.benchmark}
                </Text>
              )}
            </div>
          ))}
        </SimpleGrid>
      )}

      {insight.action && (
        <Text size="sm" className={classes.action}>
          {insight.action}
        </Text>
      )}

      {insight.ruleOfThumb && (
        <Text size="xs" c="dimmed" fs="italic" mt="sm" lh={1.5}>
          {insight.ruleOfThumb}
        </Text>
      )}
    </Card>
  );
}
