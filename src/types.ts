// Shared types for the smart-router plugin.

export interface ScoringWeights {
  length: number;
  code: number;
  question: number;
  keywords: number;
  structure: number;
}

export interface ScoringThresholds {
  trivial: number;
  standard: number;
  complex: number;
}

export interface ScoringConfig {
  shortMessageThreshold?: number;
  weights?: Partial<ScoringWeights>;
  thresholds?: Partial<ScoringThresholds>;
}

export interface ScoringSignals {
  length: number;
  code: number;
  question: number;
  keywords: number;
  structure: number;
}

export type Tier = 'trivial' | 'standard' | 'complex' | 'code';

export interface ScoringResult {
  score: number;
  signals: ScoringSignals;
  tier: Tier;
}

export interface TierConfig {
  model: string;
  description?: string;
}

export interface StatsConfig {
  enabled: boolean;
  dbPath: string;
  retentionDays: number;
}

export interface ExperimentsConfig {
  enabled: boolean;
}

export interface DashboardConfig {
  enabled: boolean;
}

export interface PluginConfig {
  enabled: boolean;
  defaultTier: Tier;
  tiers: Record<string, TierConfig>;
  agentOverrides: Record<string, Record<string, string>>;
  excludeAgents: string[];
  excludeSessionPatterns: string[];
  scoring: {
    shortMessageThreshold: number;
    weights: ScoringWeights;
    thresholds: ScoringThresholds;
  };
  stats: StatsConfig;
  experiments: ExperimentsConfig;
  dashboard: DashboardConfig;
}

export interface RoutingDecision {
  id?: number;
  timestamp?: string;
  agentId?: string;
  sessionKey?: string;
  promptPreview: string;
  promptLength: number;
  complexityScore: number;
  tier: Tier;
  modelChosen: string;
  modelDefault?: string;
  signals: ScoringSignals;
  experimentId?: string;
  experimentVariant?: string;
}

export interface Experiment {
  id: string;
  name: string;
  description?: string;
  tier: Tier;
  controlModel: string;
  treatmentModel: string;
  trafficPct: number;
  startedAt?: string;
  endedAt?: string;
  status: 'active' | 'paused' | 'completed';
}

export interface StatsQuery {
  period?: '1h' | '6h' | '24h' | '7d' | '30d';
  agent?: string;
  tier?: string;
  limit?: number;
}

export interface StatsResult {
  period: string;
  total: number;
  byTier: Record<string, number>;
  byModel: Record<string, number>;
  byAgent: Record<string, number>;
  avgScore: number;
  scoreDistribution: Record<string, number>;
}
