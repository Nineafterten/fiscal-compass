import { Alert, Text } from '@mantine/core';
import { IconUsers } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { HAS_LOCAL_PROFILE } from '../../data/profiles';

/**
 * Shown whenever no private profile is bundled, which covers the public demo
 * and any fresh clone, so the sample's numbers are never mistaken for real ones.
 */
export function SampleBanner() {
  if (HAS_LOCAL_PROFILE) return null;

  return (
    <Alert
      variant="light"
      color="teal"
      icon={<IconUsers size={16} />}
      title="Sample household"
      mb="md"
    >
      The Riveras are fictional, so explore freely. Your changes stay in this browser,
      and{' '}
      <Text component={Link} to="/scenarios" inherit fw={600} td="underline">
        Scenarios
      </Text>{' '}
      → Reload from profile brings the sample back.
    </Alert>
  );
}
