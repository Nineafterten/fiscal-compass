import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Divider,
  Group,
  Loader,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { Dropzone } from '@mantine/dropzone';
import { notifications } from '@mantine/notifications';
import { Link } from 'react-router-dom';
import {
  IconAlertTriangle,
  IconFileSpreadsheet,
  IconInfoCircle,
  IconUpload,
} from '@tabler/icons-react';

import { useActivePlan } from '../db/hooks';
import {
  detectColumns,
  parseCsv,
  summarize,
  type ColumnMapping,
  type ParsedCsv,
} from '../lib/csvImport';
import { formatCurrency, formatPercent } from '../lib/format';
import type { Expense } from '../types/plan';

type Trailing = '3' | '6' | '12' | 'all';

/** Phased lines (college, the bridge, Medicare) that a spending history can't measure. */
function isPhased(e: Expense): boolean {
  return (
    e.startYear !== undefined ||
    e.endYear !== undefined ||
    e.startAge !== undefined ||
    e.endAge !== undefined ||
    e.onlyIfRetired === true
  );
}

/** Lines kept through an import rather than replaced by it. */
function isPreserved(e: Expense): boolean {
  return isPhased(e) || e.pretaxPayroll === true || e.keepOnImport === true;
}

/** Currently active (not future-phased, not retirement-only). */
function isActiveNow(e: Expense): boolean {
  return !e.startYear && !e.startAge && !e.onlyIfRetired;
}

export function Import() {
  const { plan, updatePlan } = useActivePlan();
  const [parsed, setParsed] = useState<ParsedCsv>();
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [fileName, setFileName] = useState('');
  const [trailing, setTrailing] = useState<Trailing>('12');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Off by default: only the categories you tick are imported. The rest can be
  // rolled into one line via the switch, or left out and managed by hand on the
  // Plan inputs page — your call, not the importer's.
  const [lumpRest, setLumpRest] = useState(false);

  const handleFile = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const text = await file.text();
    const next = parseCsv(text);
    setParsed(next);
    setMapping(detectColumns(next.headers));
    setFileName(file.name);
  }, []);

  const summary = useMemo(() => {
    if (!parsed) return undefined;
    return summarize(parsed, mapping, {
      trailingMonths: trailing === 'all' ? undefined : Number(trailing),
    });
  }, [parsed, mapping, trailing]);

  // Default-select the recurring categories whenever the *set* of categories
  // changes (a new file, or a different column mapping) — but not when only the
  // amounts shift because the trailing window moved, so a hand-tuned selection
  // survives switching between 6 and 12 months.
  const categorySignature = summary
    ? summary.categories.map((c) => c.category).sort().join('|')
    : '';
  useEffect(() => {
    if (!summary) return;
    setSelected(
      new Set(
        summary.categories
          .filter((c) => c.classification === 'recurring')
          .map((c) => c.category),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorySignature]);

  const columnOptions = useMemo(
    () =>
      parsed
        ? [
            { value: '', label: '— none —' },
            ...parsed.headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` })),
          ]
        : [],
    [parsed],
  );

  const setColumn = (key: keyof ColumnMapping, value: string | null) =>
    setMapping((prev) => ({
      ...prev,
      [key]: value === null || value === '' ? undefined : Number(value),
    }));

  const toggle = (category: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });

  const setGroup = (categories: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of categories) {
        if (on) next.add(c);
        else next.delete(c);
      }
      return next;
    });

  // ---- Derived totals ---------------------------------------------------
  const recurring = summary?.categories.filter((c) => c.classification === 'recurring') ?? [];
  const discretionary = summary?.categories.filter((c) => c.classification === 'discretionary') ?? [];

  const selectedMonthly = (summary?.categories ?? [])
    .filter((c) => selected.has(c.category))
    .reduce((s, c) => s + c.monthlyAverage, 0);
  const unselectedMonthly = (summary?.categories ?? [])
    .filter((c) => !selected.has(c.category))
    .reduce((s, c) => s + c.monthlyAverage, 0);

  const preservedActiveMonthly = (plan?.expenses ?? [])
    .filter((e) => isPreserved(e) && isActiveNow(e))
    .reduce((s, e) => s + e.monthlyAmount, 0);

  const appliedMonthly =
    selectedMonthly + (lumpRest ? unselectedMonthly : 0) + preservedActiveMonthly;

  const currentMonthly = (plan?.expenses ?? [])
    .filter(isActiveNow)
    .reduce((s, e) => s + e.monthlyAmount, 0);

  // Excluding the discretionary remainder usually understates real spending —
  // the money is still spent, just not on a fixed schedule.
  const understating = !lumpRest && currentMonthly > 0 && appliedMonthly < currentMonthly * 0.9;

  const applyCategories = () => {
    if (!plan || !summary) return;

    const preserved = plan.expenses.filter(isPreserved);

    const itemized: Expense[] = summary.categories
      .filter((c) => selected.has(c.category) && c.monthlyAverage >= 1)
      .map((c) => ({
        id: `imported-${c.category.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name: c.category,
        category: 'imported',
        monthlyAmount: Math.round(c.monthlyAverage * 100) / 100,
        notes: `Derived from ${c.transactions} transactions across ${summary.monthsCovered} months of ${fileName}.`,
      }));

    const lump: Expense[] =
      lumpRest && unselectedMonthly >= 1
        ? [
            {
              id: 'imported-irregular',
              name: 'Irregular & discretionary (imported)',
              category: 'imported',
              monthlyAmount: Math.round(unselectedMonthly * 100) / 100,
              notes: `The categories you didn't itemize — dining, entertainment, one-offs — kept in the total as a single blended line rather than dropped. Averaged across ${summary.monthsCovered} months of ${fileName}.`,
            },
          ]
        : [];

    updatePlan({ expenses: [...itemized, ...lump, ...preserved] });
    notifications.show({
      title: 'Spending baseline updated',
      message: `${itemized.length} itemized ${itemized.length === 1 ? 'category' : 'categories'}${
        lump.length ? ' + one discretionary line' : ''
      }, ${formatCurrency(appliedMonthly)}/mo total. Phased, pre-tax and escrow lines kept.`,
      color: 'teal',
    });
  };

  if (!plan) {
    return (
      <Center h={400}>
        <Loader />
      </Center>
    );
  }

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Import spending</Title>
        <Text size="sm" c="dimmed">
          Turn your budget history into a spending baseline — on your terms
        </Text>
      </div>

      <Alert variant="light" color="blue" icon={<IconInfoCircle size={16} />}>
        Monthly spending is the most leveraged number in the projection. This reads any budget or
        bank CSV and lets you choose which categories become their own recurring lines — the
        standard bills like electricity, water, internet, groceries and fuel. Everything you
        don&apos;t itemize (a concert, a dentist visit, car repairs) stays in the total as one
        blended line rather than becoming a permanent monthly obligation it never was.{' '}
        <strong>The file is read in your browser and never uploaded.</strong>
      </Alert>

      <Dropzone
        onDrop={(files) => void handleFile(files)}
        accept={['text/csv', 'text/plain', 'application/vnd.ms-excel']}
        maxSize={20 * 1024 * 1024}
      >
        <Group justify="center" gap="md" mih={110} style={{ pointerEvents: 'none' }}>
          <IconUpload size={38} opacity={0.5} />
          <div>
            <Text size="sm" fw={600}>
              Drop a CSV here, or click to choose one
            </Text>
            <Text size="xs" c="dimmed">
              A YNAB register export works directly. So do most bank and card exports.
            </Text>
          </div>
        </Group>
      </Dropzone>

      {parsed && summary && (
        <>
          {/* ---- Column mapping --------------------------------------- */}
          <Card withBorder radius="md" padding="lg">
            <Group justify="space-between" mb="md" wrap="wrap">
              <div>
                <Title order={4}>Columns</Title>
                <Group gap={6} mt={2}>
                  <Badge size="sm" variant="light">
                    <IconFileSpreadsheet size={11} style={{ marginRight: 4 }} />
                    {fileName}
                  </Badge>
                  <Text size="sm" c="dimmed">
                    {parsed.rows.length.toLocaleString()} rows · detected automatically
                  </Text>
                </Group>
              </div>
              <SegmentedControl
                size="xs"
                value={trailing}
                onChange={(v) => setTrailing(v as Trailing)}
                data={[
                  { label: 'Last 3 mo', value: '3' },
                  { label: '6 mo', value: '6' },
                  { label: '12 mo', value: '12' },
                  { label: 'All', value: 'all' },
                ]}
              />
            </Group>

            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
              <Select label="Date" data={columnOptions} value={mapping.date?.toString() ?? ''} onChange={(v) => setColumn('date', v)} />
              <Select label="Category" data={columnOptions} value={mapping.category?.toString() ?? ''} onChange={(v) => setColumn('category', v)} />
              <Select label="Payee" data={columnOptions} value={mapping.payee?.toString() ?? ''} onChange={(v) => setColumn('payee', v)} />
              <Select label="Outflow" data={columnOptions} value={mapping.outflow?.toString() ?? ''} onChange={(v) => setColumn('outflow', v)} />
              <Select label="Inflow" data={columnOptions} value={mapping.inflow?.toString() ?? ''} onChange={(v) => setColumn('inflow', v)} />
              <Select
                label="Amount (signed)"
                description="Only if there is no separate outflow column"
                data={columnOptions}
                value={mapping.amount?.toString() ?? ''}
                onChange={(v) => setColumn('amount', v)}
              />
            </SimpleGrid>
          </Card>

          {summary.warnings.map((warning) => (
            <Alert key={warning} color="yellow" variant="light" icon={<IconAlertTriangle size={16} />}>
              {warning}
            </Alert>
          ))}

          {/* ---- Selection -------------------------------------------- */}
          <Card withBorder radius="md" padding="lg">
            <Group justify="space-between" align="flex-start" mb="xs" wrap="wrap">
              <div>
                <Title order={4}>Choose what becomes a recurring line</Title>
                <Text size="sm" c="dimmed">
                  Recurring bills are pre-selected. Tick anything else you want itemized.
                </Text>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  New baseline
                </Text>
                <Text fw={700} size="xl" className="numeric" lh={1.1}>
                  {formatCurrency(appliedMonthly)}/mo
                </Text>
                <Text size="xs" c={appliedMonthly < currentMonthly * 0.9 ? 'yellow.7' : 'dimmed'}>
                  now {formatCurrency(currentMonthly)}/mo
                </Text>
              </div>
            </Group>

            <Group justify="space-between" mb="sm" wrap="wrap" gap="xs">
              <Switch
                checked={lumpRest}
                onChange={(e) => setLumpRest(e.currentTarget.checked)}
                label="Also add everything I didn't tick as one 'irregular & discretionary' line"
                size="sm"
              />
              <Text size="xs" c="dimmed">
                {formatCurrency(unselectedMonthly)}/mo would be added
              </Text>
            </Group>

            {understating && (
              <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={16} />} mb="sm">
                With the discretionary line off, the new baseline is well below your current
                {' '}{formatCurrency(currentMonthly)}/mo. That money is still being spent — dropping
                it entirely makes the plan look healthier than it is. Leave the switch on unless you
                have a reason not to.
              </Alert>
            )}

            <CategoryGroup
              title="Recurring bills"
              subtitle="Steady monthly obligations — the ones that belong in the baseline"
              rows={recurring}
              selected={selected}
              onToggle={toggle}
              onAll={(on) => setGroup(recurring.map((c) => c.category), on)}
              recommended
            />

            {discretionary.length > 0 && (
              <>
                <Divider my="md" />
                <CategoryGroup
                  title="Discretionary & irregular"
                  subtitle="Lumpy or optional — usually better left in the blended line than itemized"
                  rows={discretionary}
                  selected={selected}
                  onToggle={toggle}
                  onAll={(on) => setGroup(discretionary.map((c) => c.category), on)}
                />
              </>
            )}

            <Group justify="space-between" mt="lg" wrap="wrap" gap="sm">
              <Text size="xs" c="dimmed" style={{ maxWidth: 460 }}>
                Phased lines (college, the healthcare bridge, Medicare), pre-tax payroll and escrow
                are kept automatically. You can fine-tune, add or delete any line afterwards on the{' '}
                <Text component={Link} to="/plan" inherit fw={600} td="underline">
                  Plan inputs
                </Text>{' '}
                page.
              </Text>
              <Button onClick={applyCategories} disabled={appliedMonthly <= 0}>
                Set this as my spending
              </Button>
            </Group>
          </Card>
        </>
      )}
    </Stack>
  );
}

function CategoryGroup({
  title,
  subtitle,
  rows,
  selected,
  onToggle,
  onAll,
  recommended,
}: {
  title: string;
  subtitle: string;
  rows: import('../lib/csvImport').CategorySummary[];
  selected: Set<string>;
  onToggle: (c: string) => void;
  onAll: (on: boolean) => void;
  recommended?: boolean;
}) {
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.category));
  const someOn = rows.some((r) => selected.has(r.category));

  if (!rows.length) return null;

  return (
    <div>
      <Group justify="space-between" mb={4} wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <Checkbox
            checked={allOn}
            indeterminate={someOn && !allOn}
            onChange={() => onAll(!allOn)}
            aria-label={`Toggle all ${title}`}
          />
          <div>
            <Group gap={6}>
              <Text fw={600} size="sm">
                {title}
              </Text>
              {recommended && (
                <Badge size="xs" variant="light" color="teal">
                  recommended
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {subtitle}
            </Text>
          </div>
        </Group>
      </Group>

      <Table fz="sm" verticalSpacing={6}>
        <Table.Tbody>
          {rows.map((c) => (
            <Table.Tr
              key={c.category}
              style={{ cursor: 'pointer' }}
              onClick={() => onToggle(c.category)}
            >
              <Table.Td w={36}>
                <Checkbox
                  checked={selected.has(c.category)}
                  onChange={() => onToggle(c.category)}
                  aria-label={c.category}
                />
              </Table.Td>
              <Table.Td>{c.category}</Table.Td>
              <Table.Td ta="right" className="numeric" fw={600}>
                {formatCurrency(c.monthlyAverage)}/mo
              </Table.Td>
              <Table.Td ta="right" className="numeric" c="dimmed">
                <Tooltip label={`${c.transactions} transactions · ${formatCurrency(c.total)} total`}>
                  <span>{formatPercent(c.share)}</span>
                </Tooltip>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}
