import type { PluginRequest, PluginResponse } from 'openclaw/plugin-sdk/plugin-entry';
import { queryStats, queryDecisions } from './stats.js';
import { getConfig, patchConfig } from './config.js';
import {
  listExperiments,
  createExperiment,
  stopExperiment,
} from './experiments.js';
import type { CreateExperimentInput } from './experiments.js';
import type { Tier } from './types.js';

// GET /smart-router/stats
export function handleStats(req: PluginRequest, res: PluginResponse): void {
  const { period, agent, tier } = req.query as {
    period?: '1h' | '6h' | '24h' | '7d' | '30d';
    agent?: string;
    tier?: string;
  };
  const stats = queryStats({ period, agent, tier });
  res.json(stats);
}

// GET /smart-router/decisions
export function handleDecisions(req: PluginRequest, res: PluginResponse): void {
  const { agent, tier, limit } = req.query as {
    agent?: string;
    tier?: string;
    limit?: string;
  };
  const decisions = queryDecisions({
    agent,
    tier,
    limit: limit ? parseInt(limit, 10) : 50,
  });
  res.json(decisions);
}

// POST /smart-router/config
export function handleConfigPatch(req: PluginRequest, res: PluginResponse): void {
  const patch = req.body;
  if (!patch || typeof patch !== 'object') {
    res.status(400).json({ error: 'Request body must be a JSON object' });
    return;
  }
  const newConfig = patchConfig(patch);
  res.json({ ok: true, config: newConfig });
}

// GET /smart-router/config
export function handleConfigGet(_req: PluginRequest, res: PluginResponse): void {
  res.json(getConfig());
}

// GET /smart-router/experiments
export function handleExperimentsGet(_req: PluginRequest, res: PluginResponse): void {
  const experiments = listExperiments();
  res.json(experiments);
}

// POST /smart-router/experiments
export function handleExperimentsCreate(req: PluginRequest, res: PluginResponse): void {
  const body = req.body as {
    name?: string;
    description?: string;
    tier?: string;
    controlModel?: string;
    treatmentModel?: string;
    trafficPct?: number;
  };

  if (!body.name || !body.tier || !body.controlModel || !body.treatmentModel) {
    res.status(400).json({
      error: 'Required fields: name, tier, controlModel, treatmentModel',
    });
    return;
  }

  const input: CreateExperimentInput = {
    name: body.name,
    description: body.description,
    tier: body.tier as Tier,
    controlModel: body.controlModel,
    treatmentModel: body.treatmentModel,
    trafficPct: typeof body.trafficPct === 'number' ? body.trafficPct : 0.2,
  };

  const experiment = createExperiment(input);
  res.status(201).json(experiment);
}

// POST /smart-router/experiments/:id/stop
export function handleExperimentsStop(req: PluginRequest, res: PluginResponse): void {
  const id = req.params['id'];
  if (!id) {
    res.status(400).json({ error: 'Missing experiment id' });
    return;
  }
  const experiment = stopExperiment(id);
  if (!experiment) {
    res.status(404).json({ error: `Experiment ${id} not found` });
    return;
  }
  res.json(experiment);
}
