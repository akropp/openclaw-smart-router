/**
 * Returns a self-contained HTML dashboard string for the smart-router plugin.
 * No external dependencies, inline CSS + JS, auto-refreshes every 30s.
 */
export function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Smart Router Dashboard</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f1117; --surface: #1a1d27; --border: #2d3142;
    --text: #e2e8f0; --muted: #8892a4; --accent: #6c8df0;
    --green: #4ade80; --yellow: #facc15; --red: #f87171; --purple: #c084fc;
    --font: 'Segoe UI', system-ui, sans-serif; --mono: 'Cascadia Code', 'Fira Code', monospace;
  }
  body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; padding: 24px; min-height: 100vh; }
  h1 { font-size: 22px; font-weight: 700; color: var(--accent); margin-bottom: 4px; }
  .subtitle { color: var(--muted); font-size: 12px; margin-bottom: 24px; }
  .grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); margin-bottom: 24px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
  .card-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 12px; }
  .stat-value { font-size: 32px; font-weight: 700; color: var(--text); }
  .stat-label { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .tier-bar { display: flex; height: 28px; border-radius: 6px; overflow: hidden; margin-bottom: 10px; }
  .tier-seg { display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; min-width: 30px; transition: flex 0.4s; }
  .tier-trivial { background: var(--green); color: #000; }
  .tier-standard { background: var(--accent); color: #fff; }
  .tier-complex { background: var(--red); color: #fff; }
  .tier-code { background: var(--purple); color: #fff; }
  .tier-legend { display: flex; flex-wrap: wrap; gap: 8px; }
  .badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 2px 8px; border-radius: 20px; background: var(--border); }
  .badge-dot { width: 8px; height: 8px; border-radius: 50%; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; padding: 6px 10px; border-bottom: 1px solid var(--border); color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; }
  td { padding: 7px 10px; border-bottom: 1px solid var(--border); color: var(--text); }
  tr:last-child td { border-bottom: none; }
  .score-cell { font-family: var(--mono); font-size: 11px; }
  .tier-chip { display: inline-block; padding: 1px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; }
  .tc-trivial { background: rgba(74,222,128,.15); color: var(--green); }
  .tc-standard { background: rgba(108,141,240,.15); color: var(--accent); }
  .tc-complex { background: rgba(248,113,113,.15); color: var(--red); }
  .tc-code { background: rgba(192,132,252,.15); color: var(--purple); }
  .histogram { display: flex; align-items: flex-end; gap: 4px; height: 80px; }
  .hist-col { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
  .hist-bar { width: 100%; background: var(--accent); border-radius: 3px 3px 0 0; transition: height 0.4s; min-height: 2px; }
  .hist-label { font-size: 10px; color: var(--muted); white-space: nowrap; }
  textarea { width: 100%; height: 160px; background: #0a0c14; border: 1px solid var(--border); color: var(--text); font-family: var(--mono); font-size: 12px; padding: 10px; border-radius: 6px; resize: vertical; outline: none; }
  textarea:focus { border-color: var(--accent); }
  button { background: var(--accent); color: #fff; border: none; padding: 8px 18px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; transition: opacity 0.2s; }
  button:hover { opacity: 0.85; }
  button.danger { background: var(--red); }
  .exp-row { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; margin-bottom: 8px; }
  .exp-info { flex: 1; }
  .exp-name { font-weight: 600; font-size: 13px; }
  .exp-meta { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .status-active { color: var(--green); }
  .status-paused { color: var(--yellow); }
  .status-completed { color: var(--muted); }
  .refresh-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .refresh-indicator { width: 8px; height: 8px; border-radius: 50%; background: var(--green); }
  .refresh-indicator.stale { background: var(--muted); }
  .last-refresh { font-size: 12px; color: var(--muted); }
  .section-title { font-size: 16px; font-weight: 600; margin: 24px 0 12px; }
  .full-card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 18px; margin-bottom: 20px; }
  .flex-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .form-field { display: flex; flex-direction: column; gap: 4px; }
  .form-field label { font-size: 11px; color: var(--muted); }
  .form-field input, .form-field select { background: #0a0c14; border: 1px solid var(--border); color: var(--text); padding: 6px 10px; border-radius: 6px; font-size: 13px; outline: none; }
  .form-field input:focus, .form-field select:focus { border-color: var(--accent); }
  .msg { padding: 8px 12px; border-radius: 6px; font-size: 12px; margin-top: 8px; }
  .msg-ok { background: rgba(74,222,128,.12); color: var(--green); }
  .msg-err { background: rgba(248,113,113,.12); color: var(--red); }
  .model-text { font-family: var(--mono); font-size: 11px; color: var(--muted); }
  .empty-state { color: var(--muted); font-size: 13px; text-align: center; padding: 24px; }
</style>
</head>
<body>

<h1>&#x2728; Smart Router</h1>
<p class="subtitle">OpenClaw Intelligent Routing &mdash; Auto-routing prompts to cost-effective models</p>

<div class="refresh-bar">
  <div class="refresh-indicator" id="refreshDot"></div>
  <span class="last-refresh" id="lastRefreshLabel">Loading&hellip;</span>
  <button onclick="loadAll()">Refresh now</button>
</div>

<!-- KPI cards -->
<div class="grid" id="kpiGrid">
  <div class="card">
    <div class="card-title">Total Requests (24h)</div>
    <div class="stat-value" id="kpiTotal">&mdash;</div>
    <div class="stat-label">routing decisions</div>
  </div>
  <div class="card">
    <div class="card-title">Avg Complexity Score</div>
    <div class="stat-value" id="kpiAvgScore">&mdash;</div>
    <div class="stat-label">0.0 = trivial &rarr; 1.0 = complex</div>
  </div>
  <div class="card">
    <div class="card-title">Cost Optimization</div>
    <div class="stat-value" id="kpiOptimized">&mdash;</div>
    <div class="stat-label">% below complex tier</div>
  </div>
  <div class="card">
    <div class="card-title">Active Experiments</div>
    <div class="stat-value" id="kpiExperiments">&mdash;</div>
    <div class="stat-label">A/B tests running</div>
  </div>
</div>

<!-- Tier distribution -->
<div class="full-card">
  <div class="card-title">Tier Distribution</div>
  <div class="tier-bar" id="tierBar">
    <div class="tier-seg tier-trivial" id="seg-trivial" style="flex:1">?</div>
    <div class="tier-seg tier-standard" id="seg-standard" style="flex:1">?</div>
    <div class="tier-seg tier-complex" id="seg-complex" style="flex:1">?</div>
    <div class="tier-seg tier-code" id="seg-code" style="flex:1">?</div>
  </div>
  <div class="tier-legend">
    <span class="badge"><span class="badge-dot" style="background:var(--green)"></span>trivial</span>
    <span class="badge"><span class="badge-dot" style="background:var(--accent)"></span>standard</span>
    <span class="badge"><span class="badge-dot" style="background:var(--red)"></span>complex</span>
    <span class="badge"><span class="badge-dot" style="background:var(--purple)"></span>code</span>
  </div>
</div>

<!-- Score histogram -->
<div class="full-card">
  <div class="card-title">Score Distribution</div>
  <div class="histogram" id="histogram">
    <div class="hist-col"><div class="hist-bar" id="hb0" style="height:2px"></div><div class="hist-label">0.0-0.2</div></div>
    <div class="hist-col"><div class="hist-bar" id="hb1" style="height:2px"></div><div class="hist-label">0.2-0.5</div></div>
    <div class="hist-col"><div class="hist-bar" id="hb2" style="height:2px"></div><div class="hist-label">0.5-0.8</div></div>
    <div class="hist-col"><div class="hist-bar" id="hb3" style="height:2px"></div><div class="hist-label">0.8-1.0</div></div>
  </div>
</div>

<!-- Recent decisions -->
<div class="section-title">Recent Decisions</div>
<div class="full-card" style="overflow-x:auto;">
  <table>
    <thead><tr>
      <th>#</th><th>Agent</th><th>Score</th><th>Tier</th><th>Model</th><th>Preview</th>
    </tr></thead>
    <tbody id="decisionsBody">
      <tr><td colspan="6" class="empty-state">Loading&hellip;</td></tr>
    </tbody>
  </table>
</div>

<!-- Config editor -->
<div class="section-title">Config (Hot-Patch)</div>
<div class="full-card">
  <div class="card-title">Edit and save to hot-patch runtime config (resets on restart)</div>
  <textarea id="configEditor" placeholder="Loading config&hellip;"></textarea>
  <div style="margin-top:10px; display:flex; gap:8px; align-items:center;">
    <button onclick="applyConfig()">Apply (live only)</button>
    <button onclick="persistConfig()" style="background:var(--green);color:#000;">Save to disk</button>
    <div id="configMsg"></div>
  </div>
</div>

<!-- Experiments -->
<div class="section-title">A/B Experiments</div>
<div class="full-card">
  <div id="experimentsList"><div class="empty-state">Loading&hellip;</div></div>
  <div style="margin-top:16px; border-top:1px solid var(--border); padding-top:16px;">
    <div class="card-title" style="margin-bottom:12px;">Create New Experiment</div>
    <div class="flex-row" style="margin-bottom:10px;">
      <div class="form-field">
        <label>Name</label>
        <input id="expName" placeholder="e.g. opus-vs-gpt54-complex" style="width:220px">
      </div>
      <div class="form-field">
        <label>Tier</label>
        <select id="expTier">
          <option value="trivial">trivial</option>
          <option value="standard">standard</option>
          <option value="complex" selected>complex</option>
          <option value="code">code</option>
        </select>
      </div>
      <div class="form-field">
        <label>Traffic % (treatment)</label>
        <input id="expTraffic" type="number" min="0.01" max="1" step="0.05" value="0.2" style="width:90px">
      </div>
    </div>
    <div class="flex-row" style="margin-bottom:12px;">
      <div class="form-field">
        <label>Control Model</label>
        <input id="expControl" placeholder="anthropic/claude-opus-4-6" style="width:280px">
      </div>
      <div class="form-field">
        <label>Treatment Model</label>
        <input id="expTreatment" placeholder="openai-codex/gpt-5.4" style="width:280px">
      </div>
    </div>
    <button onclick="createExperiment()">Create Experiment</button>
    <div id="expMsg"></div>
  </div>
</div>

<script>
const BASE = '/smart-router';
let refreshTimer;

async function apiFetch(path, opts) {
  const r = await fetch(BASE + path, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function loadStats() {
  try {
    const s = await apiFetch('/stats?period=24h');
    document.getElementById('kpiTotal').textContent = s.total.toLocaleString();
    document.getElementById('kpiAvgScore').textContent = s.avgScore.toFixed(3);
    const nonComplex = (s.byTier.trivial || 0) + (s.byTier.standard || 0) + (s.byTier.code || 0);
    document.getElementById('kpiOptimized').textContent = s.total > 0
      ? Math.round(nonComplex / s.total * 100) + '%' : '--';

    // Tier bar
    const total = s.total || 1;
    const tiers = ['trivial', 'standard', 'complex', 'code'];
    for (const t of tiers) {
      const el = document.getElementById('seg-' + t);
      const cnt = s.byTier[t] || 0;
      el.style.flex = String(cnt + 0.001);
      el.textContent = cnt > 0 ? t[0].toUpperCase() + ':' + cnt : '';
    }

    // Histogram
    const dist = s.scoreDistribution || {};
    const keys = ['0.0-0.2', '0.2-0.5', '0.5-0.8', '0.8-1.0'];
    const maxVal = Math.max(1, ...keys.map(k => dist[k] || 0));
    keys.forEach((k, i) => {
      const bar = document.getElementById('hb' + i);
      bar.style.height = Math.max(2, Math.round((dist[k] || 0) / maxVal * 76)) + 'px';
      bar.title = k + ': ' + (dist[k] || 0);
    });
  } catch(e) { console.error('stats load error', e); }
}

async function loadDecisions() {
  try {
    const rows = await apiFetch('/decisions?limit=20');
    const tbody = document.getElementById('decisionsBody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No decisions yet</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((d, i) => {
      const tierCls = 'tc-' + d.tier;
      const score = typeof d.complexityScore === 'number' ? d.complexityScore.toFixed(3) : '--';
      const preview = d.promptPreview ? escHtml(d.promptPreview.slice(0, 60)) : '';
      const model = d.modelChosen ? escHtml(d.modelChosen.split('/').pop() || d.modelChosen) : '--';
      return '<tr>' +
        '<td>' + (i+1) + '</td>' +
        '<td>' + escHtml(d.agentId || '--') + '</td>' +
        '<td class="score-cell">' + score + '</td>' +
        '<td><span class="tier-chip ' + tierCls + '">' + d.tier + '</span></td>' +
        '<td class="model-text">' + model + '</td>' +
        '<td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + preview + '</td>' +
      '</tr>';
    }).join('');
  } catch(e) { console.error('decisions load error', e); }
}

async function loadConfig() {
  try {
    const cfg = await apiFetch('/config');
    document.getElementById('configEditor').value = JSON.stringify(cfg, null, 2);
  } catch(e) { console.error('config load error', e); }
}

async function loadExperiments() {
  try {
    const exps = await apiFetch('/experiments');
    const el = document.getElementById('experimentsList');
    document.getElementById('kpiExperiments').textContent = exps.filter(e => e.status === 'active').length;
    if (!exps.length) {
      el.innerHTML = '<div class="empty-state">No experiments yet</div>';
      return;
    }
    el.innerHTML = exps.map(e => {
      const statusCls = 'status-' + e.status;
      return '<div class="exp-row">' +
        '<div class="exp-info">' +
          '<div class="exp-name">' + escHtml(e.name) + '</div>' +
          '<div class="exp-meta">Tier: <strong>' + e.tier + '</strong> &bull; ' +
            'Control: <code>' + escHtml(e.controlModel) + '</code> vs Treatment: <code>' + escHtml(e.treatmentModel) + '</code> &bull; ' +
            'Traffic: ' + Math.round(e.trafficPct * 100) + '% treatment &bull; ' +
            'Status: <span class="' + statusCls + '">' + e.status + '</span>' +
          '</div>' +
        '</div>' +
        (e.status === 'active'
          ? '<button class="danger" onclick="stopExp(&quot;' + e.id + '&quot;)">Stop</button>'
          : '') +
      '</div>';
    }).join('');
  } catch(e) { console.error('experiments load error', e); }
}

async function applyConfig() {
  const msgEl = document.getElementById('configMsg');
  try {
    const patch = JSON.parse(document.getElementById('configEditor').value);
    await apiFetch('/config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(patch) });
    msgEl.className = 'msg msg-ok';
    msgEl.textContent = 'Applied (live only — resets on restart)';
    setTimeout(() => msgEl.textContent = '', 4000);
  } catch(e) {
    msgEl.className = 'msg msg-err';
    msgEl.textContent = 'Error: ' + e.message;
  }
}

async function persistConfig() {
  const msgEl = document.getElementById('configMsg');
  try {
    const patch = JSON.parse(document.getElementById('configEditor').value);
    const r = await apiFetch('/config?persist=true', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(patch) });
    if (r.persisted) {
      msgEl.className = 'msg msg-ok';
      msgEl.textContent = 'Saved to openclaw.json \\u2714';
    } else {
      msgEl.className = 'msg msg-err';
      msgEl.textContent = 'Applied in memory but failed to write to disk: ' + (r.warning || 'unknown error');
    }
    setTimeout(() => msgEl.textContent = '', 5000);
  } catch(e) {
    msgEl.className = 'msg msg-err';
    msgEl.textContent = 'Error: ' + e.message;
  }
}

async function createExperiment() {
  const msgEl = document.getElementById('expMsg');
  try {
    const body = {
      name: document.getElementById('expName').value,
      tier: document.getElementById('expTier').value,
      controlModel: document.getElementById('expControl').value,
      treatmentModel: document.getElementById('expTreatment').value,
      trafficPct: parseFloat(document.getElementById('expTraffic').value),
    };
    await apiFetch('/experiments', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    msgEl.className = 'msg msg-ok';
    msgEl.textContent = 'Experiment created!';
    setTimeout(() => msgEl.textContent = '', 3000);
    loadExperiments();
  } catch(e) {
    msgEl.className = 'msg msg-err';
    msgEl.textContent = 'Error: ' + e.message;
  }
}

async function stopExp(id) {
  try {
    await apiFetch('/experiments/' + id + '/stop', { method: 'POST' });
    loadExperiments();
  } catch(e) { alert('Error stopping experiment: ' + e.message); }
}

async function loadAll() {
  document.getElementById('refreshDot').className = 'refresh-indicator stale';
  await Promise.allSettled([loadStats(), loadDecisions(), loadConfig(), loadExperiments()]);
  document.getElementById('refreshDot').className = 'refresh-indicator';
  document.getElementById('lastRefreshLabel').textContent = 'Last refresh: ' + new Date().toLocaleTimeString();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(loadAll, 30000);
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

loadAll();
</script>
</body>
</html>`;
}
