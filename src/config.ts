import type { PluginConfig, ScoringWeights, ScoringThresholds } from './types.js';
export type { LlmClassifierConfig } from './types.js';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_WEIGHTS: ScoringWeights = {
  length: 0.15,
  code: 0.25,
  question: 0.25,
  keywords: 0.20,
  structure: 0.15,
};

export const DEFAULT_THRESHOLDS: ScoringThresholds = {
  trivial: 0.2,
  standard: 0.5,
  complex: 0.8,
};

export const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  defaultTier: 'standard',
  tiers: {
    trivial: {
      model: 'anthropic/claude-haiku-4-5',
      description: 'Simple acks, greetings, yes/no, short factual',
    },
    standard: {
      model: 'anthropic/claude-sonnet-4-6',
      description: 'Normal conversation, moderate reasoning',
    },
    complex: {
      model: 'anthropic/claude-opus-4-6',
      description: 'Deep analysis, architecture, multi-step reasoning',
    },
    code: {
      model: 'anthropic/claude-sonnet-4-6',
      description: 'Code generation, debugging, refactoring',
    },
  },
  agentOverrides: {},
  excludeAgents: [],
  excludeSessionPatterns: ['cron:*'],
  scoring: {
    shortMessageThreshold: 20,
    weights: { ...DEFAULT_WEIGHTS },
    thresholds: { ...DEFAULT_THRESHOLDS },
  },
  llmClassifier: {
    enabled: false,
    ollamaUrl: 'http://mac-mini.tailcd0984.ts.net:11434',
    model: 'gemma4:e4b',
    timeoutMs: 1500,
    confidentTrivialThreshold: 0.15,
    confidentComplexThreshold: 0.85,
  },
  stats: {
    enabled: true,
    dbPath: join(homedir(), '.openclaw', 'smart-router', 'stats.db'),
    retentionDays: 30,
  },
  experiments: {
    enabled: false,
  },
  dashboard: {
    enabled: true,
  },
};

// Module-level runtime config (mutable by hot-patch).
let runtimeConfig: PluginConfig = structuredClone(DEFAULT_CONFIG);

export function getConfig(): PluginConfig {
  return runtimeConfig;
}

export function setConfig(cfg: PluginConfig): void {
  runtimeConfig = cfg;
}

/** Deep-merge partial config onto runtime config (hot-patch). */
export function patchConfig(partial: unknown): PluginConfig {
  runtimeConfig = deepMerge(runtimeConfig, partial) as PluginConfig;
  return runtimeConfig;
}

/** Initialize runtime config from plugin-provided config, merged over defaults. */
export function initConfig(pluginConfig: unknown): PluginConfig {
  runtimeConfig = deepMerge(structuredClone(DEFAULT_CONFIG), pluginConfig) as PluginConfig;
  return runtimeConfig;
}

// ---------- deep merge ----------

type PlainObject = Record<string, unknown>;

function isPlainObject(v: unknown): v is PlainObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function deepMerge(target: unknown, source: unknown): unknown {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return source !== undefined ? source : target;
  }
  const result: PlainObject = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    if (srcVal === undefined) continue;
    const tgtVal = target[key];
    if (isPlainObject(tgtVal) && isPlainObject(srcVal)) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}
