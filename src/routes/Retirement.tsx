import { useMemo } from 'react';
import {
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Loader,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconChartHistogram, IconInfoCircle } from '@tabler/icons-react';

import { useActivePlan, usePlanAnalysis, useSettings } from '../db/hooks';
import { useSimulation } from '../lib/useSimulation';
import { earliestAgeMeeting, type PercentileBand } from '../lib/engine/montecarlo';
import { RetirementCurveChart } from '../components/charts/RetirementCurveChart';
import { FanChart } from '../components/charts/FanChart';
import { KpiCard, type KpiTone } from '../components/kpi/KpiCard';
import { formatCompact, formatPercent } from '../lib/format';

function probabilityTone(p: number, threshold: number): KpiTone {
  if (p >= threshold) return 'positive';
  if (p >= threshold - 0.15) return 'caution';
  return 'negative';
}

/** The simulation returns nominal dollars; deflate to match the display mode. */
function deflateBands(
  bands: PercentileBand[],
  inflation: number,
  baseYear: number,
): PercentileBand[] {
  return bands.map((b) => {
    const d = Math.pow(1 + inflation, b.year - baseYear);
    return {
      ...b,
      p10: b.p10 / d,
      p25: b.p25 / d,
      p50: b.p50 / d,
      p75: b.p75 / d,
      p90: b.p90 / d,
    };
  });
}

export function Retirement() {
  const { plan } = useActivePlan();
  const settings = useSettings();
  const showReal = settings?.showRealDollars ?? true;
  const analysis = usePlanAnalysis(plan, showReal);
  const sim = useSimulation(plan);

  const threshold = plan?.assumptions.successThreshold ?? 0.85;
  const plannedAge = plan?.people[0]?.retirementAge;

  const probabilisticAge = useMemo(
    () => (sim.curve ? earliestAgeMeeting(sim.curve, threshold) : undefined),
    [sim.curve, threshold],
  );

  const plannedProbability = useMemo(
    () => sim.curve?.find((p) => p.age === plannedAge)?.probability,
    [sim.curve, plannedAge],
  );

  const bands = useMemo(() => {
    if (!sim.simulation || !plan) return [];
    return showReal
      ? deflateBands(sim.simulation.bands, plan.assumptions.inflation, plan.startYear)
      : sim.simulation.bands;
  }, [sim.simulation, plan, showReal]);

  // Read the end-of-plan figures off the deflated bands rather than the raw
  // simulation, so the cards agree with the chart directly beneath them.
  const finalPercentiles = bands.length ? bands[bands.length - 1] : undefined;

  if (!plan || !analysis) {
    return (
      <Center h={400}>
        <Loader />
      </Center>
    );
  }

  const deterministicAge = analysis.earliestRetirementAge;
  const optimismGap =
    probabilisticAge !== undefined && deterministicAge !== undefined
      ? probabilisticAge - deterministicAge
      : undefined;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={2}>Retirement readiness</Title>
          <Text size="sm" c="dimmed">
            {sim.simulation
              ? `${sim.simulation.runs.toLocaleString()} simulated market histories`
              : 'Running simulation…'}
          </Text>
        </div>
        {sim.status === 'ready' && sim.simulation && (
          <Badge
            size="lg"
            variant="light"
            color={
              sim.simulation.successProbability >= threshold
                ? 'teal'
                : sim.simulation.successProbability >= threshold - 0.15
                  ? 'yellow'
                  : 'red'
            }
          >
            {formatPercent(sim.simulation.successProbability)} succeed at age {plannedAge}
          </Badge>
        )}
      </Group>

      {sim.status === 'running' && (
        <Card withBorder padding="sm" radius="md">
          <Group gap="sm" wrap="nowrap">
            <Loader size="xs" />
            <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
              {sim.stage === 'simulation' ? 'Simulating outcomes' : 'Testing retirement ages'}
            </Text>
            <Progress value={sim.progress * 100} size="sm" style={{ flex: 1 }} animated />
          </Group>
        </Card>
      )}

      {sim.status === 'error' && (
        <Alert color="red" icon={<IconAlertTriangle size={18} />} title="Simulation failed">
          {sim.error}
        </Alert>
      )}

      {/* ---- The finding that matters most ----------------------------- */}
      {optimismGap !== undefined && optimismGap > 0 && (
        <Alert
          color="yellow"
          icon={<IconAlertTriangle size={18} />}
          title={`Averaging returns flatters this plan by ${optimismGap} year${optimismGap === 1 ? '' : 's'}`}
        >
          A single projection using average returns says you could retire at{' '}
          <strong>{deterministicAge}</strong>. Across {sim.simulation?.runs.toLocaleString()}{' '}
          simulated market histories, retiring at {deterministicAge} actually works only{' '}
          <strong>
            {formatPercent(
              sim.curve?.find((p) => p.age === deterministicAge)?.probability ?? 0,
            )}
          </strong>{' '}
          of the time. Age <strong>{probabilisticAge}</strong> is the first that clears your{' '}
          {formatPercent(threshold)} bar.
          <Text size="sm" mt="xs">
            The difference is <em>sequence-of-returns risk</em>: a downturn in the first few
            years of drawing down does far more damage than the same downturn later, because
            you sell into it. An average has no order, so it cannot show this.
          </Text>
        </Alert>
      )}

      {/* ---- KPIs ------------------------------------------------------ */}
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="md">
        <KpiCard
          label={`Retiring at ${plannedAge}`}
          value={plannedProbability !== undefined ? formatPercent(plannedProbability) : '—'}
          tone={
            plannedProbability !== undefined
              ? probabilityTone(plannedProbability, threshold)
              : 'neutral'
          }
          icon={<IconChartHistogram size={15} />}
          detail="of simulated histories fund the whole plan"
          help="Your currently planned retirement age, scored across many market sequences rather than one average path."
        />
        <KpiCard
          label={`Earliest at ${formatPercent(threshold)} confidence`}
          value={probabilisticAge ? `Age ${probabilisticAge}` : '—'}
          tone={probabilisticAge ? 'positive' : 'negative'}
          detail={
            probabilisticAge === undefined
              ? 'No tested age clears the bar'
              : deterministicAge !== undefined
                ? `Average-return model said ${deterministicAge}`
                : undefined
          }
          help="The first retirement age whose success probability clears your threshold. This is the number to plan around — the deterministic one is best treated as a ceiling."
        />
        <KpiCard
          label="Median outcome"
          value={finalPercentiles ? formatCompact(finalPercentiles.p50) : '—'}
          detail={
            finalPercentiles
              ? `Bad case ${formatCompact(finalPercentiles.p10)} · good case ${formatCompact(finalPercentiles.p90)}`
              : undefined
          }
          help={`Investable assets at the end of the plan, in ${
            showReal ? "today's dollars" : 'nominal dollars'
          }. The gap between the bad and good case is the honest measure of how uncertain this is — and it is always wider than people expect.`}
        />
        <KpiCard
          label="If it fails"
          value={
            sim.simulation?.medianDepletionAge
              ? `Age ${Math.round(sim.simulation.medianDepletionAge)}`
              : 'Never'
          }
          tone={sim.simulation?.medianDepletionAge ? 'caution' : 'positive'}
          detail={
            sim.simulation?.earliestDepletionAge
              ? `Earliest failure seen: ${Math.round(sim.simulation.earliestDepletionAge)}`
              : 'No simulated history ran out'
          }
          help="Among the runs that did run out of money, the typical age at which it happened. Knowing when a failure would bite tells you how much warning you'd have."
        />
      </SimpleGrid>

      {/* ---- The curve ------------------------------------------------- */}
      <Card withBorder padding="lg" radius="md">
        <Group justify="space-between" align="flex-start" mb="xs" wrap="wrap">
          <div>
            <Title order={4}>What each extra year of work buys</Title>
            <Text size="sm" c="dimmed">
              Success probability at every candidate retirement age
            </Text>
          </div>
        </Group>
        {sim.curve?.length ? (
          <RetirementCurveChart
            curve={sim.curve}
            threshold={threshold}
            plannedAge={plannedAge}
            earliestAge={probabilisticAge}
            dimmed={sim.stale && sim.status === 'running'}
          />
        ) : (
          <Center h={300}>
            <Loader size="sm" />
          </Center>
        )}
      </Card>

      {/* ---- The fan --------------------------------------------------- */}
      <Card withBorder padding="lg" radius="md">
        <Group justify="space-between" align="flex-start" mb="xs" wrap="wrap">
          <div>
            <Title order={4}>Range of outcomes</Title>
            <Text size="sm" c="dimmed">
              Investable assets across simulated histories, not a forecast
            </Text>
          </div>
        </Group>
        {bands.length ? (
          <FanChart
            bands={bands}
            retirementAge={plannedAge}
            realDollars={showReal}
            dimmed={sim.stale && sim.status === 'running'}
          />
        ) : (
          <Center h={320}>
            <Loader size="sm" />
          </Center>
        )}
      </Card>

      <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />}>
        Returns are drawn from a normal distribution around each account&apos;s expected
        return and volatility, with one shared market shock per year — so risky assets move
        together, which understates diversification and is the conservative direction to be
        wrong in. Real markets have fatter tails than a normal distribution, so treat the
        bad case as optimistic rather than as a floor. The random seed is fixed, so the same
        plan always gives the same answer and two scenarios are compared under identical
        market conditions.
      </Alert>
    </Stack>
  );
}
