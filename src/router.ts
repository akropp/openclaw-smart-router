import type { ScoringResult, PluginConfig, Tier } from './types.js';
import { getActiveExperiments, assignExperimentVariant } from './experiments.js';
import { applyMomentum } from './momentum.js';

export interface RoutingResult {
  model: string;
  tier: Tier;
  rawTier: Tier;  // tier before momentum adjustment
  experimentId?: string;
  experimentVariant?: string;
}

export function route(
  scoringResult: ScoringResult,
  config: PluginConfig,
  agentId?: string,
  sessionKey?: string,
  prompt?: string,
): RoutingResult {
  const rawTier = scoringResult.tier;

  // Apply session momentum to prevent tier ping-ponging
  const tier = applyMomentum(sessionKey, prompt ?? '', scoringResult);

  // Resolve base model from tier config
  let model = resolveTierModel(tier, config);

  // Apply agent-specific override if present
  if (agentId && config.agentOverrides[agentId]) {
    const agentMap = config.agentOverrides[agentId];
    if (agentMap[tier]) {
      model = agentMap[tier]!;
    }
  }

  // Check for active A/B experiments targeting this tier
  if (config.experiments.enabled) {
    const experiments = getActiveExperiments(tier as Tier);
    if (experiments.length > 0) {
      const experiment = experiments[0]!;
      const variant = assignExperimentVariant(experiment.trafficPct);
      const experimentModel = variant === 'treatment' ? experiment.treatmentModel : experiment.controlModel;
      return {
        model: experimentModel,
        tier,
        rawTier,
        experimentId: experiment.id,
        experimentVariant: variant,
      };
    }
  }

  return { model, tier, rawTier };
}

function resolveTierModel(tier: Tier, config: PluginConfig): string {
  const tierConfig = config.tiers[tier];
  if (tierConfig) return tierConfig.model;
  const defaultTierConfig = config.tiers[config.defaultTier];
  if (defaultTierConfig) return defaultTierConfig.model;
  return 'anthropic/claude-sonnet-4-6';
}
