# smart-router — OpenClaw Plugin Design

## Overview

An OpenClaw plugin that scores incoming prompts on complexity and routes them to the most cost-effective model. Pure plugin — no fork changes required. Uses the `before_model_resolve` hook to intercept model selection.

## Architecture

```
┌─────────────────────────────────────────┐
│              OpenClaw Gateway            │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │     before_model_resolve hook     │  │
│  │  ┌─────────┐   ┌──────────────┐  │  │
│  │  │ Scorer  │──>│ Tier Mapper  │  │  │
│  │  └─────────┘   └──────────────┘  │  │
│  │       │              │            │  │
│  │       │       modelOverride       │  │
│  │       ▼                           │  │
│  │  ┌─────────┐                      │  │
│  │  │ Stats DB│ (SQLite)             │  │
│  │  └─────────┘                      │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │     HTTP Routes (plugin API)      │  │
│  │  GET  /smart-router/stats         │  │
│  │  GET  /smart-router/dashboard     │  │
│  │  POST /smart-router/config        │  │
│  │  GET  /smart-router/experiments   │  │
│  │  POST /smart-router/experiments   │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## Plugin Config (in openclaw.json)

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
            "trivial": {
              "model": "anthropic/claude-haiku-4-5",
              "description": "Simple acks, greetings, yes/no, short factual"
            },
            "standard": {
              "model": "anthropic/claude-sonnet-4-6",
              "description": "Normal conversation, moderate reasoning"
            },
            "complex": {
              "model": "anthropic/claude-opus-4-6",
              "description": "Deep analysis, architecture, multi-step reasoning"
            },
            "code": {
              "model": "anthropic/claude-sonnet-4-6",
              "description": "Code generation, debugging, refactoring"
            }
          },
          "agentOverrides": {
            "monty": { "complex": "openai-codex/gpt-5.4" },
            "gilfoyle": { "standard": "anthropic/claude-sonnet-4-6" }
          },
          "excludeAgents": [],
          "excludeSessionPatterns": ["cron:*"],
          "scoring": {
            "shortMessageThreshold": 20,
            "codeBlockWeight": 0.4,
            "questionWeight": 0.2,
            "technicalKeywordWeight": 0.15,
            "contextLengthWeight": 0.1,
            "thresholds": {
              "trivial": 0.2,
              "standard": 0.5,
              "complex": 0.8
            }
          },
          "stats": {
            "enabled": true,
            "dbPath": "~/.openclaw/smart-router/stats.db",
            "retentionDays": 30
          },
          "experiments": {
            "enabled": false,
            "active": []
          },
          "dashboard": {
            "enabled": true
          }
        }
      }
    }
  }
}
```

## Scoring Algorithm

The scorer evaluates the prompt on multiple signals and produces a 0.0–1.0 complexity score:

### Signals

1. **Message length** (0.0–1.0)
   - < 20 chars → 0.0 (trivial)
   - 20–100 chars → 0.3
   - 100–500 chars → 0.6
   - 500+ chars → 0.8
   - 2000+ chars → 1.0

2. **Code indicators** (0.0–1.0)
   - Code blocks (```) → 0.8
   - Inline code → 0.4
   - File paths, function names → 0.3

3. **Question complexity** (0.0–1.0)
   - No question → 0.1
   - Simple question (what/when/where) → 0.3
   - Analysis question (why/how/explain) → 0.6
   - Multi-part question → 0.8
   - Architecture/design question → 0.9

4. **Technical keywords** (0.0–1.0)
   - Ack words (yes, no, thanks, ok, sure, got it) → 0.0
   - General keywords → 0.3
   - Technical keywords (deploy, architecture, security, refactor) → 0.7
   - Deep reasoning keywords (tradeoffs, implications, evaluate) → 0.9

5. **Structural signals** (0.0–1.0)
   - Numbered lists → 0.5
   - Multiple paragraphs → 0.4
   - URLs → 0.3
   - Error logs/stack traces → 0.7

### Score computation

```
final_score = (
  length_score * weights.length +
  code_score * weights.code +
  question_score * weights.question +
  keyword_score * weights.keywords +
  structure_score * weights.structure
)
```

Default weights: length=0.15, code=0.25, question=0.25, keywords=0.2, structure=0.15

### Tier mapping

- score < thresholds.trivial (0.2) → "trivial"
- score < thresholds.standard (0.5) → "standard"
- score < thresholds.complex (0.8) → "complex"
- score >= thresholds.complex → "complex"
- Code detected + score > 0.3 → "code" (override)

## Stats Database (SQLite)

### Schema

```sql
CREATE TABLE routing_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  agent_id TEXT,
  session_key TEXT,
  prompt_preview TEXT,          -- first 100 chars
  prompt_length INTEGER,
  complexity_score REAL,
  tier TEXT NOT NULL,
  model_chosen TEXT NOT NULL,
  model_default TEXT,           -- what would have been used without the plugin
  signals TEXT,                 -- JSON of individual signal scores
  experiment_id TEXT,           -- null if not in an experiment
  experiment_variant TEXT       -- 'control' or 'treatment'
);

CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  tier TEXT NOT NULL,            -- which tier to experiment on
  control_model TEXT NOT NULL,
  treatment_model TEXT NOT NULL,
  traffic_pct REAL DEFAULT 0.2, -- fraction sent to treatment
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  status TEXT DEFAULT 'active'  -- active, paused, completed
);

CREATE INDEX idx_decisions_timestamp ON routing_decisions(timestamp);
CREATE INDEX idx_decisions_tier ON routing_decisions(tier);
CREATE INDEX idx_decisions_agent ON routing_decisions(agent_id);
CREATE INDEX idx_decisions_experiment ON routing_decisions(experiment_id);
```

## HTTP API Routes

All registered via `api.registerHttpRoute()`.

### GET /smart-router/stats
Query routing statistics.

**Query params:**
- `period=1h|6h|24h|7d|30d` (default: 24h)
- `agent=<agent_id>` (optional filter)
- `tier=<tier_name>` (optional filter)

**Response:**
```json
{
  "period": "24h",
  "total": 142,
  "byTier": { "trivial": 45, "standard": 67, "complex": 22, "code": 8 },
  "byModel": { "claude-haiku-4-5": 45, "claude-sonnet-4-6": 75, "claude-opus-4-6": 22 },
  "byAgent": { "clawd": 50, "gilfoyle": 30, "monty": 25 },
  "avgScore": 0.42,
  "scoreDistribution": { "0.0-0.2": 45, "0.2-0.5": 67, "0.5-0.8": 22, "0.8-1.0": 8 }
}
```

### GET /smart-router/decisions
Recent routing decisions.

**Query params:**
- `limit=50` (default)
- `agent=<agent_id>` (optional)
- `tier=<tier_name>` (optional)

### POST /smart-router/config
Hot-patch config (ephemeral, resets on restart).

**Body:** Partial config object (deep-merged with current).

### GET /smart-router/experiments
List experiments.

### POST /smart-router/experiments
Create/update experiment.

**Body:**
```json
{
  "name": "opus-vs-gpt54-complex",
  "tier": "complex",
  "controlModel": "anthropic/claude-opus-4-6",
  "treatmentModel": "openai-codex/gpt-5.4",
  "trafficPct": 0.2
}
```

### POST /smart-router/experiments/:id/stop
End an experiment.

## Dashboard

A single-page dashboard served at `GET /smart-router/dashboard`. Inline HTML/CSS/JS (no build step, no external deps).

**Features:**
- Real-time routing stats (auto-refresh every 30s)
- Tier distribution pie chart (CSS-only or inline SVG)
- Recent decisions table with score, tier, model
- Config editor (JSON textarea, hot-patch on save)
- Experiment management UI (create, view, stop)
- Score distribution histogram

## A/B Testing Framework

### How it works

1. User creates an experiment targeting a tier (e.g., "complex")
2. When a prompt scores into that tier, the router checks active experiments
3. Based on `trafficPct`, the request is assigned to control or treatment
4. Assignment is random per-request (no session stickiness needed for routing)
5. Decision is logged with `experiment_id` and `experiment_variant`
6. Stats API can filter by experiment to compare variants

### Quality signals (future)

For now, we track routing decisions only. Future enhancement: hook into `agent_end` to capture:
- Response latency
- Token count
- Error/retry rate
- User satisfaction (if they immediately retry or switch models)

## File Structure

```
smart-router/
├── openclaw.plugin.json        # Plugin manifest
├── package.json                # Node package
├── tsconfig.json               # TypeScript config
├── src/
│   ├── index.ts                # Plugin entry point
│   ├── scorer.ts               # Complexity scoring engine
│   ├── router.ts               # Tier mapping + model selection
│   ├── stats.ts                # SQLite stats database
│   ├── experiments.ts          # A/B test framework
│   ├── api.ts                  # HTTP route handlers
│   ├── dashboard.ts            # Inline HTML dashboard
│   ├── config.ts               # Config types + validation + hot-patching
│   └── types.ts                # Shared types
├── test/
│   ├── scorer.test.ts          # Scoring algorithm tests
│   ├── router.test.ts          # Routing logic tests
│   └── experiments.test.ts     # A/B framework tests
├── DESIGN.md                   # This file
├── README.md                   # User-facing docs
└── LICENSE                     # MIT
```

## Implementation Notes

- **No external dependencies** beyond `better-sqlite3` (already available in OpenClaw's Node environment). If not available, fall back to `sql.js` (pure JS SQLite).
- **Scoring is synchronous** — must be fast (<2ms). No LLM calls for classification.
- **Config schema** uses TypeBox (OpenClaw's schema library) for validation.
- **Dashboard** is a single inlined HTML string — no build tooling, no asset serving.
- **Stats DB** auto-creates on first use. Path configurable.
- **Retention** — old decisions pruned on startup and every 6 hours.
- **Thread safety** — SQLite in WAL mode, single-writer is fine for our use case.
