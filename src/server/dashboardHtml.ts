export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reverse Logger Dashboard</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --border: #334155;
      --accent: #38bdf8;
      --star: #fbbf24;
      --error: #f87171;
      --warn: #fbbf24;
      --info: #38bdf8;
      --log: #4ade80;
      --special: #c084fc;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #f8fafc;
        --card-bg: #ffffff;
        --text: #0f172a;
        --text-muted: #64748b;
        --border: #e2e8f0;
        --accent: #0284c7;
        --star: #d97706;
        --error: #dc2626;
        --warn: #d97706;
        --info: #0284c7;
        --log: #16a34a;
        --special: #9333ea;
      }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 20px; line-height: 1.5; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 10px; }
    h1 { font-size: 1.5rem; display: flex; align-items: center; gap: 8px; }
    .tabs { display: flex; gap: 8px; background: var(--card-bg); padding: 4px; border-radius: 8px; border: 1px solid var(--border); }
    .tab { padding: 6px 16px; border-radius: 6px; border: none; background: none; color: var(--text-muted); font-weight: 600; cursor: pointer; }
    .tab.active { background: var(--accent); color: #fff; }
    .filters { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; background: var(--card-bg); padding: 14px; border-radius: 8px; border: 1px solid var(--border); }
    input, select, button { padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 0.9rem; }
    input:focus, select:focus { outline: 2px solid var(--accent); }
    .btn { cursor: pointer; background: var(--accent); color: #fff; border: none; font-weight: 600; }
    .btn-secondary { background: var(--card-bg); color: var(--text); border: 1px solid var(--border); }
    .log-list { display: flex; flexDirection: column; gap: 8px; }
    .log-item { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; transition: border-color 0.2s; }
    .log-item:hover { border-color: var(--accent); }
    .log-header { display: flex; justify-content: space-between; align-items: center; cursor: pointer; gap: 10px; flex-wrap: wrap; }
    .log-meta { display: flex; align-items: center; gap: 10px; font-size: 0.85rem; }
    .badge { padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 0.75rem; text-transform: uppercase; }
    .badge-error { background: rgba(248, 113, 113, 0.2); color: var(--error); }
    .badge-warn { background: rgba(251, 191, 36, 0.2); color: var(--warn); }
    .badge-info { background: rgba(56, 189, 248, 0.2); color: var(--info); }
    .badge-log { background: rgba(74, 222, 128, 0.2); color: var(--log); }
    .badge-special { background: rgba(192, 132, 252, 0.2); color: var(--special); }
    .star-btn { background: none; border: none; cursor: pointer; font-size: 1.2rem; color: var(--text-muted); padding: 0 4px; }
    .star-btn.starred { color: var(--star); }
    .log-details { margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border); display: none; font-size: 0.85rem; }
    .log-details.open { display: block; }
    pre { background: var(--bg); padding: 10px; border-radius: 6px; overflow-x: auto; font-family: monospace; margin-top: 6px; }
    .pagination { display: flex; justify-content: space-between; align-items: center; margin-top: 20px; }
  </style>
</head>
<body>
  <header>
    <h1>⚡ Reverse Logger Dashboard</h1>
    <div class="tabs">
      <button class="tab active" data-tab="all">All Logs</button>
      <button class="tab" data-tab="starred">⭐ Starred</button>
      <button class="tab" data-tab="errors">⚠️ Errors</button>
    </div>
  </header>

  <div class="filters">
    <input type="text" id="searchInput" placeholder="Search message, args, url, stack..." style="flex: 1; min-width: 200px;">
    <select id="levelSelect">
      <option value="">All Levels</option>
      <option value="log">LOG</option>
      <option value="info">INFO</option>
      <option value="warn">WARN</option>
      <option value="error">ERROR</option>
      <option value="special">SPECIAL</option>
    </select>
    <button class="btn" id="refreshBtn">Refresh</button>
  </div>

  <div class="log-list" id="logList">
    <div style="padding: 40px; text-align: center; color: var(--text-muted);">Loading logs...</div>
  </div>

  <div class="pagination">
    <button class="btn-secondary" id="prevBtn" disabled>← Previous</button>
    <span id="pageInfo" style="font-size: 0.9rem; color: var(--text-muted);">Page 1</span>
    <button class="btn-secondary" id="nextBtn" disabled>Next →</button>
  </div>

  <script>
    let currentTab = 'all';
    let offset = 0;
    const limit = 20;

    const tabs = document.querySelectorAll('.tab');
    const searchInput = document.getElementById('searchInput');
    const levelSelect = document.getElementById('levelSelect');
    const refreshBtn = document.getElementById('refreshBtn');
    const logList = document.getElementById('logList');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const pageInfo = document.getElementById('pageInfo');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentTab = tab.dataset.tab;
        offset = 0;
        fetchLogs();
      });
    });

    searchInput.addEventListener('input', debounce(() => { offset = 0; fetchLogs(); }, 300));
    levelSelect.addEventListener('change', () => { offset = 0; fetchLogs(); });
    refreshBtn.addEventListener('click', () => fetchLogs());
    prevBtn.addEventListener('click', () => { if (offset >= limit) { offset -= limit; fetchLogs(); } });
    nextBtn.addEventListener('click', () => { offset += limit; fetchLogs(); });

    function debounce(func, delay) {
      let timer;
      return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(this, args), delay);
      };
    }

    async function fetchLogs() {
      let url = \`/api/logs?limit=\${limit}&offset=\${offset}\`;

      if (currentTab === 'starred') {
        url += '&starred=true';
      } else if (currentTab === 'errors') {
        url += '&level=error';
      } else if (levelSelect.value) {
        url += \`&level=\${levelSelect.value}\`;
      }

      if (searchInput.value.trim()) {
        url += \`&q=\${encodeURIComponent(searchInput.value.trim())}\`;
      }

      try {
        const res = await fetch(url);
        const data = await res.json();
        renderLogs(data);
      } catch (err) {
        logList.innerHTML = \`<div style="padding: 20px; color: var(--error);">Failed to load logs: \${err.message}</div>\`;
      }
    }

    function renderLogs(data) {
      const { logs, total, limit, offset } = data;
      if (!logs || logs.length === 0) {
        logList.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--text-muted);">No logs found matching filter.</div>';
        pageInfo.textContent = '0 logs';
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
      }

      const totalPages = Math.ceil(total / limit);
      const currentPage = Math.floor(offset / limit) + 1;
      pageInfo.textContent = \`Page \${currentPage} of \${totalPages} (\${total} total)\`;
      prevBtn.disabled = offset === 0;
      nextBtn.disabled = offset + limit >= total;

      logList.innerHTML = logs.map(log => {
        const badgeClass = \`badge-\${log.level || 'info'}\`;
        const timeStr = new Date(log.timestamp).toLocaleString();
        const argsStr = escapeHtml(JSON.stringify(log.args, null, 2));

        return \`
          <div class="log-item">
            <div class="log-header" onclick="toggleDetails(\${log.id})">
              <div class="log-meta">
                <button class="star-btn \${log.starred ? 'starred' : ''}" onclick="event.stopPropagation(); toggleStar(\${log.id})">★</button>
                <span class="badge \${badgeClass}">\${escapeHtml(log.level)}</span>
                <span style="color: var(--text-muted);">\${timeStr}</span>
                <strong style="color: var(--text);">\${escapeHtml(log.message || '')}</strong>
              </div>
              <span style="font-size: 0.8rem; color: var(--text-muted);">\${escapeHtml(log.url || '')}</span>
            </div>
            <div class="log-details" id="details-\${log.id}">
              <div><strong>Session ID:</strong> \${escapeHtml(log.sessionId || 'N/A')}</div>
              <div><strong>Source:</strong> \${escapeHtml(log.source || 'console')}</div>
              <div style="margin-top: 6px;"><strong>Arguments:</strong></div>
              <pre>\${argsStr}</pre>
              \${log.stack ? \`<div style="margin-top: 6px; color: var(--error);"><strong>Stack Trace:</strong></div><pre style="color: var(--error);">\${escapeHtml(log.stack)}</pre>\` : ''}
              <div style="margin-top: 10px; display: flex; gap: 8px;">
                <button class="btn-secondary" onclick="copyLogData(\${log.id}, false)">Copy Text</button>
                <button class="btn-secondary" onclick="copyLogData(\${log.id}, true)">Copy JSON</button>
              </div>
            </div>
          </div>
        \`;
      }).join('');
    }

    function toggleDetails(id) {
      const el = document.getElementById('details-' + id);
      if (el) el.classList.toggle('open');
    }

    async function toggleStar(id) {
      try {
        const res = await fetch(\`/api/logs/\${id}/star\`, { method: 'POST' });
        if (res.ok) fetchLogs();
      } catch (err) {
        alert('Failed to toggle star');
      }
    }

    function copyLogData(id, asJson) {
      const log = currentLogs.find(l => l.id === id);
      if (!log) return;
      const text = asJson ? JSON.stringify(log, null, 2) : \`[\${log.timestamp}] [\${log.level.toUpperCase()}] \${log.message}\nURL: \${log.url || ''}\nArgs: \${JSON.stringify(log.args)}\`;
      navigator.clipboard.writeText(text);
      alert('Copied to clipboard!');
    }

    let currentLogs = [];
    const origRender = renderLogs;
    renderLogs = function(data) {
      currentLogs = data.logs || [];
      origRender(data);
    };

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    fetchLogs();
  </script>
</body>
</html>`;
}
