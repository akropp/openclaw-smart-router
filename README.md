# smart-router

Intelligent LLM routing for OpenClaw. Scores prompt complexity and routes to cost-effective models automatically.

## How it works

1. You send a message to any agent
2. The `before_model_resolve` hook fires and scores the prompt on 5 dimensions:
   - **Length** — short messages are likely trivial
   - **Code indicators** — code blocks, inline code, file paths
   - **Question complexity** — simple factual vs. deep analysis
   - **Technical keywords** — ack words vs. architecture/design terms
   - **Structure** — numbered lists, error logs, multiple paragraphs
3. The weighted score maps to a tier: `trivial`, `standard`, `complex`, or `code`
4. Each tier has a configured model — Haiku for trivial, Sonnet for standard, Opus for complex
5. The model override is returned to OpenClaw's model resolver

All scoring is synchronous and completes in <2ms. No LLM calls for classification.

## Install

```bash
openclaw plugins install /path/to/smart-router
openclaw gateway restart
```

## Configuration

Config lives in `openclaw.json` under `plugins.entries.smart-router.config`:

```json
{
  "plugins": {
    "entries": {
      "smart-router": {
        "enabled": true,
        "config": {
          "enabled": true,
          "defaultTier": "standard",
          "tiers": {
            "trivial": { "model": "anthropic/claude-haiku-4-5" },
            "standard": { "model": "anthropic/claude-sonnet-4-6" },
            "complex": { "model": "anthropic/claude-opus-4-6" },
            "code": { "model": "anthropic/claude-sonnet-4-6" }
          },
          "agentOverrides": {
            "monty": { "complex": "openai-codex/gpt-5.4" }
          },
          "excludeAgents": [],
          "excludeSessionPatterns": ["cron:*"]
        }
      }
    }
  }
}
```

Works with zero config — sensible defaults for everything.

### Tier configuration

| Tier | Default model | When |
|------|--------------|------|
| `trivial` | claude-haiku-4-5 | "thanks", "ok", "yes", short acks |
| `standard` | claude-sonnet-4-6 | Normal conversation, moderate questions |
| `complex` | claude-opus-4-6 | Deep analysis, architecture, multi-step reasoning |
| `code` | claude-sonnet-4-6 | Code blocks, debugging, file paths detected |

### Agent overrides

Override the model for specific tiers per agent:

```json
{
  "agentOverrides": {
    "monty": { "complex": "openai-codex/gpt-5.4" },
    "gilfoyle": { "code": "anthropic/claude-opus-4-6" }
  }
}
```

## Dashboard

Access at `http://your-gateway:port/smart-router/dashboard`

- Real-time routing stats (auto-refresh every 30s)
- Tier distribution breakdown
- Recent decisions table with scores and signals
- Config editor with Apply (live) and Save (persist to openclaw.json) buttons
- Experiment management

## API

All routes require gateway auth.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/smart-router/stats?period=24h&agent=&tier=` | Routing statistics |
| GET | `/smart-router/decisions?limit=50` | Recent routing decisions |
| GET | `/smart-router/config` | Current config |
| POST | `/smart-router/config?persist=true` | Hot-patch config (persist=true writes to disk) |
| GET | `/smart-router/experiments` | List experiments |
| POST | `/smart-router/experiments` | Create experiment |
| POST | `/smart-router/experiments/:id/stop` | Stop experiment |

## A/B Testing

Test different models against each other for a given tier:

```bash
curl -X POST http://localhost:18789/smart-router/experiments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "opus-vs-gpt54-complex",
    "tier": "complex",
    "controlModel": "anthropic/claude-opus-4-6",
    "treatmentModel": "openai-codex/gpt-5.4",
    "trafficPct": 0.2
  }'
```

20% of complex-tier requests will route to gpt-5.4 instead of Opus. All decisions are logged with experiment variant for comparison.

## Stats Database

SQLite database at `~/.openclaw/smart-router/stats.db` (configurable). Tracks every routing decision with scores, signals, tier, and model chosen. Auto-prunes after 30 days.

## License

MIT
