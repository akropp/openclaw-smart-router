import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import type { BeforeModelResolveContext, AgentEndContext } from 'openclaw/plugin-sdk/plugin-entry';
import { scorePrompt } from './scorer.js';
import { route } from './router.js';
import { initConfig, getConfig } from './config.js';
import { initDb, insertDecision, pruneOldDecisions, isDbEnabled } from './stats.js';
import {
  handleStats,
  handleDecisions,
  handleConfigPatch,
  handleConfigGet,
  handleExperimentsGet,
  handleExperimentsCreate,
  handleExperimentsStop,
} from './api.js';
import { renderDashboard } from './dashboard.js';

const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export default definePluginEntry({
  async setup(api) {
    // Initialize config from plugin-provided config (defaults if none given)
    // OpenClaw passes the plugin config object when loading the plugin.
    // We call initConfig with an empty object here; the real config arrives via
    // the before_model_resolve context on first request.
    initConfig({});

    // Initialize stats DB
    const cfg = getConfig();
    if (cfg.stats.enabled) {
      const ok = initDb(cfg.stats.dbPath);
      if (ok) {
        api.log('info', '[smart-router] Stats DB initialized', { dbPath: cfg.stats.dbPath });
        // Initial prune
        const pruned = pruneOldDecisions(cfg.stats.retentionDays);
        if (pruned > 0) api.log('info', `[smart-router] Pruned ${pruned} old decisions`);
        // Schedule periodic prune
        setInterval(() => {
          const count = pruneOldDecisions(getConfig().stats.retentionDays);
          if (count > 0) api.log('info', `[smart-router] Pruned ${count} old decisions`);
        }, PRUNE_INTERVAL_MS);
      } else {
        api.log('warn', '[smart-router] Stats DB unavailable — routing continues without persistence');
      }
    }

    // Register HTTP routes
    api.registerHttpRoute('GET', '/smart-router/stats', handleStats);
    api.registerHttpRoute('GET', '/smart-router/decisions', handleDecisions);
    api.registerHttpRoute('GET', '/smart-router/config', handleConfigGet);
    api.registerHttpRoute('POST', '/smart-router/config', handleConfigPatch);
    api.registerHttpRoute('GET', '/smart-router/experiments', handleExperimentsGet);
    api.registerHttpRoute('POST', '/smart-router/experiments', handleExperimentsCreate);
    api.registerHttpRoute('POST', '/smart-router/experiments/:id/stop', handleExperimentsStop);

    // Dashboard route
    api.registerHttpRoute('GET', '/smart-router/dashboard', (_req, res) => {
      if (!getConfig().dashboard.enabled) {
        res.status(404).json({ error: 'Dashboard disabled' });
        return;
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(renderDashboard());
    });

    api.log('info', '[smart-router] Plugin initialized');
  },

  hooks: {
    before_model_resolve(ctx: BeforeModelResolveContext) {
      // Sync config from context if provided
      if (ctx.pluginConfig && typeof ctx.pluginConfig === 'object') {
        initConfig(ctx.pluginConfig);
      }

      const cfg = getConfig();

      // Skip if plugin disabled
      if (!cfg.enabled) return {};

      // Skip excluded agents
      if (ctx.agentId && cfg.excludeAgents.includes(ctx.agentId)) return {};

      // Skip excluded session patterns
      if (ctx.sessionKey && matchesAnyPattern(ctx.sessionKey, cfg.excludeSessionPatterns)) return {};

      // Score the prompt
      const scoringResult = scorePrompt(ctx.prompt, cfg.scoring);

      // Route to model
      const routingResult = route(scoringResult, cfg, ctx.agentId);

      // Record decision asynchronously (fire-and-forget to avoid blocking)
      if (cfg.stats.enabled && isDbEnabled()) {
        try {
          insertDecision({
            agentId: ctx.agentId,
            sessionKey: ctx.sessionKey,
            promptPreview: ctx.prompt.slice(0, 100),
            promptLength: ctx.prompt.length,
            complexityScore: scoringResult.score,
            tier: routingResult.tier,
            modelChosen: routingResult.model,
            modelDefault: ctx.defaultModel,
            signals: scoringResult.signals,
            experimentId: routingResult.experimentId,
            experimentVariant: routingResult.experimentVariant,
          });
        } catch (err) {
          // Never let stats errors affect routing
          console.error('[smart-router] Failed to record decision:', err);
        }
      }

      return { modelOverride: routingResult.model };
    },

    agent_end(_ctx: AgentEndContext) {
      // Future: capture post-run telemetry (latency, token count, etc.)
      // Currently a no-op; placeholder for future enhancement.
    },
  },
});

function matchesAnyPattern(value: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (matchesGlob(value, pattern)) return true;
  }
  return false;
}

function matchesGlob(value: string, pattern: string): boolean {
  // Simple glob: only supports * wildcard
  const regexStr = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + regexStr + '$').test(value);
}
