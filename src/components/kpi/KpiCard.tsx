import { Card, Group, Text, Tooltip } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import classes from './KpiCard.module.css';

export type KpiTone = 'neutral' | 'positive' | 'caution' | 'negative';

export interface KpiCardProps {
  label: string;
  value: string;
  /** Secondary line under the value — the "compared to what" context. */
  detail?: ReactNode;
  tone?: KpiTone;
  /** Longer explanation, shown on the info affordance. */
  help?: string;
  icon?: ReactNode;
}

export function KpiCard({ label, value, detail, tone = 'neutral', help, icon }: KpiCardProps) {
  return (
    <Card withBorder padding="md" radius="md" h="100%">
      <Group gap={6} wrap="nowrap" mb={4}>
        {icon}
        <Text size="xs" c="dimmed" fw={600} tt="uppercase" lh={1.2}>
          {label}
        </Text>
        {help && (
          <Tooltip label={help} multiline w={280} withArrow position="top">
            <IconInfoCircle
              size={14}
              className={classes.info}
              aria-label={`About ${label}`}
              tabIndex={0}
            />
          </Tooltip>
        )}
      </Group>

      <Text className={`${classes.value} ${classes[tone]} numeric`}>{value}</Text>

      {detail && (
        // Rendered as a div, not the default <p>: some callers pass block
        // elements (a Progress bar) in `detail`, which can't nest inside a <p>.
        <Text component="div" size="xs" c="dimmed" mt={4} lh={1.35}>
          {detail}
        </Text>
      )}
    </Card>
  );
}
