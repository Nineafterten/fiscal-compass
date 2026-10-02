import {
  Alert,
  Badge,
  Card,
  Center,
  Grid,
  Group,
  Loader,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCalendarStats,
  IconChartHistogram,
  IconCoin,
  IconPigMoney,
  IconShieldCheck,
  IconTargetArrow,
  IconTrendingUp,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';

import { useActivePlan, usePlanAnalysis, useSettings } from '../db/hooks';
import { useSimulation } from '../lib/useSimulation';
import { earliestAgeMeeting } from '../lib/engine/montecarlo';
import { KpiCard, type KpiTone } from '../components/kpi/KpiCard';
import { NetWorthChart } from '../components/charts/NetWorthChart';
import { DebtPayoffCard } from '../components/charts/DebtPayoffCard';
import { formatCompact, formatCurrency, formatMonths, formatPercent } from '../lib/format';

/** Emergency-fund adequacy against the usual 3–6 month guideline. */
function emergencyTone(months: number): KpiTone {
  if (months >= 6) return 'positive';
  if (months >= 3) return 'caution';
  return 'negative';
}

function savingsRateTone(rate: number): KpiTone {
  if (rate >= 0.15) return 'positive';
  if (rate >= 0.1) return 'caution';
  return 'negative';
}

export function Dashboard() {
  const { plan } = useActivePlan();
  const settings = useSettings();
  const analysis = usePlanAnalysis(plan, settings?.showRealDollars ?? true);
  const sim = useSimulation(plan);

  const threshold = plan?.assumptions.successThreshold ?? 0.85;
  // The probabilistic answer is the one worth planning around; the
  // deterministic one assumes average returns every single year and is
  // reliably the more flattering of the two.
  const confidentAge = sim.curve ? earliestAgeMeeting(sim.curve, threshold) : undefined;

  if (!plan || !analysis) {
    return (
      <Center h={400}>
        <Loader />
      </Center>
    );
  }

  const { metrics, projection, earliestRetirementAge, infeasible } = analysis;
  const primary = plan.people[0];
  const plannedAge = primary?.retirementAge ?? 65;

  const headlineAge = confidentAge ?? earliestRetirementAge;
  const yearsEarly = headlineAge ? plannedAge - headlineAge : 0;
  const retirementYear = headlineAge
    ? plan.startYear + (headlineAge - metrics.currentAge)
    : undefined;
  const plannedProbability = sim.curve?.find((p) => p.age === plannedAge)?.probability;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={2}>{plan.name}</Title>
          <Text size="sm" c="dimmed">
            Age {metrics.currentAge} · projected to {plan.assumptions.planEndAge} ·{' '}
            {settings?.showRealDollars ? "today's dollars" : 'nominal dollars'}
          </Text>
        </div>
        <Badge
          size="lg"
          variant="light"
          color={infeasible || (confidentAge === undefined && sim.status === 'ready') ? 'red' : 'teal'}
          leftSection={<IconCalendarStats size={14} />}
        >
          {infeasible
            ? 'Plan does not fund itself'
            : headlineAge
              ? `Earliest retirement: age ${headlineAge}`
              : 'Calculating…'}
        </Badge>
      </Group>

      {infeasible && (
        <Alert
          color="red"
          icon={<IconAlertTriangle size={18} />}
          title="No retirement age funds this plan"
        >
          Even working to 80, projected spending outruns the portfolio. The usual causes
          are a spending figure that's too high, a return assumption that's too low, or
          missing income. Check the inputs on the{' '}
          <Text component={Link} to="/plan" inherit fw={600} td="underline">
            Plan
          </Text>{' '}
          page.
        </Alert>
      )}

      {/* ---- Headline ------------------------------------------------- */}
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4, lg: 7 }} spacing="md">
        <KpiCard
          label="Earliest retirement"
          value={headlineAge ? `Age ${headlineAge}` : sim.status === 'running' ? '…' : '—'}
          tone={
            infeasible || (confidentAge === undefined && sim.status === 'ready')
              ? 'negative'
              : yearsEarly > 0
                ? 'positive'
                : 'neutral'
          }
          icon={<IconCalendarStats size={15} />}
          detail={
            infeasible
              ? 'Not reachable on current inputs'
              : confidentAge === undefined && sim.status === 'ready'
                ? `No age reaches ${formatPercent(threshold)} confidence`
                : retirementYear
                  ? `${retirementYear} · ${
                      yearsEarly > 0
                        ? `${yearsEarly} yr earlier than planned`
                        : yearsEarly < 0
                          ? `${Math.abs(yearsEarly)} yr later than planned`
                          : 'matches your plan'
                    }`
                  : undefined
          }
          help={`The earliest age that clears ${formatPercent(threshold)} confidence across simulated market histories. Shown in preference to the average-return answer (age ${earliestRetirementAge ?? '—'}), which assumes every year returns exactly its average and is reliably the more flattering of the two.`}
        />

        <KpiCard
          label={`Plan succeeds at ${plannedAge}`}
          value={
            plannedProbability !== undefined
              ? formatPercent(plannedProbability)
              : sim.status === 'running'
                ? '…'
                : '—'
          }
          tone={
            plannedProbability === undefined
              ? 'neutral'
              : plannedProbability >= threshold
                ? 'positive'
                : plannedProbability >= threshold - 0.15
                  ? 'caution'
                  : 'negative'
          }
          icon={<IconChartHistogram size={15} />}
          detail={
            sim.simulation
              ? `${sim.simulation.runs.toLocaleString()} simulated histories`
              : 'Simulating…'
          }
          help="How often your currently planned retirement age funds the whole plan, across many sequences of market returns rather than one average path."
        />

        <KpiCard
          label="Net worth"
          value={formatCompact(metrics.netWorth)}
          icon={<IconCoin size={15} />}
          detail={`${formatCompact(metrics.investableAssets)} investable`}
          help="Everything owned minus everything owed. 'Investable' excludes property and the 529, since neither can fund groceries in retirement."
        />

        <KpiCard
          label="FI number"
          value={formatCompact(metrics.fiNumber)}
          icon={<IconTargetArrow size={15} />}
          detail={
            <>
              {formatPercent(metrics.fiProgress)} of the way there
              <Progress
                value={Math.min(100, metrics.fiProgress * 100)}
                size="xs"
                mt={4}
                color="teal"
              />
            </>
          }
          help={`Annual spending divided by your safe withdrawal rate (${formatPercent(
            plan.assumptions.safeWithdrawalRate,
            1,
          )}). A rule of thumb, not a threshold — it ignores Social Security, pensions, and the fact that spending changes over a retirement.`}
        />

        <KpiCard
          label="Emergency fund"
          value={formatMonths(metrics.emergencyFundMonths)}
          tone={emergencyTone(metrics.emergencyFundMonths)}
          icon={<IconShieldCheck size={15} />}
          detail={`${formatCompact(metrics.liquidAssets)} liquid · guideline is 3–6 months`}
          help="Cash and near-cash divided by monthly spending. This is the number that decides whether an ordinary bad month becomes debt, and it matters more on a single income."
        />

        <KpiCard
          label="Savings rate"
          value={formatPercent(metrics.savingsRate, 1)}
          tone={savingsRateTone(metrics.savingsRate)}
          icon={<IconPigMoney size={15} />}
          detail={`${formatCompact(metrics.annualSavings)}/yr incl. employer match`}
          help="Everything going into retirement and investment accounts, including the employer match, as a share of gross income."
        />

        <KpiCard
          label="Coast age"
          value={metrics.coastAge ? `Age ${metrics.coastAge}` : '—'}
          tone={
            metrics.coastAge !== undefined && metrics.coastAge <= metrics.currentAge
              ? 'positive'
              : 'neutral'
          }
          icon={<IconTrendingUp size={15} />}
          detail={
            metrics.coastAge === undefined
              ? 'Contributions are required throughout'
              : metrics.coastAge <= metrics.currentAge
                ? 'Not behind — on average returns'
                : `Contributions needed until ${metrics.coastAge}`
          }
          help="The age at which you could stop contributing entirely and still retire on schedule. Measured on the single averaged path, not across simulated histories — so read it as 'you are not behind', not 'you can stop'. The margin it calls optional is exactly what absorbs a bad decade."
        />
      </SimpleGrid>

      {/* ---- Net worth ------------------------------------------------ */}
      <Card withBorder padding="lg" radius="md">
        <Group justify="space-between" align="flex-start" mb="xs" wrap="wrap">
          <div>
            <Title order={4}>Net worth over time</Title>
            <Text size="sm" c="dimmed">
              Stacked by tax treatment — where money sits decides what it's worth
            </Text>
          </div>
        </Group>
        <NetWorthChart
          projection={projection}
          retirementAge={plannedAge}
          realDollars={settings?.showRealDollars ?? true}
        />
      </Card>

      {/* ---- Debt payoff ---------------------------------------------- */}
      <DebtPayoffCard plan={plan} />

      {/* ---- This year ------------------------------------------------ */}
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder padding="lg" radius="md" h="100%">
            <Title order={4} mb="sm">
              This year
            </Title>
            <CashFlowRows
              rows={[
                ['Gross income', projection.rows[0]?.grossIncome ?? 0, 'in'],
                ['Federal tax', -(projection.rows[0]?.federalTax ?? 0), 'out'],
                ['FICA', -(projection.rows[0]?.ficaTax ?? 0), 'out'],
                ['State tax', -(projection.rows[0]?.stateTax ?? 0), 'out'],
                ['Spending (incl. debt payments)', -(projection.rows[0]?.spending ?? 0), 'out'],
                ['Contributions', -(projection.rows[0]?.contributions ?? 0), 'out'],
                ['Employer match', projection.rows[0]?.employerMatch ?? 0, 'in'],
              ]}
            />
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder padding="lg" radius="md" h="100%">
            <Title order={4} mb="sm">
              Assumptions driving this
            </Title>
            <Stack gap={6}>
              <AssumptionRow label="Inflation" value={formatPercent(plan.assumptions.inflation, 1)} />
              <AssumptionRow
                label="Social Security assumed"
                value={formatPercent(plan.assumptions.ssHaircut, 0)}
                note={
                  plan.assumptions.ssHaircut < 0.6
                    ? 'A deliberately pessimistic view — worth testing against a higher figure'
                    : undefined
                }
              />
              <AssumptionRow
                label="Safe withdrawal rate"
                value={formatPercent(plan.assumptions.safeWithdrawalRate, 1)}
              />
              <AssumptionRow
                label="Withdrawal order"
                value={plan.assumptions.withdrawalOrder.join(' → ')}
              />
              <AssumptionRow label="State" value={plan.assumptions.stateCode} />
              <AssumptionRow
                label="Windfalls in baseline"
                value={
                  plan.windfalls.some((w) => w.included)
                    ? `${plan.windfalls.filter((w) => w.included).length} included`
                    : plan.windfalls.length > 0
                      ? 'Excluded'
                      : 'None'
                }
                note={
                  plan.windfalls.length > 0 && !plan.windfalls.some((w) => w.included)
                    ? 'The plan stands on its own — turn them on to see what they accelerate'
                    : undefined
                }
              />
            </Stack>
            <Text size="xs" c="dimmed" mt="md">
              Adjust any of these on the{' '}
              <Text component={Link} to="/plan" inherit fw={600} td="underline">
                Plan inputs
              </Text>{' '}
              page and every number here moves with it.
            </Text>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

function CashFlowRows({ rows }: { rows: [string, number, 'in' | 'out'][] }) {
  return (
    <Stack gap={6}>
      {rows.map(([label, amount, direction]) => (
        <Group key={label} justify="space-between" wrap="nowrap" gap="md">
          <Text size="sm" c="dimmed">
            {label}
          </Text>
          <Text
            size="sm"
            fw={600}
            className="numeric"
            c={direction === 'in' ? 'teal' : undefined}
          >
            {formatCurrency(amount)}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

function AssumptionRow({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div>
      <Group justify="space-between" wrap="nowrap" gap="md">
        <Text size="sm" c="dimmed">
          {label}
        </Text>
        <Text size="sm" fw={600} className="numeric">
          {value}
        </Text>
      </Group>
      {note && (
        <Text size="xs" c="dimmed" fs="italic" mt={-2}>
          {note}
        </Text>
      )}
    </div>
  );
}
