import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { scorePrompt } from './scorer.js';
import { route } from './router.js';
import { initConfig, getConfig } from './config.js';
import { initDb, insertDecision, pruneOldDecisions, isDbEnabled } from './stats.js';
import { handleStats, handleDecisions, handleConfigPatch, handleConfigGet, handleExperimentsGet, handleExperimentsCreate, handleExperimentsStop } from './api.js';
import { renderDashboard } from './dashboard.js';

import type { IncomingMessage, ServerResponse } from 'node:http';

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
        // Initial prune
        const pruned = pruneOldDecisions(cfg.stats.retentionDays);
        if (pruned > 0) api.logger.info(`[smart-router] Pruned ${pruned} old decisions`);
        // Schedule periodic prune
        const timer = setInterval(() => {
          const count = pruneOldDecisions(getConfig().stats.retentionDays);
          if (count > 0) api.logger.info(`[smart-router] Pruned ${count} old decisions`);
        }, PRUNE_INTERVAL_MS);
        if (typeof timer === 'object' && 'unref' in timer) timer.unref();
      } else {
        api.logger.warn('[smart-router] Stats DB unavailable — routing continues without persistence');
      }
    }

    // Register before_model_resolve hook — the core routing logic
    api.registerHook(
      'before_model_resolve',
      (event: { prompt: string }, ctx: { agentId?: string; sessionKey?: string; trigger?: string }) => {
        const cfg = getConfig();

        // Skip if plugin disabled
        if (!cfg.enabled) return {};

        // Skip excluded agents
        if (ctx.agentId && cfg.excludeAgents.includes(ctx.agentId)) return {};

        // Skip excluded session patterns
        if (ctx.sessionKey && matchesAnyPattern(ctx.sessionKey, cfg.excludeSessionPatterns)) return {};

        // Score the prompt
        const scoringResult = scorePrompt(event.prompt, cfg.scoring);

        // Route to model
        const routingResult = route(scoringResult, cfg, ctx.agentId);

        // Record decision (fire-and-forget)
        if (cfg.stats.enabled && isDbEnabled()) {
          try {
            insertDecision({
              agentId: ctx.agentId,
              sessionKey: ctx.sessionKey,
              promptPreview: event.prompt.slice(0, 100),
              promptLength: event.prompt.length,
              complexityScore: scoringResult.score,
              tier: routingResult.tier,
              modelChosen: routingResult.model,
              signals: scoringResult.signals,
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
    api.registerHook('agent_end', () => {
      // Future: capture post-run telemetry (latency, token count, etc.)
    });

    // Register HTTP routes
    // Note: OpenClaw HTTP routes use raw IncomingMessage/ServerResponse, not Express.
    // Our api.ts handlers need to be adapted to work with the raw Node API.
    const routes: Array<{ path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }> = [
      { path: '/smart-router/stats', handler: wrapJsonHandler(handleStats) },
      { path: '/smart-router/decisions', handler: wrapJsonHandler(handleDecisions) },
      { path: '/smart-router/config', handler: wrapJsonHandler(handleConfigPatch, handleConfigGet) },
      { path: '/smart-router/experiments', handler: wrapJsonHandler(handleExperimentsCreate, handleExperimentsGet) },
    ];

    for (const r of routes) {
      api.registerHttpRoute({
        path: r.path,
        handler: r.handler,
        auth: 'gateway',
      });
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

/**
 * Wrap our JSON API handlers to work with raw Node http.
 * Supports method-based dispatch (POST handler, GET handler).
 */
function wrapJsonHandler(
  postOrOnlyHandler: (req: ParsedRequest, res: JsonResponse) => void,
  getHandler?: (req: ParsedRequest, res: JsonResponse) => void,
) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method?.toUpperCase() ?? 'GET';
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    // Parse query params
    const query: Record<string, string> = {};
    for (const [k, v] of url.searchParams) query[k] = v;

    // Parse URL params (extract :id from path)
    const params: Record<string, string> = {};
    const pathParts = url.pathname.split('/').filter(Boolean);
    // For /smart-router/experiments/:id/stop pattern
    if (pathParts.length >= 4 && pathParts[1] === 'experiments') {
      params['id'] = pathParts[2]!;
    }

    // Parse body for POST
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
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

// Simple request/response wrappers so api.ts doesn't need to change much
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

  status(code: number): this {
    this._status = code;
    return this;
  }

  json(data: unknown): void {
    this.res.writeHead(this._status, { 'Content-Type': 'application/json' });
    this.res.end(JSON.stringify(data));
  }

  setHeader(name: string, value: string): void {
    this.res.setHeader(name, value);
  }

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
