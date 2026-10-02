import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN } from '../../data/profiles';
import { project } from './project';
import { retirementAgeCurve, runMonteCarlo } from './montecarlo';

/**
 * Performance guards.
 *
 * The whole interaction model depends on these budgets: the deterministic
 * projection runs synchronously on every slider frame, and the simulation runs
 * in a worker where roughly two seconds is the limit of feeling responsive.
 * Thresholds are set well above the measured figures (0.4ms / 160ms / 1.3s on
 * the development machine) so this fails on a real regression, not on a slow
 * CI box. They run against DEFAULT_PLAN — the real profile when local.ts
 * exists, the sample otherwise — so a fresh clone can run them too.
 */
describe('performance budgets', () => {
  it('projects a full plan fast enough to run on every slider frame', () => {
    const started = performance.now();
    for (let i = 0; i < 50; i++) project(DEFAULT_PLAN);
    const perProjection = (performance.now() - started) / 50;
    expect(perProjection).toBeLessThan(10);
  });

  it('completes a 1,000-run simulation within the worker budget', () => {
    const started = performance.now();
    runMonteCarlo(DEFAULT_PLAN, { runs: 1000 });
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it('builds the full retirement-age curve within the worker budget', () => {
    const started = performance.now();
    retirementAgeCurve(DEFAULT_PLAN, { runs: 300, fromAge: 45, toAge: 72 });
    expect(performance.now() - started).toBeLessThan(8_000);
  });
});
