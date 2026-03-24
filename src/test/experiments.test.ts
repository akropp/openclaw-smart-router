import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assignExperimentVariant } from '../experiments.js';

describe('assignExperimentVariant', () => {
  describe('variant assignment probabilities', () => {
    it('returns "control" or "treatment"', () => {
      const variant = assignExperimentVariant(0.5);
      assert.ok(variant === 'control' || variant === 'treatment');
    });

    it('with trafficPct=0 always returns control', () => {
      for (let i = 0; i < 100; i++) {
        assert.equal(assignExperimentVariant(0), 'control');
      }
    });

    it('with trafficPct=1 always returns treatment', () => {
      for (let i = 0; i < 100; i++) {
        assert.equal(assignExperimentVariant(1), 'treatment');
      }
    });

    it('with trafficPct=0.5 assigns roughly half to treatment', () => {
      let treatment = 0;
      const n = 10000;
      for (let i = 0; i < n; i++) {
        if (assignExperimentVariant(0.5) === 'treatment') treatment++;
      }
      const ratio = treatment / n;
      // Allow ±10% variance from 50%
      assert.ok(ratio > 0.40 && ratio < 0.60, `Expected ~50% treatment, got ${(ratio * 100).toFixed(1)}%`);
    });

    it('with trafficPct=0.2 assigns roughly 20% to treatment', () => {
      let treatment = 0;
      const n = 10000;
      for (let i = 0; i < n; i++) {
        if (assignExperimentVariant(0.2) === 'treatment') treatment++;
      }
      const ratio = treatment / n;
      // Allow ±8% variance from 20%
      assert.ok(ratio > 0.12 && ratio < 0.28, `Expected ~20% treatment, got ${(ratio * 100).toFixed(1)}%`);
    });

    it('with trafficPct=0.1 assigns roughly 10% to treatment', () => {
      let treatment = 0;
      const n = 10000;
      for (let i = 0; i < n; i++) {
        if (assignExperimentVariant(0.1) === 'treatment') treatment++;
      }
      const ratio = treatment / n;
      // Allow ±6% variance from 10%
      assert.ok(ratio > 0.04 && ratio < 0.16, `Expected ~10% treatment, got ${(ratio * 100).toFixed(1)}%`);
    });
  });

  describe('independence', () => {
    it('each call is independent (no session stickiness)', () => {
      // Verify that consecutive calls can produce different results
      const variants = new Set<string>();
      for (let i = 0; i < 50; i++) {
        variants.add(assignExperimentVariant(0.5));
      }
      // With 50 calls at 50% probability, we should see both variants
      assert.ok(variants.has('control'), 'Should see control variant');
      assert.ok(variants.has('treatment'), 'Should see treatment variant');
    });
  });
});
