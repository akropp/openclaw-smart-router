import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { route } from '../router.js';
import type { ScoringResult, PluginConfig } from '../types.js';

// Minimal test config
const BASE_CONFIG: PluginConfig = {
  enabled: true,
  defaultTier: 'standard',
  tiers: {
    trivial: { model: 'anthropic/claude-haiku-4-5' },
    standard: { model: 'anthropic/claude-sonnet-4-6' },
    complex: { model: 'anthropic/claude-opus-4-6' },
    code: { model: 'anthropic/claude-sonnet-4-6' },
  },
  agentOverrides: {},
  excludeAgents: [],
  excludeSessionPatterns: [],
  scoring: {
    shortMessageThreshold: 20,
    weights: { length: 0.15, code: 0.25, question: 0.25, keywords: 0.2, structure: 0.15 },
    thresholds: { trivial: 0.2, standard: 0.5, complex: 0.8 },
  },
  llmClassifier: { enabled: false, ollamaUrl: '', model: '', timeoutMs: 1500, confidentTrivialThreshold: 0.15, confidentComplexThreshold: 0.85 },
  stats: { enabled: false, dbPath: '/tmp/test.db', retentionDays: 30 },
  experiments: { enabled: false },
  dashboard: { enabled: true },
};

function makeScoringResult(tier: ScoringResult['tier'], score = 0.5): ScoringResult {
  return {
    score,
    tier,
    signals: { length: score, code: 0, question: score, keywords: score, structure: 0 },
  };
}

describe('route', () => {
  describe('tier → model mapping', () => {
    it('routes trivial tier to haiku model', () => {
      const result = route(makeScoringResult('trivial', 0.1), BASE_CONFIG);
      assert.equal(result.model, 'anthropic/claude-haiku-4-5');
      assert.equal(result.tier, 'trivial');
    });

    it('routes standard tier to sonnet model', () => {
      const result = route(makeScoringResult('standard', 0.35), BASE_CONFIG);
      assert.equal(result.model, 'anthropic/claude-sonnet-4-6');
      assert.equal(result.tier, 'standard');
    });

    it('routes complex tier to opus model', () => {
      const result = route(makeScoringResult('complex', 0.85), BASE_CONFIG);
      assert.equal(result.model, 'anthropic/claude-opus-4-6');
      assert.equal(result.tier, 'complex');
    });

    it('routes code tier to sonnet model', () => {
      const result = route(makeScoringResult('code', 0.6), BASE_CONFIG);
      assert.equal(result.model, 'anthropic/claude-sonnet-4-6');
      assert.equal(result.tier, 'code');
    });
  });

  describe('agent overrides', () => {
    const configWithOverrides: PluginConfig = {
      ...BASE_CONFIG,
      agentOverrides: {
        monty: { complex: 'openai-codex/gpt-5.4' },
        gilfoyle: { standard: 'anthropic/claude-sonnet-4-6' },
      },
    };

    it('applies agent override for matching tier', () => {
      const result = route(makeScoringResult('complex', 0.9), configWithOverrides, 'monty');
      assert.equal(result.model, 'openai-codex/gpt-5.4');
    });

    it('does not apply agent override for non-matching tier', () => {
      const result = route(makeScoringResult('trivial', 0.1), configWithOverrides, 'monty');
      assert.equal(result.model, 'anthropic/claude-haiku-4-5');
    });

    it('applies correct override for specific agent', () => {
      const result = route(makeScoringResult('standard', 0.4), configWithOverrides, 'gilfoyle');
      assert.equal(result.model, 'anthropic/claude-sonnet-4-6');
    });

    it('does not apply override when agent has no overrides', () => {
      const result = route(makeScoringResult('complex', 0.9), configWithOverrides, 'unknown-agent');
      assert.equal(result.model, 'anthropic/claude-opus-4-6');
    });

    it('does not apply override when no agentId provided', () => {
      const result = route(makeScoringResult('complex', 0.9), configWithOverrides);
      assert.equal(result.model, 'anthropic/claude-opus-4-6');
    });
  });

  describe('fallback behavior', () => {
    it('falls back to defaultTier model when tier config missing', () => {
      const cfgWithoutComplex: PluginConfig = {
        ...BASE_CONFIG,
        tiers: {
          trivial: { model: 'anthropic/claude-haiku-4-5' },
          standard: { model: 'anthropic/claude-sonnet-4-6' },
          // complex and code missing
        },
      };
      const result = route(makeScoringResult('complex', 0.9), cfgWithoutComplex);
      // Should fall back to defaultTier (standard)
      assert.equal(result.model, 'anthropic/claude-sonnet-4-6');
    });

    it('returns hardcoded fallback when defaultTier also missing', () => {
      const cfgEmpty: PluginConfig = {
        ...BASE_CONFIG,
        tiers: {},
        defaultTier: 'standard',
      };
      const result = route(makeScoringResult('trivial', 0.1), cfgEmpty);
      assert.equal(result.model, 'anthropic/claude-sonnet-4-6');
    });
  });

  describe('result structure', () => {
    it('returns tier and model in result', () => {
      const result = route(makeScoringResult('standard', 0.4), BASE_CONFIG);
      assert.ok('model' in result, 'Result should have model');
      assert.ok('tier' in result, 'Result should have tier');
    });

    it('does not include experiment fields when experiments disabled', () => {
      const result = route(makeScoringResult('complex', 0.85), BASE_CONFIG);
      assert.equal(result.experimentId, undefined);
      assert.equal(result.experimentVariant, undefined);
    });
  });
});
