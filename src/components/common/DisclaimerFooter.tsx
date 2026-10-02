import { Anchor, Group, Text } from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import { HAS_LOCAL_PROFILE } from '../../data/profiles';

/**
 * Persistent, unmissable context.
 *
 * Two things a planning tool owes the person using it: that the projections
 * are arithmetic on assumptions rather than advice, and that the data is
 * staying on their machine.
 */
export function DisclaimerFooter() {
  return (
    <Group gap="xs" justify="center" mt={48} mb="md" px="md" wrap="nowrap" align="flex-start">
      <IconInfoCircle size={14} style={{ marginTop: 2, flexShrink: 0, opacity: 0.5 }} />
      <Text size="xs" c="dimmed" style={{ maxWidth: 680 }}>
        Projections are arithmetic applied to assumptions you control — not financial
        advice, and not a prediction. Tax handling is a planning approximation
        (federal brackets, FICA, Social Security taxation and RMDs; no itemized
        deductions, AMT, NIIT or IRMAA). Rules of thumb are shown with their math so
        you can judge them. Decisions about actual products belong with a licensed
        advisor.{' '}
        <Text span inherit fw={600}>
          All data stays in this browser
        </Text>{' '}
        — no account, no server, no network calls
        {HAS_LOCAL_PROFILE ? ' (currently loaded from your private local profile).' : '.'}{' '}
        <Anchor
          href="https://www.irs.gov/retirement-plans"
          target="_blank"
          rel="noreferrer noopener"
          inherit
        >
          Verify tax figures at irs.gov
        </Anchor>
        .
      </Text>
    </Group>
  );
}
