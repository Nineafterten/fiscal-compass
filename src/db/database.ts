import Dexie, { type Table } from 'dexie';
import type { Plan } from '../types/plan';
import { DEFAULT_PLAN } from '../data/profiles';

/**
 * IndexedDB schema (via Dexie).
 *
 * Everything lives on this device. There is no account, no server, and no
 * network call anywhere in the app — which is the only responsible default for
 * a file containing someone's account balances.
 *
 * `plans` holds saved scenarios; `settings` is a single row keyed 'app'.
 */

export interface AppSettings {
  id: 'app';
  colorScheme: 'light' | 'dark' | 'auto';
  /** Id of the plan currently being edited. */
  activePlanId: string;
  /** Show figures in today's purchasing power rather than nominal dollars. */
  showRealDollars: boolean;
  /** Set once the first-run seed has happened, so it never re-seeds. */
  seeded: boolean;
}

export class FiscalCompassDB extends Dexie {
  plans!: Table<Plan, string>;
  settings!: Table<AppSettings, string>;

  constructor() {
    super('fiscal-compass');
    this.version(1).stores({
      // Indexed fields only; the whole object is stored regardless.
      plans: 'id, name, updatedAt',
      settings: 'id',
    });
  }
}

export const db = new FiscalCompassDB();

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'app',
  colorScheme: 'auto',
  activePlanId: DEFAULT_PLAN.id,
  showRealDollars: true,
  seeded: false,
};

export async function getSettings(): Promise<AppSettings> {
  const existing = await db.settings.get('app');
  if (existing) return existing;
  await db.settings.put(DEFAULT_SETTINGS);
  return DEFAULT_SETTINGS;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings();
  const next = { ...current, ...patch, id: 'app' as const };
  await db.settings.put(next);
  return next;
}

/**
 * Seed the database on first run from the profile loader — `local.ts` when
 * it's present, the fictional sample otherwise. Runs exactly once; after that
 * whatever is in IndexedDB wins, so edits are never clobbered.
 */
export async function seedIfEmpty(): Promise<void> {
  const settings = await getSettings();
  const count = await db.plans.count();
  if (settings.seeded && count > 0) return;

  if (count === 0) {
    await db.plans.put({ ...DEFAULT_PLAN, updatedAt: new Date().toISOString() });
  }
  await saveSettings({ seeded: true, activePlanId: DEFAULT_PLAN.id });
}

export async function savePlan(plan: Plan): Promise<void> {
  await db.plans.put({ ...plan, updatedAt: new Date().toISOString() });
}

export async function getPlan(id: string): Promise<Plan | undefined> {
  return db.plans.get(id);
}

export async function deletePlan(id: string): Promise<void> {
  await db.plans.delete(id);
}

/** Reset everything and re-seed. Used by Settings → Reset. */
export async function resetToDefaults(): Promise<void> {
  await db.plans.clear();
  await db.settings.clear();
  await seedIfEmpty();
}

/**
 * Copy a plan under a new name and switch to it.
 *
 * This is how scenarios are made: "Baseline" stays untouched while you push
 * "Retire at 60" around, and the two can be compared side by side afterwards.
 */
export async function duplicatePlan(source: Plan, name: string): Promise<Plan> {
  const copy: Plan = {
    ...structuredClone(source),
    id: `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    updatedAt: new Date().toISOString(),
  };
  await db.plans.put(copy);
  await saveSettings({ activePlanId: copy.id });
  return copy;
}

export async function setActivePlan(id: string): Promise<void> {
  await saveSettings({ activePlanId: id });
}

/**
 * Overwrite the profile-backed plan with whatever `local.ts` (or the sample)
 * currently says, and switch to it.
 *
 * Needed because seeding only happens once: after first run the database is
 * the source of truth, so editing the profile file has no visible effect and
 * the app quietly keeps showing older numbers. Saved scenarios are left alone.
 */
export async function reseedFromProfile(): Promise<Plan> {
  const fresh: Plan = { ...DEFAULT_PLAN, updatedAt: new Date().toISOString() };
  await db.plans.put(fresh);
  await saveSettings({ activePlanId: fresh.id });
  return fresh;
}

export async function renamePlan(id: string, name: string): Promise<void> {
  const existing = await db.plans.get(id);
  if (existing) await db.plans.put({ ...existing, name });
}

/**
 * Delete a plan, moving the active pointer if it was the one being edited.
 * Refuses to remove the last remaining plan — the app always needs one.
 */
export async function removePlan(id: string): Promise<boolean> {
  const all = await db.plans.toArray();
  if (all.length <= 1) return false;

  await db.plans.delete(id);
  const settings = await getSettings();
  if (settings.activePlanId === id) {
    const next = all.find((p) => p.id !== id);
    if (next) await saveSettings({ activePlanId: next.id });
  }
  return true;
}
