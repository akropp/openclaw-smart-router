import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { scorePrompt } from './scorer.js';
import { route } from './router.js';
import { initConfig, getConfig } from './config.js';
import { initDb, insertDecision, pruneOldDecisions, isDbEnabled } from './stats.js';
import { classifyWithCache } from './llm-classifier.js';
import { consumeBump, registerBump, recordBump, isBumpCommand } from './bump.js';
import { handleStats, handleDecisions, handleConfigPatch, handleConfigGet, handleExperimentsGet, handleExperimentsCreate, handleExperimentsStop, handleBumpApi } from './api.js';
import { renderDashboard } from './dashboard.js';

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Tier } from './types.js';

const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export default definePluginEntry({
  id: 'smart-router',
  name: 'Smart Router',
  description: 'Score prompt complexity and route to cost-effective models automatically',

  register(api) {
    // Initialize config from plugin config section in openclaw.json
    initConfig(api.pluginConfig ?? {});

    // Initialize stats DB
    const cfg = getConfig();
    if (cfg.stats.enabled) {
      const ok = initDb(cfg.stats.dbPath);
      if (ok) {
        api.logger.info('[smart-router] Stats DB initialized');
        const pruned = pruneOldDecisions(cfg.stats.retentionDays);
        if (pruned > 0) api.logger.info(`[smart-router] Pruned ${pruned} old decisions`);
        const timer = setInterval(() => {
          const count = pruneOldDecisions(getConfig().stats.retentionDays);
          if (count > 0) api.logger.info(`[smart-router] Pruned ${count} old decisions`);
        }, PRUNE_INTERVAL_MS);
        if (typeof timer === 'object' && 'unref' in timer) timer.unref();
      } else {
        api.logger.warn('[smart-router] Stats DB unavailable — routing continues without persistence');
      }
    }

    // Register before_model_resolve hook — the core routing logic (async for LLM classifier)
    api.registerHook(
      'before_model_resolve',
      async (event: unknown, ctx: unknown) => {
        const { prompt } = event as { prompt: string };
        const { agentId, sessionKey } = (ctx ?? {}) as { agentId?: string; sessionKey?: string };
        const cfg = getConfig();

        // Skip if plugin disabled
        if (!cfg.enabled) return {};

        // Skip excluded agents
        if (agentId && cfg.excludeAgents.includes(agentId)) return {};

        // Skip excluded session patterns
        if (sessionKey && matchesAnyPattern(sessionKey, cfg.excludeSessionPatterns)) return {};

        // Check if user sent /bump — register it and let the message through
        // (The bump will be consumed on the *next* agent run, not this one,
        // since /bump itself shouldn't trigger a full agent response)
        const bumpCheck = isBumpCommand(prompt);
        if (bumpCheck.isBump && sessionKey) {
          registerBump(sessionKey, bumpCheck.tier);
          // Don't override model for the /bump command itself
          return {};
        }

        // Check for pending bump (from a previous /bump command)
        let classifier: 'heuristic' | 'llm' | 'bump' = 'heuristic';
        let forcedTier: Tier | null = null;

        if (sessionKey) {
          forcedTier = consumeBump(sessionKey);
          if (forcedTier) {
            classifier = 'bump';
          }
        }

        // Score the prompt with heuristics
        const scoringResult = scorePrompt(prompt, cfg.scoring);
        let llmTier: Tier | null = null;

        // If no bump override, and LLM classifier is enabled, check ambiguous band
        if (!forcedTier && cfg.llmClassifier.enabled) {
          const score = scoringResult.score;
          const { confidentTrivialThreshold, confidentComplexThreshold } = cfg.llmClassifier;

          // Only call LLM for ambiguous scores
          if (score > confidentTrivialThreshold && score < confidentComplexThreshold) {
            try {
              llmTier = await classifyWithCache(
                { prompt },
                cfg.llmClassifier,
              );
              if (llmTier) {
                // Override the heuristic tier with LLM's judgment
                scoringResult.tier = llmTier;
                classifier = 'llm';
              }
            } catch {
              // Fall back to heuristic on any error
            }
          }
        }

        // If bump is active, override the tier
        if (forcedTier) {
          scoringResult.tier = forcedTier;
        }

        // Route to model (with session momentum)
        const routingResult = route(scoringResult, cfg, agentId, sessionKey, prompt);

        // Record bump feedback if applicable
        if (classifier === 'bump' && sessionKey && forcedTier) {
          recordBump(
            sessionKey,
            agentId,
            scoringResult.tier,  // what heuristic would have chosen
            forcedTier,
            prompt.slice(0, 100),
            scoringResult.score,
          );
        }

        // Record decision
        if (cfg.stats.enabled && isDbEnabled()) {
          try {
            insertDecision({
              agentId,
              sessionKey,
              promptPreview: prompt.slice(0, 100),
              promptLength: prompt.length,
              complexityScore: scoringResult.score,
              tier: routingResult.tier,
              rawTier: routingResult.rawTier,
              llmTier,
              modelChosen: routingResult.model,
              signals: scoringResult.signals,
              classifier,
              experimentId: routingResult.experimentId,
              experimentVariant: routingResult.experimentVariant,
            });
          } catch {
            // Never let stats errors affect routing
          }
        }

        return { modelOverride: routingResult.model };
      },
    );

    // Register agent_end hook (placeholder for future telemetry)
    api.registerHook('agent_end', () => {});

    // Register HTTP routes
    const routes: Array<{ path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }> = [
      { path: '/smart-router/stats', handler: wrapJsonHandler(handleStats) },
      { path: '/smart-router/decisions', handler: wrapJsonHandler(handleDecisions) },
      { path: '/smart-router/config', handler: wrapJsonHandler(handleConfigPatch, handleConfigGet) },
      { path: '/smart-router/experiments', handler: wrapJsonHandler(handleExperimentsCreate, handleExperimentsGet) },
      { path: '/smart-router/bump', handler: wrapJsonHandler(handleBumpApi) },
    ];

    for (const r of routes) {
      api.registerHttpRoute({ path: r.path, handler: r.handler, auth: 'gateway' });
    }

    // Experiment stop (prefix match for :id param)
    api.registerHttpRoute({
      path: '/smart-router/experiments/',
      handler: wrapJsonHandler(handleExperimentsStop),
      auth: 'gateway',
      match: 'prefix',
    });

    // Dashboard
    api.registerHttpRoute({
      path: '/smart-router/dashboard',
      handler: (_req: IncomingMessage, res: ServerResponse) => {
        if (!getConfig().dashboard.enabled) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Dashboard disabled' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderDashboard());
      },
      auth: 'gateway',
    });

    api.logger.info('[smart-router] Plugin registered');
  },
});

// ---------- Helpers ----------

function wrapJsonHandler(
  postOrOnlyHandler: (req: ParsedRequest, res: JsonResponse) => void,
  getHandler?: (req: ParsedRequest, res: JsonResponse) => void,
) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method?.toUpperCase() ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    const query: Record<string, string> = {};
    for (const [k, v] of url.searchParams) query[k] = v;

    const params: Record<string, string> = {};
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts.length >= 4 && pathParts[1] === 'experiments') {
      params['id'] = pathParts[2]!;
    }

    let body: unknown = {};
    if (method === 'POST') {
      body = await readJsonBody(req);
    }

    const parsed: ParsedRequest = { method, query, params, body, url };
    const jsonRes = new JsonResponse(res);

    if (method === 'GET' && getHandler) {
      getHandler(parsed, jsonRes);
    } else {
      postOrOnlyHandler(parsed, jsonRes);
    }
  };
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

export interface ParsedRequest {
  method: string;
  query: Record<string, string>;
  params: Record<string, string>;
  body: unknown;
  url: URL;
}

export class JsonResponse {
  private _status = 200;
  constructor(private res: ServerResponse) {}

  status(code: number): this { this._status = code; return this; }

  json(data: unknown): void {
    this.res.writeHead(this._status, { 'Content-Type': 'application/json' });
    this.res.end(JSON.stringify(data));
  }

  setHeader(name: string, value: string): void { this.res.setHeader(name, value); }

  send(body: string): void {
    this.res.writeHead(this._status);
    this.res.end(body);
  }
}

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (matchesGlob(value, pattern)) return true;
  }
  return false;
}

function matchesGlob(value: string, pattern: string): boolean {
  const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + regexStr + '$').test(value);
}
