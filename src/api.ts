import type { ParsedRequest, JsonResponse } from './index.js';
import { queryStats, queryDecisions } from './stats.js';
import { getConfig, patchConfig } from './config.js';
import { persistConfig } from './persist.js';
import { listExperiments, createExperiment, stopExperiment } from './experiments.js';
import type { CreateExperimentInput } from './experiments.js';
import type { Tier } from './types.js';

// GET /smart-router/stats
export function handleStats(req: ParsedRequest, res: JsonResponse): void {
  const { period, agent, tier } = req.query;
  const stats = queryStats({
    period: period as '1h' | '6h' | '24h' | '7d' | '30d' | undefined,
    agent,
    tier,
  });
  res.json(stats);
}

// GET /smart-router/decisions
export function handleDecisions(req: ParsedRequest, res: JsonResponse): void {
  const { agent, tier, limit } = req.query;
  const decisions = queryDecisions({
    agent,
    tier,
    limit: limit ? parseInt(limit, 10) : 50,
  });
  res.json(decisions);
}

// POST /smart-router/config  (GET also handled via wrapJsonHandler dispatch)
export function handleConfigPatch(req: ParsedRequest, res: JsonResponse): void {
  if (req.method === 'GET') {
    return handleConfigGet(req, res);
  }

  const patch = req.body;
  if (!patch || typeof patch !== 'object') {
    res.status(400).json({ error: 'Request body must be a JSON object' });
    return;
  }

  const newConfig = patchConfig(patch);
  const persist = req.query['persist'] === 'true';

  if (persist) {
    const ok = persistConfig(newConfig);
    if (!ok) {
      // Config was applied in memory but failed to persist
      res.json({ ok: true, persisted: false, config: newConfig, warning: 'Applied in memory but failed to write openclaw.json' });
      return;
    }
    res.json({ ok: true, persisted: true, config: newConfig });
    return;
  }

  res.json({ ok: true, persisted: false, config: newConfig });
}

// GET /smart-router/config
export function handleConfigGet(_req: ParsedRequest, res: JsonResponse): void {
  res.json(getConfig());
}

// GET /smart-router/experiments
export function handleExperimentsGet(_req: ParsedRequest, res: JsonResponse): void {
  const experiments = listExperiments();
  res.json(experiments);
}

// POST /smart-router/experiments
export function handleExperimentsCreate(req: ParsedRequest, res: JsonResponse): void {
  if (req.method === 'GET') {
    return handleExperimentsGet(req, res);
  }

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
export function handleExperimentsStop(req: ParsedRequest, res: JsonResponse): void {
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
