import type { Experiment, Tier } from './types.js';
import { getRawDb } from './stats.js';
import { randomUUID } from 'node:crypto';

// In-memory fallback when DB is not available
const memoryExperiments: Map<string, Experiment> = new Map();

export function listExperiments(): Experiment[] {
  const db = getRawDb();
  if (!db) return [...memoryExperiments.values()];

  type Row = {
    id: string;
    name: string;
    description: string | null;
    tier: string;
    control_model: string;
    treatment_model: string;
    traffic_pct: number;
    started_at: string;
    ended_at: string | null;
    status: string;
  };

  const rows = db.prepare<Row>('SELECT * FROM experiments ORDER BY started_at DESC').all() as Row[];
  return rows.map(rowToExperiment);
}

export function getActiveExperiments(tier?: Tier): Experiment[] {
  const db = getRawDb();
  if (!db) {
    return [...memoryExperiments.values()].filter(
      e => e.status === 'active' && (!tier || e.tier === tier),
    );
  }

  type Row = {
    id: string;
    name: string;
    description: string | null;
    tier: string;
    control_model: string;
    treatment_model: string;
    traffic_pct: number;
    started_at: string;
    ended_at: string | null;
    status: string;
  };

  let sql = "SELECT * FROM experiments WHERE status = 'active'";
  const params: unknown[] = [];
  if (tier) { sql += ' AND tier = ?'; params.push(tier); }

  const rows = db.prepare<Row>(sql).all(...params) as Row[];
  return rows.map(rowToExperiment);
}

export interface CreateExperimentInput {
  name: string;
  description?: string;
  tier: Tier;
  controlModel: string;
  treatmentModel: string;
  trafficPct?: number;
}

export function createExperiment(input: CreateExperimentInput): Experiment {
  const experiment: Experiment = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    tier: input.tier,
    controlModel: input.controlModel,
    treatmentModel: input.treatmentModel,
    trafficPct: input.trafficPct ?? 0.2,
    status: 'active',
  };

  const db = getRawDb();
  if (db) {
    db.prepare(`
      INSERT INTO experiments (id, name, description, tier, control_model, treatment_model, traffic_pct, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      experiment.id,
      experiment.name,
      experiment.description ?? null,
      experiment.tier,
      experiment.controlModel,
      experiment.treatmentModel,
      experiment.trafficPct,
    );
  } else {
    memoryExperiments.set(experiment.id, experiment);
  }

  return experiment;
}

export function stopExperiment(id: string): Experiment | null {
  const db = getRawDb();
  if (db) {
    db.prepare(`
      UPDATE experiments SET status = 'completed', ended_at = datetime('now') WHERE id = ?
    `).run(id);

    type Row = {
      id: string; name: string; description: string | null; tier: string;
      control_model: string; treatment_model: string; traffic_pct: number;
      started_at: string; ended_at: string | null; status: string;
    };
    const row = db.prepare<Row>('SELECT * FROM experiments WHERE id = ?').get(id) as Row | undefined;
    return row ? rowToExperiment(row) : null;
  }

  const exp = memoryExperiments.get(id);
  if (!exp) return null;
  const updated = { ...exp, status: 'completed' as const, endedAt: new Date().toISOString() };
  memoryExperiments.set(id, updated);
  return updated;
}

/**
 * Assign a variant for a request given the experiment's trafficPct.
 * Returns 'treatment' with probability trafficPct, otherwise 'control'.
 * Assignment is random per-request (no session stickiness).
 */
export function assignExperimentVariant(trafficPct: number): 'control' | 'treatment' {
  return Math.random() < trafficPct ? 'treatment' : 'control';
}

// ---------- helpers ----------

type ExperimentRow = {
  id: string;
  name: string;
  description: string | null;
  tier: string;
  control_model: string;
  treatment_model: string;
  traffic_pct: number;
  started_at: string;
  ended_at: string | null;
  status: string;
};

function rowToExperiment(r: ExperimentRow): Experiment {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    tier: r.tier as Tier,
    controlModel: r.control_model,
    treatmentModel: r.treatment_model,
    trafficPct: r.traffic_pct,
    startedAt: r.started_at,
    endedAt: r.ended_at ?? undefined,
    status: r.status as Experiment['status'],
  };
}
