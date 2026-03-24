import type { ScoringResult, PluginConfig, Tier } from './types.js';
import { getActiveExperiments, assignExperimentVariant } from './experiments.js';

export interface RoutingResult {
  model: string;
  tier: Tier;
  experimentId?: string;
  experimentVariant?: string;
}

export function route(
  scoringResult: ScoringResult,
  config: PluginConfig,
  agentId?: string,
): RoutingResult {
  const { tier } = scoringResult;

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
      // Use the first matching active experiment
      const experiment = experiments[0]!;
      const variant = assignExperimentVariant(experiment.trafficPct);
      const experimentModel = variant === 'treatment' ? experiment.treatmentModel : experiment.controlModel;
      return {
        model: experimentModel,
        tier,
        experimentId: experiment.id,
        experimentVariant: variant,
      };
    }
  }

  return { model, tier };
}

function resolveTierModel(tier: Tier, config: PluginConfig): string {
  const tierConfig = config.tiers[tier];
  if (tierConfig) return tierConfig.model;
  // Fallback to defaultTier
  const defaultTierConfig = config.tiers[config.defaultTier];
  if (defaultTierConfig) return defaultTierConfig.model;
  // Last resort: hardcoded default
  return 'anthropic/claude-sonnet-4-6';
}
