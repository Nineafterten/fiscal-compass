/**
 * Profile loading.
 *
 * The app prefers `local.ts` — your real household — and silently falls back to
 * the fictional sample when it isn't there. `local.ts` is gitignored, so a
 * fresh clone of this repo boots on sample data and contains nobody's real
 * finances.
 *
 * `import.meta.glob` is what makes the optional import work: a missing file
 * yields an empty object at build time instead of an unresolved-module error.
 */

import type { Plan } from '../../types/plan';
import { SAMPLE_PLAN } from './sample';

interface LocalProfileModule {
  LOCAL_PLAN?: Plan;
  default?: Plan;
}

const localModules = import.meta.glob<LocalProfileModule>('./local.ts', {
  eager: true,
});

function readLocalPlan(): Plan | undefined {
  for (const mod of Object.values(localModules)) {
    const plan = mod.LOCAL_PLAN ?? mod.default;
    if (plan) return plan;
  }
  return undefined;
}

const localPlan = readLocalPlan();

/** True when a private profile was found and is being used. */
export const HAS_LOCAL_PROFILE = localPlan !== undefined;

/**
 * The plan the app seeds itself with on first run. After that, whatever is in
 * IndexedDB wins — this is only the starting point.
 */
export const DEFAULT_PLAN: Plan = localPlan ?? SAMPLE_PLAN;

export { SAMPLE_PLAN };
