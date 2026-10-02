import { lazy, Suspense, type ReactNode } from 'react';
import {
  ActionIcon,
  AppShell,
  Burger,
  Center,
  Group,
  Loader,
  NavLink,
  ScrollArea,
  Switch,
  Text,
  Title,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import {
  IconAdjustments,
  IconBulb,
  IconChartHistogram,
  IconCompass,
  IconFileImport,
  IconGitCompare,
  IconLayoutDashboard,
  IconMoon,
  IconSun,
  IconTable,
} from '@tabler/icons-react';

import { setRealDollars, useSettings } from './db/hooks';
import { DisclaimerFooter } from './components/common/DisclaimerFooter';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { SampleBanner } from './components/common/SampleBanner';

// Route screens are code-split so the first paint stays light — Recharts, the
// heaviest dependency, only loads once a chart is actually on screen.
const Dashboard = lazy(() =>
  import('./routes/Dashboard').then((m) => ({ default: m.Dashboard })),
);
const PlanInputs = lazy(() =>
  import('./routes/PlanInputs').then((m) => ({ default: m.PlanInputs })),
);
const Projection = lazy(() =>
  import('./routes/Projection').then((m) => ({ default: m.Projection })),
);
const Retirement = lazy(() =>
  import('./routes/Retirement').then((m) => ({ default: m.Retirement })),
);
const Scenarios = lazy(() =>
  import('./routes/Scenarios').then((m) => ({ default: m.Scenarios })),
);
const Insights = lazy(() =>
  import('./routes/Insights').then((m) => ({ default: m.Insights })),
);
const Import = lazy(() => import('./routes/Import').then((m) => ({ default: m.Import })));

interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: <IconLayoutDashboard size={18} /> },
  { label: 'Insights', to: '/insights', icon: <IconBulb size={18} /> },
  { label: 'Retirement', to: '/retirement', icon: <IconChartHistogram size={18} /> },
  { label: 'Scenarios', to: '/scenarios', icon: <IconGitCompare size={18} /> },
  { label: 'Plan inputs', to: '/plan', icon: <IconAdjustments size={18} /> },
  { label: 'Year by year', to: '/projection', icon: <IconTable size={18} /> },
  { label: 'Import spending', to: '/import', icon: <IconFileImport size={18} /> },
];

function ThemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light', { getInitialValueInEffect: true });
  const isDark = computed === 'dark';
  return (
    <Tooltip label={isDark ? 'Light mode' : 'Dark mode'}>
      <ActionIcon
        variant="default"
        size="lg"
        aria-label="Toggle color scheme"
        onClick={() => setColorScheme(isDark ? 'light' : 'dark')}
      >
        {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
      </ActionIcon>
    </Tooltip>
  );
}

/**
 * Nominal dollars over a 50-year horizon flatter the plan badly, so this
 * defaults to today's purchasing power and stays visible in the header rather
 * than hiding in settings.
 */
function DollarModeToggle() {
  const settings = useSettings();
  const real = settings?.showRealDollars ?? true;
  return (
    <Tooltip
      label={
        real
          ? "Showing today's purchasing power"
          : 'Showing nominal (future) dollars — inflated'
      }
    >
      <Switch
        checked={real}
        onChange={(event) => void setRealDollars(event.currentTarget.checked)}
        size="sm"
        label={
          <Text size="xs" fw={600}>
            {real ? "Today's $" : 'Future $'}
          </Text>
        }
        aria-label="Toggle between today's dollars and nominal dollars"
      />
    </Tooltip>
  );
}

export function App() {
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 230, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <IconCompass size={26} color="var(--mantine-color-teal-5)" />
            <Title order={3} visibleFrom="xs">
              Fiscal Compass
            </Title>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <DollarModeToggle />
            <ThemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <ScrollArea>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              component={Link}
              to={item.to}
              label={item.label}
              leftSection={item.icon}
              active={location.pathname === item.to}
              onClick={close}
            />
          ))}
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        <SampleBanner />
        <ErrorBoundary>
          <Suspense
            fallback={
              <Center h={400}>
                <Loader />
              </Center>
            }
          >
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/retirement" element={<Retirement />} />
              <Route path="/scenarios" element={<Scenarios />} />
              <Route path="/plan" element={<PlanInputs />} />
              <Route path="/projection" element={<Projection />} />
              <Route path="/import" element={<Import />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
        <DisclaimerFooter />
      </AppShell.Main>
    </AppShell>
  );
}
