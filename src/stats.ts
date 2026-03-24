import type { RoutingDecision, StatsQuery, StatsResult } from './types.js';
import type { Database as BetterSqliteDatabase, DatabaseConstructor } from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

const _require = createRequire(import.meta.url);

// Lazily resolved DB instance – null means stats are disabled.
let db: BetterSqliteDatabase | null = null;
let dbEnabled = false;

const PERIOD_SECONDS: Record<string, number> = {
  '1h': 3600,
  '6h': 21600,
  '24h': 86400,
  '7d': 604800,
  '30d': 2592000,
};

const CREATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS routing_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  agent_id TEXT,
  session_key TEXT,
  prompt_preview TEXT,
  prompt_length INTEGER,
  complexity_score REAL,
  tier TEXT NOT NULL,
  model_chosen TEXT NOT NULL,
  model_default TEXT,
  signals TEXT,
  experiment_id TEXT,
  experiment_variant TEXT
);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tier TEXT NOT NULL,
  control_model TEXT NOT NULL,
  treatment_model TEXT NOT NULL,
  traffic_pct REAL DEFAULT 0.2,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  status TEXT DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON routing_decisions(timestamp);
CREATE INDEX IF NOT EXISTS idx_decisions_tier ON routing_decisions(tier);
CREATE INDEX IF NOT EXISTS idx_decisions_agent ON routing_decisions(agent_id);
CREATE INDEX IF NOT EXISTS idx_decisions_experiment ON routing_decisions(experiment_id);
`;

export function initDb(dbPath: string): boolean {
  const resolvedPath = dbPath.replace(/^~/, homedir());
  const dir = dirname(resolvedPath);
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    console.warn('[smart-router] Failed to create DB directory:', err);
    return false;
  }

  try {
    // Dynamic require – better-sqlite3 is a native module provided by OpenClaw runtime
    const BetterSqlite3 = (_require('better-sqlite3') as { default: DatabaseConstructor }).default;
    db = new BetterSqlite3(resolvedPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(CREATE_SCHEMA);
    dbEnabled = true;
    return true;
  } catch (err) {
    console.warn('[smart-router] better-sqlite3 not available, stats disabled:', (err as Error).message);
    db = null;
    dbEnabled = false;
    return false;
  }
}

export function isDbEnabled(): boolean {
  return dbEnabled && db !== null;
}

export function insertDecision(decision: RoutingDecision): void {
  if (!db) return;
  db.prepare(`
    INSERT INTO routing_decisions
      (agent_id, session_key, prompt_preview, prompt_length, complexity_score, tier, model_chosen, model_default, signals, experiment_id, experiment_variant)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    decision.agentId ?? null,
    decision.sessionKey ?? null,
    decision.promptPreview,
    decision.promptLength,
    decision.complexityScore,
    decision.tier,
    decision.modelChosen,
    decision.modelDefault ?? null,
    JSON.stringify(decision.signals),
    decision.experimentId ?? null,
    decision.experimentVariant ?? null,
  );
}

export function queryStats(q: StatsQuery = {}): StatsResult {
  const period = q.period ?? '24h';
  const periodSec = PERIOD_SECONDS[period] ?? PERIOD_SECONDS['24h']!;

  if (!db) {
    return emptyStats(period);
  }

  const filters: string[] = [`datetime(timestamp) >= datetime('now', '-${periodSec} seconds')`];
  const params: unknown[] = [];

  if (q.agent) { filters.push('agent_id = ?'); params.push(q.agent); }
  if (q.tier) { filters.push('tier = ?'); params.push(q.tier); }

  const where = `WHERE ${filters.join(' AND ')}`;

  type DecisionRow = {
    tier: string;
    model_chosen: string;
    agent_id: string | null;
    complexity_score: number;
  };

  const rows = db.prepare<DecisionRow>(`
    SELECT tier, model_chosen, agent_id, complexity_score
    FROM routing_decisions ${where}
  `).all(...params) as DecisionRow[];

  const byTier: Record<string, number> = {};
  const byModel: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  const scoreDist: Record<string, number> = {
    '0.0-0.2': 0, '0.2-0.5': 0, '0.5-0.8': 0, '0.8-1.0': 0,
  };
  let scoreSum = 0;

  for (const row of rows) {
    byTier[row.tier] = (byTier[row.tier] ?? 0) + 1;
    byModel[row.model_chosen] = (byModel[row.model_chosen] ?? 0) + 1;
    if (row.agent_id) byAgent[row.agent_id] = (byAgent[row.agent_id] ?? 0) + 1;
    scoreSum += row.complexity_score;
    const bucket = scoreBucket(row.complexity_score);
    scoreDist[bucket] = (scoreDist[bucket] ?? 0) + 1;
  }

  return {
    period,
    total: rows.length,
    byTier,
    byModel,
    byAgent,
    avgScore: rows.length > 0 ? scoreSum / rows.length : 0,
    scoreDistribution: scoreDist,
  };
}

export function queryDecisions(q: StatsQuery = {}): RoutingDecision[] {
  if (!db) return [];

  const period = q.period ?? '24h';
  const periodSec = PERIOD_SECONDS[period] ?? PERIOD_SECONDS['24h']!;
  const limit = q.limit ?? 50;

  const filters: string[] = [`datetime(timestamp) >= datetime('now', '-${periodSec} seconds')`];
  const params: unknown[] = [];

  if (q.agent) { filters.push('agent_id = ?'); params.push(q.agent); }
  if (q.tier) { filters.push('tier = ?'); params.push(q.tier); }

  params.push(limit);
  const where = `WHERE ${filters.join(' AND ')}`;

  type Row = {
    id: number;
    timestamp: string;
    agent_id: string | null;
    session_key: string | null;
    prompt_preview: string | null;
    prompt_length: number;
    complexity_score: number;
    tier: string;
    model_chosen: string;
    model_default: string | null;
    signals: string | null;
    experiment_id: string | null;
    experiment_variant: string | null;
  };

  const rows = db.prepare<Row>(`
    SELECT * FROM routing_decisions ${where}
    ORDER BY timestamp DESC LIMIT ?
  `).all(...params) as Row[];

  return rows.map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    agentId: r.agent_id ?? undefined,
    sessionKey: r.session_key ?? undefined,
    promptPreview: r.prompt_preview ?? '',
    promptLength: r.prompt_length,
    complexityScore: r.complexity_score,
    tier: r.tier as RoutingDecision['tier'],
    modelChosen: r.model_chosen,
    modelDefault: r.model_default ?? undefined,
    signals: r.signals ? JSON.parse(r.signals) : { length: 0, code: 0, question: 0, keywords: 0, structure: 0 },
    experimentId: r.experiment_id ?? undefined,
    experimentVariant: r.experiment_variant ?? undefined,
  }));
}

export function pruneOldDecisions(retentionDays: number): number {
  if (!db) return 0;
  const result = db.prepare(
    `DELETE FROM routing_decisions WHERE datetime(timestamp) < datetime('now', '-${retentionDays} days')`,
  ).run();
  return result.changes;
}

// ---------- DB helpers for experiments module ----------

export function getRawDb(): BetterSqliteDatabase | null {
  return db;
}

// ---------- private helpers ----------

function scoreBucket(score: number): string {
  if (score < 0.2) return '0.0-0.2';
  if (score < 0.5) return '0.2-0.5';
  if (score < 0.8) return '0.5-0.8';
  return '0.8-1.0';
}

function emptyStats(period: string): StatsResult {
  return {
    period,
    total: 0,
    byTier: {},
    byModel: {},
    byAgent: {},
    avgScore: 0,
    scoreDistribution: { '0.0-0.2': 0, '0.2-0.5': 0, '0.5-0.8': 0, '0.8-1.0': 0 },
  };
}
