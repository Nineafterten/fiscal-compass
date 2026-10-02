import { useCallback } from 'react';
import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconCoin, IconFlag, IconInfoCircle, IconPlus, IconTrash } from '@tabler/icons-react';

import { useActivePlan, usePlanAnalysis, useSettings } from '../db/hooks';
import { RaiseInput } from '../components/inputs/RaiseInput';
import { SliderRow } from '../components/inputs/SliderRow';
import { formatCompact, formatCurrency, formatPercent } from '../lib/format';
import { STATE_TAX_RULES, stateRule } from '../data/taxTables';
import type {
  Account,
  AccountType,
  Assumptions,
  Debt,
  DebtType,
  Expense,
  Income,
  IncomeType,
  Plan,
  Windfall,
} from '../types/plan';

const STATE_OPTIONS = Object.values(STATE_TAX_RULES)
  .map((r) => ({ value: r.code, label: `${r.name} (${r.code})` }))
  .sort((a, b) => a.label.localeCompare(b.label));

/** A short unique id for a newly-added row. */
function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: '401k_traditional', label: '401(k) — traditional' },
  { value: '401k_roth', label: '401(k) — Roth' },
  { value: 'ira_traditional', label: 'IRA — traditional' },
  { value: 'roth_ira', label: 'Roth IRA' },
  { value: 'taxable', label: 'Taxable brokerage' },
  { value: 'hsa', label: 'HSA' },
  { value: '529', label: '529 college' },
  { value: 'hysa', label: 'High-yield savings' },
  { value: 'savings', label: 'Savings' },
  { value: 'checking', label: 'Checking' },
  { value: 'cash', label: 'Cash' },
];

const INCOME_TYPE_OPTIONS: { value: IncomeType; label: string }[] = [
  { value: 'salary', label: 'Salary (W-2)' },
  { value: 'self_employment', label: 'Self-employment' },
  { value: 'pension', label: 'Pension' },
  { value: 'other', label: 'Other' },
];

const DEBT_TYPE_OPTIONS: { value: DebtType; label: string }[] = [
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'auto', label: 'Auto loan' },
  { value: 'student', label: 'Student loan' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'other', label: 'Other' },
];

export function PlanInputs() {
  const { plan, updatePlan } = useActivePlan();
  const settings = useSettings();
  const analysis = usePlanAnalysis(plan, settings?.showRealDollars ?? true);

  const patchAssumptions = useCallback(
    (patch: Partial<Assumptions>) => {
      if (!plan) return;
      void updatePlan({ assumptions: { ...plan.assumptions, ...patch } });
    },
    [plan, updatePlan],
  );

  type ListKey = 'incomes' | 'accounts' | 'expenses' | 'debts' | 'windfalls' | 'people';

  const patchList = useCallback(
    <K extends ListKey>(key: K, id: string, patch: Partial<Plan[K][number]>) => {
      if (!plan) return;
      const next = (plan[key] as { id: string }[]).map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      );
      void updatePlan({ [key]: next } as unknown as Partial<Plan>);
    },
    [plan, updatePlan],
  );

  const addToList = useCallback(
    <K extends ListKey>(key: K, item: Plan[K][number]) => {
      if (!plan) return;
      void updatePlan({ [key]: [...(plan[key] as unknown[]), item] } as unknown as Partial<Plan>);
    },
    [plan, updatePlan],
  );

  const removeFromList = useCallback(
    (key: ListKey, id: string) => {
      if (!plan) return;
      const next = (plan[key] as { id: string }[]).filter((item) => item.id !== id);
      void updatePlan({ [key]: next } as unknown as Partial<Plan>);
    },
    [plan, updatePlan],
  );

  if (!plan || !analysis) {
    return (
      <Center h={400}>
        <Loader />
      </Center>
    );
  }

  const primary = plan.people[0];
  const rule = stateRule(plan.assumptions.stateCode);

  const ownerOptions = [
    ...plan.people.map((p) => ({ value: p.id, label: p.name })),
    { value: 'joint', label: 'Joint' },
  ];
  const defaultOwner = primary?.id ?? 'joint';

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end" wrap="wrap">
        <div>
          <Title order={2}>Plan inputs</Title>
          <Text size="sm" c="dimmed">
            Everything recalculates as you drag. Nothing is saved anywhere but this browser.
          </Text>
        </div>
        <Badge size="lg" variant="light" color={analysis.infeasible ? 'red' : 'teal'}>
          {analysis.infeasible
            ? 'Not fundable'
            : `Earliest retirement: age ${analysis.earliestRetirementAge}`}
        </Badge>
      </Group>

      <Accordion multiple defaultValue={['income', 'people']} variant="separated">
        {/* ---- People ------------------------------------------------- */}
        <Accordion.Item value="people">
          <Accordion.Control icon={<IconFlag size={16} />}>
            <Text fw={600}>Household &amp; retirement timing</Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="lg">
              {plan.people.map((person) => (
                <Card withBorder padding="md" radius="sm" key={person.id}>
                  <Text fw={600} mb="sm">
                    {person.name}{' '}
                    <Text span c="dimmed" fw={400} size="sm">
                      · born {person.birthMonth}
                    </Text>
                  </Text>
                  <Stack gap="md">
                    <SliderRow
                      label="Retirement age"
                      value={person.retirementAge}
                      onChange={(v) => patchList('people', person.id, { retirementAge: v })}
                      min={45}
                      max={75}
                      format={(v) => `${v}`}
                      marks={[
                        { value: 50, label: '50' },
                        { value: 60, label: '60' },
                        { value: 67, label: '67' },
                        { value: 75, label: '75' },
                      ]}
                      help="Retiring before 65 switches on the pre-Medicare healthcare bridge automatically — watch what it does to the projection."
                    />
                    <SliderRow
                      label="Social Security claim age"
                      value={person.ssClaimAge}
                      onChange={(v) => patchList('people', person.id, { ssClaimAge: v })}
                      min={62}
                      max={70}
                      format={(v) => `${v}`}
                      help="Claiming at 62 permanently cuts the benefit ~30%; waiting to 70 raises it ~24% over the full-retirement-age amount."
                    />
                    <NumberInput
                      label="Estimated monthly benefit at full retirement age"
                      description="From your Social Security statement, in today's dollars"
                      value={person.ssMonthlyAtFra ?? 0}
                      onChange={(v) =>
                        patchList('people', person.id, {
                          ssMonthlyAtFra: typeof v === 'number' ? v : 0,
                        })
                      }
                      prefix="$"
                      thousandSeparator=","
                      min={0}
                      step={100}
                    />
                  </Stack>
                </Card>
              ))}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* ---- Income -------------------------------------------------- */}
        <Accordion.Item value="income">
          <Accordion.Control icon={<IconCoin size={16} />}>
            <Text fw={600}>
              Income{' '}
              <Text span c="dimmed" fw={400} size="sm">
                ·{' '}
                {formatCurrency(
                  plan.incomes.reduce((s, i) => s + i.annualGross, 0) / 12,
                )}
                /mo gross across {plan.incomes.length}{' '}
                {plan.incomes.length === 1 ? 'source' : 'sources'}
              </Text>
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              {plan.incomes.length === 0 && (
                <Text size="sm" c="dimmed" ta="center" py="md">
                  No income sources yet. Add your salary and any other earnings below.
                </Text>
              )}
              {plan.incomes.map((income) => (
                <IncomeRow
                  key={income.id}
                  income={income}
                  cpi={plan.assumptions.inflation}
                  ownerOptions={ownerOptions}
                  onPatch={(patch) => patchList('incomes', income.id, patch)}
                  onRemove={() => removeFromList('incomes', income.id)}
                />
              ))}
              <Group justify="space-between" wrap="wrap" gap="xs">
                <Text size="xs" c="dimmed">
                  Salary and self-employment stop at the owner&apos;s retirement age; pensions
                  and &ldquo;other&rdquo; run to the end of the plan.
                </Text>
                <Button
                  variant="light"
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                  onClick={() =>
                    addToList('incomes', {
                      id: newId('income'),
                      name: 'New income',
                      type: 'salary',
                      ownerId: defaultOwner,
                      annualGross: 0,
                      realGrowthRate: 0,
                      nominalGrowthRate: 0.03,
                      subjectToFica: true,
                    })
                  }
                >
                  Add income
                </Button>
              </Group>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* ---- Assumptions -------------------------------------------- */}
        <Accordion.Item value="assumptions">
          <Accordion.Control>
            <Text fw={600}>Assumptions</Text>
          </Accordion.Control>
          <Accordion.Panel>
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
              <Stack gap="md">
                <SliderRow
                  label="Inflation"
                  value={plan.assumptions.inflation}
                  onChange={(v) => patchAssumptions({ inflation: v })}
                  min={0}
                  max={0.06}
                  step={0.0025}
                  format={(v) => formatPercent(v, 2)}
                  help="Long-run average price inflation. Tax brackets and contribution limits are indexed forward at this rate too."
                />
                <SliderRow
                  label="Social Security actually received"
                  value={plan.assumptions.ssHaircut}
                  onChange={(v) => patchAssumptions({ ssHaircut: v })}
                  min={0}
                  max={1}
                  step={0.05}
                  format={(v) => formatPercent(v, 0)}
                  marks={[
                    { value: 0, label: 'None' },
                    { value: 0.75, label: '75%' },
                    { value: 1, label: 'Full' },
                  ]}
                  help="What fraction of scheduled benefits you assume will arrive. The trustees' own projection is roughly 75-80% if nothing changes. Assuming less is a hedge you pay for in extra saving today — drag it and see what it's costing."
                />
                <SliderRow
                  label="Safe withdrawal rate"
                  value={plan.assumptions.safeWithdrawalRate}
                  onChange={(v) => patchAssumptions({ safeWithdrawalRate: v })}
                  min={0.025}
                  max={0.06}
                  step={0.0025}
                  format={(v) => formatPercent(v, 2)}
                  help="Only used for the FI-number headline. The projection itself models actual spending and taxes year by year rather than applying a flat rate."
                />
                <SliderRow
                  label="Emergency fund target"
                  value={plan.assumptions.emergencyFundMonths}
                  onChange={(v) => patchAssumptions({ emergencyFundMonths: v })}
                  min={0}
                  max={12}
                  format={(v) => `${v} months`}
                  help="Surplus cash refills liquid accounts up to this target before anything is invested."
                />
              </Stack>

              <Stack gap="md">
                <SliderRow
                  label="Plan through age"
                  value={plan.assumptions.planEndAge}
                  onChange={(v) => patchAssumptions({ planEndAge: v })}
                  min={80}
                  max={105}
                  format={(v) => `${v}`}
                  help="How long the money has to last. Planning to 95 is common; a couple has a meaningful chance of one partner reaching 95."
                />
                <SliderRow
                  label="Retirement spending drift"
                  value={plan.assumptions.retirementSpendingDrift}
                  onChange={(v) => patchAssumptions({ retirementSpendingDrift: v })}
                  min={-0.02}
                  max={0.01}
                  step={0.0025}
                  format={(v) => `${(v * 100).toFixed(2)}%/yr`}
                  help="Real spending change each year of retirement. Studies find real spending drifts down through the active years before healthcare pushes it back up; 0 disables the effect."
                />
                <Select
                  label="State"
                  description={rule.note ?? `${formatPercent(rule.flatRate, 2)} flat rate applied`}
                  data={STATE_OPTIONS}
                  value={plan.assumptions.stateCode}
                  onChange={(v) => v && patchAssumptions({ stateCode: v })}
                  searchable
                />
                <Select
                  label="Filing status"
                  data={[
                    { value: 'mfj', label: 'Married filing jointly' },
                    { value: 'single', label: 'Single' },
                  ]}
                  value={plan.assumptions.filingStatus}
                  onChange={(v) =>
                    v && patchAssumptions({ filingStatus: v as Assumptions['filingStatus'] })
                  }
                />
              </Stack>
            </SimpleGrid>
          </Accordion.Panel>
        </Accordion.Item>

        {/* ---- Accounts ------------------------------------------------ */}
        <Accordion.Item value="accounts">
          <Accordion.Control>
            <Text fw={600}>
              Accounts{' '}
              <Text span c="dimmed" fw={400} size="sm">
                · {formatCompact(plan.accounts.reduce((s, a) => s + a.balance, 0))} total
              </Text>
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              {plan.accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  ownerOptions={ownerOptions}
                  onPatch={(patch) => patchList('accounts', account.id, patch)}
                  onRemove={() => removeFromList('accounts', account.id)}
                />
              ))}
              <Group justify="flex-end">
                <Button
                  variant="light"
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                  onClick={() =>
                    addToList('accounts', {
                      id: newId('acct'),
                      name: 'New account',
                      type: 'taxable',
                      balance: 0,
                      ownerId: defaultOwner,
                      expectedReturn: 0.07,
                      volatility: 0.15,
                      monthlyContribution: 0,
                      costBasisFraction: 0.7,
                    })
                  }
                >
                  Add account
                </Button>
              </Group>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* ---- Expenses ------------------------------------------------ */}
        <Accordion.Item value="expenses">
          <Accordion.Control>
            <Text fw={600}>
              Expenses{' '}
              <Text span c="dimmed" fw={400} size="sm">
                ·{' '}
                {formatCurrency(
                  plan.expenses
                    .filter((e) => e.startYear === undefined && e.startAge === undefined && !e.onlyIfRetired)
                    .reduce((s, e) => s + e.monthlyAmount, 0),
                )}
                /mo today, before debt payments
              </Text>
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              {plan.expenses.map((expense) => (
                <ExpenseRow
                  key={expense.id}
                  expense={expense}
                  onPatch={(patch) => patchList('expenses', expense.id, patch)}
                  onRemove={() => removeFromList('expenses', expense.id)}
                />
              ))}
              <Group justify="flex-end" mt="xs">
                <Button
                  variant="light"
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                  onClick={() =>
                    addToList('expenses', {
                      id: newId('exp'),
                      name: 'New expense',
                      category: 'living',
                      monthlyAmount: 0,
                    })
                  }
                >
                  Add expense
                </Button>
              </Group>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* ---- Debts --------------------------------------------------- */}
        <Accordion.Item value="debts">
          <Accordion.Control>
            <Text fw={600}>
              Debts{' '}
              <Text span c="dimmed" fw={400} size="sm">
                · {formatCompact(plan.debts.reduce((s, d) => s + d.balance, 0))} owed
              </Text>
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              {plan.debts.map((debt) => (
                <DebtRow
                  key={debt.id}
                  debt={debt}
                  startYear={plan.startYear}
                  onPatch={(patch) => patchList('debts', debt.id, patch)}
                  onRemove={() => removeFromList('debts', debt.id)}
                />
              ))}
              <Group justify="flex-end">
                <Button
                  variant="light"
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                  onClick={() =>
                    addToList('debts', {
                      id: newId('debt'),
                      name: 'New debt',
                      type: 'other',
                      balance: 0,
                      apr: 0.05,
                      monthlyPayment: 0,
                      extraMonthlyPayment: 0,
                    })
                  }
                >
                  Add debt
                </Button>
              </Group>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>

        {/* ---- Windfalls ----------------------------------------------- */}
        <Accordion.Item value="windfalls">
          <Accordion.Control>
            <Text fw={600}>
              Windfalls{' '}
              <Text span c="dimmed" fw={400} size="sm">
                · {plan.windfalls.filter((w) => w.included).length} in the baseline
              </Text>
            </Text>
          </Accordion.Control>
          <Accordion.Panel>
            <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />} mb="md">
              Excluded from the baseline on purpose. A plan that only works if an inheritance
              arrives on schedule isn&apos;t a plan — switch them on to see what they would
              accelerate, not to depend on them.
            </Alert>
            <Stack gap="md">
              {plan.windfalls.map((windfall) => (
                <WindfallRow
                  key={windfall.id}
                  windfall={windfall}
                  onPatch={(patch) => patchList('windfalls', windfall.id, patch)}
                  onRemove={() => removeFromList('windfalls', windfall.id)}
                />
              ))}
              <Group justify="flex-end">
                <Button
                  variant="light"
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                  onClick={() =>
                    addToList('windfalls', {
                      id: newId('wf'),
                      name: 'New windfall',
                      amount: 0,
                      expectedYear: plan.startYear + 5,
                      confidence: 0.5,
                      included: false,
                    })
                  }
                >
                  Add windfall
                </Button>
              </Group>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>

      {primary && (
        <Text size="xs" c="dimmed" ta="center">
          Currently modelling retirement at {primary.retirementAge}; the solver says{' '}
          {analysis.infeasible ? 'no age works' : `age ${analysis.earliestRetirementAge} is enough`}.
        </Text>
      )}
    </Stack>
  );
}

function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Tooltip label={`Remove ${label}`} position="left">
      <ActionIcon
        variant="subtle"
        color="red"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
      >
        <IconTrash size={16} />
      </ActionIcon>
    </Tooltip>
  );
}

function IncomeRow({
  income,
  cpi,
  ownerOptions,
  onPatch,
  onRemove,
}: {
  income: Income;
  cpi: number;
  ownerOptions: { value: string; label: string }[];
  onPatch: (patch: Partial<Income>) => void;
  onRemove: () => void;
}) {
  // Salary is naturally annual, supplemental income naturally monthly — so both
  // are editable and kept in sync through the stored annual figure.
  const monthly = Math.round((income.annualGross / 12) * 100) / 100;

  return (
    <Card withBorder padding="md" radius="sm">
      <Group justify="space-between" wrap="nowrap" mb="sm" gap="sm">
        <TextInput
          value={income.name}
          onChange={(e) => onPatch({ name: e.currentTarget.value })}
          size="sm"
          style={{ flex: 1 }}
          aria-label="Income name"
        />
        <RemoveButton label={income.name} onRemove={onRemove} />
      </Group>
      <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="sm">
        <Select
          label="Type"
          data={INCOME_TYPE_OPTIONS}
          value={income.type}
          onChange={(v) => v && onPatch({ type: v as IncomeType, subjectToFica: v === 'salary' || v === 'self_employment' })}
          size="sm"
          allowDeselect={false}
        />
        <Select
          label="Owner"
          data={ownerOptions}
          value={income.ownerId}
          onChange={(v) => v && onPatch({ ownerId: v })}
          size="sm"
          allowDeselect={false}
        />
        <NumberInput
          label="Monthly"
          value={monthly}
          onChange={(v) => onPatch({ annualGross: (typeof v === 'number' ? v : 0) * 12 })}
          prefix="$"
          thousandSeparator=","
          min={0}
          step={100}
          size="sm"
        />
        <NumberInput
          label="Annual"
          value={Math.round(income.annualGross)}
          onChange={(v) => onPatch({ annualGross: typeof v === 'number' ? v : 0 })}
          prefix="$"
          thousandSeparator=","
          min={0}
          step={1000}
          size="sm"
        />
        <RaiseInput income={income} cpi={cpi} onPatch={onPatch} />
      </SimpleGrid>
    </Card>
  );
}

function AccountRow({
  account,
  ownerOptions,
  onPatch,
  onRemove,
}: {
  account: Account;
  ownerOptions: { value: string; label: string }[];
  onPatch: (patch: Partial<Account>) => void;
  onRemove: () => void;
}) {
  return (
    <Card withBorder padding="md" radius="sm">
      <Group justify="space-between" mb="sm" wrap="nowrap" gap="sm">
        <TextInput
          value={account.name}
          onChange={(e) => onPatch({ name: e.currentTarget.value })}
          size="sm"
          style={{ flex: 1 }}
          aria-label="Account name"
        />
        <RemoveButton label={account.name} onRemove={onRemove} />
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
        <Select
          label="Type"
          data={ACCOUNT_TYPE_OPTIONS}
          value={account.type}
          onChange={(v) => v && onPatch({ type: v as AccountType })}
          size="sm"
          allowDeselect={false}
        />
        <Select
          label="Owner"
          data={ownerOptions}
          value={account.ownerId}
          onChange={(v) => v && onPatch({ ownerId: v })}
          size="sm"
          allowDeselect={false}
        />
        <NumberInput
          label="Balance"
          value={account.balance}
          onChange={(v) => onPatch({ balance: typeof v === 'number' ? v : 0 })}
          prefix="$"
          thousandSeparator=","
          min={0}
          step={1000}
          size="sm"
        />
        <NumberInput
          label="Monthly contribution"
          value={account.monthlyContribution}
          onChange={(v) => onPatch({ monthlyContribution: typeof v === 'number' ? v : 0 })}
          prefix="$"
          thousandSeparator=","
          min={0}
          step={25}
          size="sm"
        />
        <NumberInput
          label="Expected return"
          description="before fees"
          value={Number((account.expectedReturn * 100).toFixed(2))}
          onChange={(v) => onPatch({ expectedReturn: (typeof v === 'number' ? v : 0) / 100 })}
          suffix="%"
          min={0}
          max={15}
          step={0.25}
          decimalScale={2}
          size="sm"
        />
        <NumberInput
          label="Annual fee"
          value={Number(((account.annualFee ?? 0) * 100).toFixed(2))}
          onChange={(v) => onPatch({ annualFee: (typeof v === 'number' ? v : 0) / 100 })}
          suffix="%"
          min={0}
          max={5}
          step={0.05}
          decimalScale={2}
          size="sm"
        />
      </SimpleGrid>
    </Card>
  );
}

function ExpenseRow({
  expense,
  onPatch,
  onRemove,
}: {
  expense: Expense;
  onPatch: (patch: Partial<Expense>) => void;
  onRemove: () => void;
}) {
  const phased =
    expense.startYear !== undefined ||
    expense.endYear !== undefined ||
    expense.startAge !== undefined ||
    expense.endAge !== undefined ||
    expense.onlyIfRetired;

  return (
    <Group justify="space-between" wrap="nowrap" gap="sm" align="center">
      <div style={{ flex: 1, minWidth: 0 }}>
        <Group gap={6} wrap="nowrap">
          <TextInput
            value={expense.name}
            onChange={(e) => onPatch({ name: e.currentTarget.value })}
            size="sm"
            variant="unstyled"
            style={{ flex: 1 }}
            aria-label="Expense name"
          />
          {phased && (
            <Badge size="xs" variant="light" color="grape">
              phased
            </Badge>
          )}
          {expense.pretaxPayroll && (
            <Badge size="xs" variant="light" color="teal">
              pre-tax
            </Badge>
          )}
          {expense.keepOnImport && (
            <Badge size="xs" variant="light" color="blue">
              kept on import
            </Badge>
          )}
        </Group>
        {expense.notes && (
          <Text size="xs" c="dimmed" lineClamp={2}>
            {expense.notes}
          </Text>
        )}
      </div>
      <NumberInput
        value={expense.monthlyAmount}
        onChange={(v) => onPatch({ monthlyAmount: typeof v === 'number' ? v : 0 })}
        prefix="$"
        thousandSeparator=","
        min={0}
        step={25}
        size="sm"
        w={130}
        aria-label={`${expense.name} monthly amount`}
      />
      <RemoveButton label={expense.name} onRemove={onRemove} />
    </Group>
  );
}

function WindfallRow({
  windfall,
  onPatch,
  onRemove,
}: {
  windfall: Windfall;
  onPatch: (patch: Partial<Windfall>) => void;
  onRemove: () => void;
}) {
  return (
    <Card withBorder padding="md" radius="sm">
      <Group justify="space-between" wrap="nowrap" mb="sm" gap="sm">
        <TextInput
          value={windfall.name}
          onChange={(e) => onPatch({ name: e.currentTarget.value })}
          size="sm"
          style={{ flex: 1 }}
          aria-label="Windfall name"
        />
        <Switch
          checked={windfall.included}
          onChange={(e) => onPatch({ included: e.currentTarget.checked })}
          label="Include"
          aria-label={`Include ${windfall.name} in the projection`}
        />
        <RemoveButton label={windfall.name} onRemove={onRemove} />
      </Group>
      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="md">
        <NumberInput
          label="Amount"
          value={windfall.amount}
          onChange={(v) => onPatch({ amount: typeof v === 'number' ? v : 0 })}
          prefix="$"
          thousandSeparator=","
          min={0}
          step={5000}
          size="sm"
        />
        <NumberInput
          label="Expected year"
          value={windfall.expectedYear}
          onChange={(v) => onPatch({ expectedYear: typeof v === 'number' ? v : windfall.expectedYear })}
          min={2000}
          max={2100}
          size="sm"
        />
        <NumberInput
          label="Confidence"
          value={Math.round(windfall.confidence * 100)}
          onChange={(v) => onPatch({ confidence: (typeof v === 'number' ? v : 0) / 100 })}
          suffix="%"
          min={0}
          max={100}
          step={5}
          size="sm"
        />
      </SimpleGrid>
    </Card>
  );
}

function DebtRow({
  debt,
  onPatch,
  onRemove,
}: {
  debt: Debt;
  startYear: number;
  onPatch: (patch: Partial<Debt>) => void;
  onRemove: () => void;
}) {
  return (
    <Card withBorder padding="md" radius="sm">
      <Group justify="space-between" wrap="nowrap" mb="sm" gap="sm">
        <TextInput
          value={debt.name}
          onChange={(e) => onPatch({ name: e.currentTarget.value })}
          size="sm"
          style={{ flex: 1 }}
          aria-label="Debt name"
        />
        <Select
          data={DEBT_TYPE_OPTIONS}
          value={debt.type}
          onChange={(v) => v && onPatch({ type: v as DebtType })}
          size="sm"
          w={150}
          allowDeselect={false}
          aria-label="Debt type"
        />
        <RemoveButton label={debt.name} onRemove={onRemove} />
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 4 }} spacing="md">
        <NumberInput
          label="Balance"
          value={debt.balance}
          onChange={(v) => onPatch({ balance: typeof v === 'number' ? v : 0 })}
          prefix="$"
          thousandSeparator=","
          min={0}
          step={1000}
          size="sm"
        />
        <NumberInput
          label="APR"
          value={Number((debt.apr * 100).toFixed(3))}
          onChange={(v) => onPatch({ apr: (typeof v === 'number' ? v : 0) / 100 })}
          suffix="%"
          min={0}
          max={30}
          step={0.125}
          decimalScale={3}
          size="sm"
        />
        <NumberInput
          label="Payment (P&I)"
          value={debt.monthlyPayment}
          onChange={(v) => onPatch({ monthlyPayment: typeof v === 'number' ? v : 0 })}
          prefix="$"
          thousandSeparator=","
          min={0}
          step={25}
          size="sm"
        />
        <NumberInput
          label="Extra principal"
          value={debt.extraMonthlyPayment}
          onChange={(v) => onPatch({ extraMonthlyPayment: typeof v === 'number' ? v : 0 })}
          prefix="$"
          thousandSeparator=","
          min={0}
          step={25}
          size="sm"
        />
      </SimpleGrid>
    </Card>
  );
}
