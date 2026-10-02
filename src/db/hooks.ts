import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Plan, ProjectionResult } from '../types/plan';
import { db, getSettings, savePlan, saveSettings, type AppSettings } from './database';
import { project } from '../lib/engine/project';
import { computeMetrics, solveEarliestRetirementAge, type PlanMetrics } from '../lib/engine/solve';
import { toRealDollars } from '../lib/format';

export function useSettings(): AppSettings | undefined {
  return useLiveQuery(() => getSettings(), []);
}

export function useAllPlans(): Plan[] | undefined {
  return useLiveQuery(() => db.plans.toArray(), []);
}

/** How long to wait after the last edit before writing to IndexedDB. */
const PERSIST_DEBOUNCE_MS = 250;

/**
 * The plan currently being edited, plus a patch helper.
 *
 * Edits are applied to a local draft **synchronously** and only flushed to
 * IndexedDB on a debounce. Persisting on every change instead — and waiting
 * for `useLiveQuery` to echo it back before re-rendering — makes a dragged
 * slider drop most of its intermediate values, because each event reads a
 * plan state that the previous write hasn't returned yet.
 *
 * The draft is the render source of truth; the database is just where it
 * survives a refresh.
 */
export function useActivePlan(): {
  plan: Plan | undefined;
  updatePlan: (patch: Partial<Plan>) => void;
} {
  const settings = useSettings();
  const stored = useLiveQuery(
    async () => {
      if (!settings) return undefined;
      const active = await db.plans.get(settings.activePlanId);
      if (active) return active;
      // The active id can go stale after a delete; fall back to any plan.
      return (await db.plans.toArray())[0];
    },
    [settings?.activePlanId],
  );

  const [draft, setDraft] = useState<Plan | undefined>();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const pendingRef = useRef<Plan>();

  // Adopt the stored plan on first load and whenever a *different* plan
  // becomes active. Deliberately not on every stored change: the echo of our
  // own write would otherwise clobber newer keystrokes.
  useEffect(() => {
    if (stored && draft?.id !== stored.id) setDraft(stored);
  }, [stored, draft?.id]);

  // Flush any pending write on unmount so an edit isn't lost by navigating.
  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      if (pendingRef.current) void savePlan(pendingRef.current);
    },
    [],
  );

  const plan = draft ?? stored;

  const updatePlan = useCallback(
    (patch: Partial<Plan>) => {
      setDraft((current) => {
        const base = current ?? stored;
        if (!base) return current;
        const next = { ...base, ...patch };
        pendingRef.current = next;
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          void savePlan(next);
          pendingRef.current = undefined;
        }, PERSIST_DEBOUNCE_MS);
        return next;
      });
    },
    [stored],
  );

  return { plan, updatePlan };
}

export interface PlanAnalysis {
  /** In whichever dollars the user asked for — real by default. */
  projection: ProjectionResult;
  /** Always nominal; metrics are first-year figures so the two agree there. */
  nominal: ProjectionResult;
  metrics: PlanMetrics;
  earliestRetirementAge?: number;
  infeasible: boolean;
  showingRealDollars: boolean;
}

/**
 * Run the whole analysis for a plan.
 *
 * The deterministic projection is ~50 iterations of plain arithmetic, so this
 * runs synchronously on every slider drag without a worker or a debounce. The
 * Monte Carlo is the part that needs one, and that arrives in Phase 2.
 */
export function usePlanAnalysis(
  plan: Plan | undefined,
  showRealDollars: boolean,
): PlanAnalysis | undefined {
  return useMemo(() => {
    if (!plan) return undefined;

    const nominal = project(plan);
    const metrics = computeMetrics(plan, nominal);
    const solution = solveEarliestRetirementAge(plan);

    // Deflate by the household basket, not official CPI: "today's dollars"
    // should mean what this household's money buys, which is the whole reason
    // the two rates are tracked separately.
    const projection = showRealDollars
      ? toRealDollars(
          nominal,
          plan.assumptions.householdInflation ?? plan.assumptions.inflation,
          plan.startYear,
        )
      : nominal;

    return {
      projection,
      nominal,
      metrics,
      earliestRetirementAge: solution.earliestAge,
      infeasible: solution.infeasible,
      showingRealDollars: showRealDollars,
    };
  }, [plan, showRealDollars]);
}

export async function setRealDollars(value: boolean): Promise<void> {
  await saveSettings({ showRealDollars: value });
}
