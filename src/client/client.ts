(function () {
  if ((window as any).__REVERSE_LOGGER_INITIALIZED__) {
    return;
  }
  (window as any).__REVERSE_LOGGER_INITIALIZED__ = true;

  // Session ID Management
  function getSessionId(): string {
    const key = '__rl_session_id__';
    try {
      if (typeof sessionStorage !== 'undefined') {
        let sid = sessionStorage.getItem(key);
        if (!sid) {
          sid = 's_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
          sessionStorage.setItem(key, sid);
        }
        return sid;
      }
    } catch {
      // ignore
    }
    if (!(window as any).__RL_SESSION_ID__) {
      (window as any).__RL_SESSION_ID__ = 's_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
    }
    return (window as any).__RL_SESSION_ID__;
  }

  const sessionId = getSessionId();

  // Local Storage Starred Items helper
  function getLocalStarredSet(): Set<string> {
    try {
      const data = localStorage.getItem('__rl_starred_logs__');
      if (data) return new Set(JSON.parse(data));
    } catch {
      // ignore
    }
    return new Set();
  }

  function saveLocalStarredSet(set: Set<string>) {
    try {
      localStorage.setItem('__rl_starred_logs__', JSON.stringify(Array.from(set)));
    } catch {
      // ignore
    }
  }

  const localStarred = getLocalStarredSet();

  // Script config & token extraction
  function getScriptConfig(): { origin: string; token?: string } {
    let origin = window.location.origin;
    let token: string | undefined;

    if (document.currentScript) {
      const el = document.currentScript as HTMLScriptElement;
      if (el.src) {
        try {
          const parsed = new URL(el.src);
          origin = parsed.origin;
          const tokenParam = parsed.searchParams.get('token');
          if (tokenParam) token = tokenParam;
        } catch {
          // fallback
        }
      }
      const dataToken = el.getAttribute('data-token');
      if (dataToken) token = dataToken;
    }

    return { origin, token };
  }

  const config = getScriptConfig();
  const apiEndpoint = `${config.origin}/api/logs`;
  const authToken = config.token;

  let isConnected = false;
  let isSending = false;
  let isPaused = false;
  const queue: any[] = [];
  const MAX_QUEUE_SIZE = 5000;
  const BATCH_SIZE = 100;
  const MAX_STRING_LEN = 500000;

  // Throttled UI overlay updates (max once per animation frame)
  let overlayUpdateScheduled = false;
  function scheduleOverlayUpdate() {
    if (overlayUpdateScheduled) return;
    overlayUpdateScheduled = true;
    const requestFrame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: () => void) => setTimeout(cb, 16);

    requestFrame(() => {
      overlayUpdateScheduled = false;
      updateOverlayUI();
    });
  }

  // Internal captured logs array for browser overlay UI
  const localLogs: any[] = [];
  let logIdCounter = 1;
  let warnCount = 0;
  let errorCount = 0;

  function safeSerialize(obj: any): any {
    const cache = new WeakSet();
    const jsonStr = JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (cache.has(value)) {
          return '[Circular]';
        }
        cache.add(value);
      }
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }
      if (typeof Element !== 'undefined' && value instanceof Element) {
        return `<${value.tagName.toLowerCase()}${value.id ? '#' + value.id : ''}${value.className ? '.' + String(value.className).replace(/\s+/g, '.') : ''}>`;
      }
      if (typeof value === 'function') {
        return `[Function: ${value.name || 'anonymous'}]`;
      }
      if (typeof value === 'string' && value.length > MAX_STRING_LEN) {
        return value.substring(0, MAX_STRING_LEN) + '... [truncated]';
      }
      return value;
    });

    return JSON.parse(jsonStr);
  }

  function extractStack(args: any[]): string | undefined {
    for (const arg of args) {
      if (arg instanceof Error && arg.stack) {
        return arg.stack;
      }
    }
    const stackErr = new Error();
    if (stackErr.stack) {
      const lines = stackErr.stack.split('\n');
      const filtered = lines.filter((line) => !line.includes('client.js') && !line.includes('safeSerialize'));
      return filtered.join('\n');
    }
    return undefined;
  }

  let flushTimer: any = null;

  function enqueuePayload(payload: any) {
    if (queue.length >= MAX_QUEUE_SIZE) {
      queue.shift();
    }
    queue.push(payload);
    scheduleFlush();
  }

  function scheduleFlush(delay: number = 0) {
    if (isSending || queue.length === 0) return;
    if (delay === 0) {
      flushQueue();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushQueue();
      }, delay);
    }
  }

  function flushQueue() {
    if (isSending || queue.length === 0 || typeof fetch !== 'function') {
      return;
    }
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }

    isSending = true;

    const batch = queue.slice(0, BATCH_SIZE);
    const bodyPayload = batch.length === 1 ? batch[0] : { logs: batch };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    fetch(apiEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
      mode: 'cors',
      keepalive: true,
    })
      .then((res) => {
        if (res.ok || res.status === 400) {
          isConnected = true;
          queue.splice(0, batch.length);
          scheduleOverlayUpdate();
        } else {
          isConnected = false;
          scheduleOverlayUpdate();
        }
      })
      .catch(() => {
        isConnected = false;
        scheduleOverlayUpdate();
      })
      .finally(() => {
        isSending = false;
        if (queue.length > 0) {
          scheduleFlush(50);
        }
      });
  }

  function captureLog(level: string, rawArgs: any[], extra?: { message?: string; starred?: boolean; source?: string }) {
    try {
      const serializedArgs = rawArgs.map((arg) => safeSerialize(arg));
      const stack = extractStack(rawArgs);

      let msg = extra?.message;
      if (!msg) {
        msg = rawArgs
          .map((a) => (typeof a === 'object' ? JSON.stringify(safeSerialize(a)) : String(a)))
          .join(' ');
      }

      const isStarred = Boolean(extra?.starred);
      const source = extra?.source || (level === 'special' ? 'reverseLogger' : 'console');

      const logItem = {
        id: logIdCounter++,
        timestamp: new Date().toISOString(),
        level: level.toLowerCase(),
        message: msg,
        args: serializedArgs,
        url: typeof window !== 'undefined' ? window.location.href : '',
        stack,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        sessionId,
        starred: isStarred,
        source,
      };

      if (level.toLowerCase() === 'warn') warnCount++;
      if (level.toLowerCase() === 'error') errorCount++;

      if (!isPaused) {
        localLogs.unshift(logItem);
        if (localLogs.length > 500) localLogs.pop();
      }

      scheduleOverlayUpdate();

      // Transmit payload
      enqueuePayload(logItem);
    } catch {
      // Ignore
    }
  }

  // Wrap console methods
  const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const originalConsole: Record<string, Function> = {};

  levels.forEach((level) => {
    if (typeof console[level] === 'function') {
      originalConsole[level] = console[level].bind(console);
      console[level] = function (...args: any[]) {
        try {
          originalConsole[level](...args);
        } catch {
          // ignore
        }
        captureLog(level, args);
      };
    }
  });

  // Public window.reverseLogger API
  const reverseLoggerApi = {
    log: (...args: any[]) => captureLog('log', args),
    info: (...args: any[]) => captureLog('info', args),
    warn: (...args: any[]) => captureLog('warn', args),
    error: (...args: any[]) => captureLog('error', args),
    debug: (...args: any[]) => captureLog('debug', args),
    star: (message: string, ...args: any[]) => {
      const allArgs = args.length > 0 ? [message, ...args] : [message];
      captureLog('special', allArgs, {
        message: String(message),
        starred: true,
        source: 'reverseLogger',
      });
    },
    clear: () => {
      localLogs.length = 0;
      warnCount = 0;
      errorCount = 0;
      updateOverlayUI();
    },
    pause: () => {
      isPaused = true;
      updateOverlayUI();
    },
    resume: () => {
      isPaused = false;
      updateOverlayUI();
    },
    isConnected: () => isConnected,
  };

  (window as any).reverseLogger = reverseLoggerApi;

  // --- Shadow DOM Developer Overlay ---
  let shadowRoot: ShadowRoot | null = null;
  let badgeEl: HTMLElement | null = null;
  let panelEl: HTMLElement | null = null;
  let isPanelOpen = false;
  let searchFilter = '';
  let levelFilter = 'ALL';
  let tabFilter = 'ALL'; // ALL | STARRED | ERRORS
  let expandedLogId: number | null = null;

  function initShadowOverlay() {
    if (typeof document === 'undefined' || !document.body) {
      return;
    }

    const host = document.createElement('div');
    host.id = '__rl_overlay_host__';
    host.style.cssText = 'position:fixed; z-index:2147483647; pointer-events:none; top:0; left:0; width:100%; height:100%;';
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, sans-serif; }
      .rl-badge {
        position: fixed;
        bottom: 16px;
        right: 16px;
        pointer-events: auto;
        background: #1e293b;
        color: #f8fafc;
        border: 1px solid #334155;
        border-radius: 20px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        user-select: none;
        transition: transform 0.2s, background-color 0.2s;
      }
      .rl-badge:hover { transform: translateY(-2px); background: #334155; }
      .rl-status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
      .rl-status-dot.online { background: #4ade80; box-shadow: 0 0 6px #4ade80; }
      .rl-status-dot.offline { background: #94a3b8; }
      .rl-panel {
        position: fixed;
        bottom: 60px;
        right: 16px;
        width: 440px;
        max-width: calc(100vw - 32px);
        height: 520px;
        max-height: calc(100vh - 80px);
        background: #0f172a;
        color: #f8fafc;
        border: 1px solid #334155;
        border-radius: 12px;
        pointer-events: auto;
        display: none;
        flex-direction: column;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        overflow: hidden;
      }
      .rl-panel.open { display: flex; }
      .rl-header {
        padding: 10px 14px;
        background: #1e293b;
        border-bottom: 1px solid #334155;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .rl-title { font-weight: 700; font-size: 13px; color: #38bdf8; display: flex; align-items: center; gap: 6px; }
      .rl-tabs { display: flex; gap: 4px; padding: 8px 14px; background: #0f172a; border-bottom: 1px solid #1e293b; }
      .rl-tab {
        background: none;
        border: none;
        color: #94a3b8;
        padding: 4px 10px;
        font-size: 11px;
        font-weight: 600;
        border-radius: 4px;
        cursor: pointer;
      }
      .rl-tab.active { background: #38bdf8; color: #0f172a; }
      .rl-controls { padding: 8px 14px; display: flex; gap: 6px; background: #0f172a; border-bottom: 1px solid #1e293b; }
      .rl-input, .rl-select, .rl-btn {
        background: #1e293b;
        color: #f8fafc;
        border: 1px solid #334155;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 11px;
      }
      .rl-input { flex: 1; }
      .rl-btn { cursor: pointer; font-weight: 600; }
      .rl-btn:hover { background: #334155; }
      .rl-list { flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 4px; }
      .rl-item {
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 11px;
        cursor: pointer;
      }
      .rl-item:hover { border-color: #38bdf8; }
      .rl-item-row { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
      .rl-item-meta { display: flex; align-items: center; gap: 6px; }
      .rl-badge-lbl { padding: 1px 5px; border-radius: 3px; font-weight: 700; font-size: 9px; text-transform: uppercase; }
      .rl-lbl-error { background: rgba(248, 113, 113, 0.2); color: #f87171; }
      .rl-lbl-warn { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
      .rl-lbl-info { background: rgba(56, 189, 248, 0.2); color: #38bdf8; }
      .rl-lbl-log { background: rgba(74, 222, 128, 0.2); color: #4ade80; }
      .rl-lbl-special { background: rgba(192, 132, 252, 0.2); color: #c084fc; }
      .rl-star-btn { background: none; border: none; color: #64748b; cursor: pointer; font-size: 12px; }
      .rl-star-btn.starred { color: #fbbf24; }
      .rl-details {
        margin-top: 6px;
        padding-top: 6px;
        border-top: 1px dashed #334155;
        font-size: 10px;
        color: #cbd5e1;
        display: none;
      }
      .rl-details.open { display: block; }
      .rl-code { background: #020617; padding: 6px; border-radius: 4px; overflow-x: auto; font-family: monospace; margin-top: 4px; }
    `;

    shadowRoot.appendChild(style);

    // Create Badge
    badgeEl = document.createElement('div');
    badgeEl.className = 'rl-badge';
    badgeEl.addEventListener('click', () => {
      isPanelOpen = !isPanelOpen;
      updateOverlayUI();
    });
    shadowRoot.appendChild(badgeEl);

    // Create Panel
    panelEl = document.createElement('div');
    panelEl.className = 'rl-panel';
    shadowRoot.appendChild(panelEl);

    updateOverlayUI();
  }

  function updateOverlayUI() {
    if (!shadowRoot) return;

    // Render Badge
    if (badgeEl) {
      badgeEl.innerHTML = '';
      const dot = document.createElement('span');
      dot.className = `rl-status-dot ${isConnected ? 'online' : 'offline'}`;
      badgeEl.appendChild(dot);

      const label = document.createElement('span');
      label.textContent = `RL ${localLogs.length}${warnCount > 0 ? '  ⚠ ' + warnCount : ''}${errorCount > 0 ? '  ✕ ' + errorCount : ''}`;
      badgeEl.appendChild(label);
    }

    // Render Panel
    if (panelEl) {
      panelEl.className = `rl-panel ${isPanelOpen ? 'open' : ''}`;
      if (!isPanelOpen) {
        panelEl.innerHTML = '';
        return;
      }
      panelEl.innerHTML = '';

      // Header
      const header = document.createElement('div');
      header.className = 'rl-header';

      const title = document.createElement('div');
      title.className = 'rl-title';
      title.textContent = '⚡ Reverse Logger';
      header.appendChild(title);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'rl-btn';
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', () => {
        isPanelOpen = false;
        updateOverlayUI();
      });
      header.appendChild(closeBtn);
      panelEl.appendChild(header);

      // Tabs
      const tabs = document.createElement('div');
      tabs.className = 'rl-tabs';

      ['ALL', 'STARRED', 'ERRORS'].forEach((t) => {
        const tabBtn = document.createElement('button');
        tabBtn.className = `rl-tab ${tabFilter === t ? 'active' : ''}`;
        tabBtn.textContent = t;
        tabBtn.addEventListener('click', () => {
          tabFilter = t;
          updateOverlayUI();
        });
        tabs.appendChild(tabBtn);
      });
      panelEl.appendChild(tabs);

      // Controls Bar
      const controls = document.createElement('div');
      controls.className = 'rl-controls';

      const searchInput = document.createElement('input');
      searchInput.className = 'rl-input';
      searchInput.placeholder = 'Search logs...';
      searchInput.value = searchFilter;
      searchInput.addEventListener('input', (e) => {
        searchFilter = (e.target as HTMLInputElement).value;
        updateOverlayUI();
      });
      controls.appendChild(searchInput);

      const levelSel = document.createElement('select');
      levelSel.className = 'rl-select';
      ['ALL', 'LOG', 'INFO', 'WARN', 'ERROR', 'SPECIAL'].forEach((lvl) => {
        const opt = document.createElement('option');
        opt.value = lvl;
        opt.textContent = lvl;
        if (levelFilter === lvl) opt.selected = true;
        levelSel.appendChild(opt);
      });
      levelSel.addEventListener('change', (e) => {
        levelFilter = (e.target as HTMLSelectElement).value;
        updateOverlayUI();
      });
      controls.appendChild(levelSel);

      const pauseBtn = document.createElement('button');
      pauseBtn.className = 'rl-btn';
      pauseBtn.textContent = isPaused ? '▶' : '⏸';
      pauseBtn.addEventListener('click', () => {
        isPaused = !isPaused;
        updateOverlayUI();
      });
      controls.appendChild(pauseBtn);

      const clearBtn = document.createElement('button');
      clearBtn.className = 'rl-btn';
      clearBtn.textContent = 'Clear';
      clearBtn.addEventListener('click', () => {
        reverseLoggerApi.clear();
      });
      controls.appendChild(clearBtn);

      panelEl.appendChild(controls);

      // Log Items List
      const listEl = document.createElement('div');
      listEl.className = 'rl-list';

      const filtered = localLogs.filter((log) => {
        if (tabFilter === 'STARRED' && !log.starred && !localStarred.has(String(log.id))) return false;
        if (tabFilter === 'ERRORS' && log.level !== 'error') return false;
        if (levelFilter !== 'ALL' && log.level.toUpperCase() !== levelFilter) return false;
        if (searchFilter.trim()) {
          const q = searchFilter.toLowerCase();
          const msgMatch = log.message && log.message.toLowerCase().includes(q);
          const urlMatch = log.url && log.url.toLowerCase().includes(q);
          if (!msgMatch && !urlMatch) return false;
        }
        return true;
      });

      const MAX_RENDERED = 100;
      const visible = filtered.slice(0, MAX_RENDERED);

      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding: 20px; text-align: center; color: #94a3b8; font-size: 11px;';
        empty.textContent = 'No captured logs matching filters.';
        listEl.appendChild(empty);
      } else {
        visible.forEach((log) => {
          const isStarred = log.starred || localStarred.has(String(log.id));
          const item = document.createElement('div');
          item.className = 'rl-item';

          const row = document.createElement('div');
          row.className = 'rl-item-row';

          const meta = document.createElement('div');
          meta.className = 'rl-item-meta';

          const starBtn = document.createElement('button');
          starBtn.className = `rl-star-btn ${isStarred ? 'starred' : ''}`;
          starBtn.textContent = '★';
          starBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            log.starred = !log.starred;
            if (log.starred) localStarred.add(String(log.id));
            else localStarred.delete(String(log.id));
            saveLocalStarredSet(localStarred);
            updateOverlayUI();
          });
          meta.appendChild(starBtn);

          const badge = document.createElement('span');
          badge.className = `rl-badge-lbl rl-lbl-${log.level}`;
          badge.textContent = log.level;
          meta.appendChild(badge);

          const timeSpan = document.createElement('span');
          timeSpan.style.color = '#94a3b8';
          try {
            timeSpan.textContent = new Date(log.timestamp).toLocaleTimeString();
          } catch {
            timeSpan.textContent = log.timestamp;
          }
          meta.appendChild(timeSpan);

          const msgSpan = document.createElement('span');
          msgSpan.style.fontWeight = '600';
          msgSpan.textContent = log.message;
          meta.appendChild(msgSpan);

          row.appendChild(meta);
          item.appendChild(row);

          // Details View
          const isExpanded = expandedLogId === log.id;
          const details = document.createElement('div');
          details.className = `rl-details ${isExpanded ? 'open' : ''}`;

          if (isExpanded) {
            const urlDiv = document.createElement('div');
            urlDiv.textContent = `URL: ${log.url || 'N/A'}`;
            details.appendChild(urlDiv);

            const sidDiv = document.createElement('div');
            sidDiv.textContent = `Session: ${log.sessionId || 'N/A'}`;
            details.appendChild(sidDiv);

            if (log.isLarge) {
              const largeBadge = document.createElement('div');
              largeBadge.style.cssText = 'margin-top: 4px; padding: 4px 8px; background: rgba(234, 179, 8, 0.15); color: #eab308; border-radius: 4px; font-weight: 600; font-size: 10px; display: flex; align-items: center; justify-content: space-between;';

              const sizeStr = log.payloadSize ? (log.payloadSize / 1024).toFixed(1) + ' KB' : 'Large';
              const labelText = document.createElement('span');
              labelText.textContent = `📦 Large Payload (${sizeStr})`;
              largeBadge.appendChild(labelText);

              const loadBtn = document.createElement('button');
              loadBtn.className = 'rl-btn';
              loadBtn.style.fontSize = '9px';
              loadBtn.style.padding = '2px 6px';
              loadBtn.textContent = 'Load Full Payload';
              loadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                loadBtn.textContent = 'Loading...';
                const headers: Record<string, string> = {};
                if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
                fetch(`${apiEndpoint}/${log.id}/payload`, { headers })
                  .then((res) => res.json())
                  .then((d) => {
                    if (d.success && d.payload) {
                      log.message = d.payload.message;
                      log.args = d.payload.args;
                      if (d.payload.stack) log.stack = d.payload.stack;
                      log.isLarge = false;
                      updateOverlayUI();
                    }
                  })
                  .catch(() => {
                    loadBtn.textContent = 'Failed';
                  });
              });
              largeBadge.appendChild(loadBtn);
              details.appendChild(largeBadge);
            }

            const argsDiv = document.createElement('div');
            argsDiv.style.marginTop = '4px';
            argsDiv.textContent = 'Arguments:';
            details.appendChild(argsDiv);

            const code = document.createElement('pre');
            code.className = 'rl-code';
            code.textContent = JSON.stringify(log.args, null, 2);
            details.appendChild(code);

            if (log.stack) {
              const stackDiv = document.createElement('div');
              stackDiv.style.color = '#f87171';
              stackDiv.style.marginTop = '4px';
              stackDiv.textContent = 'Stack Trace:';
              details.appendChild(stackDiv);

              const stackCode = document.createElement('pre');
              stackCode.className = 'rl-code';
              stackCode.style.color = '#f87171';
              stackCode.textContent = log.stack;
              details.appendChild(stackCode);
            }
          }

          item.addEventListener('click', () => {
            expandedLogId = expandedLogId === log.id ? null : log.id;
            updateOverlayUI();
          });

          item.appendChild(details);
          listEl.appendChild(item);
        });

        if (filtered.length > MAX_RENDERED) {
          const capNotice = document.createElement('div');
          capNotice.style.cssText = 'padding: 6px; text-align: center; color: #94a3b8; font-size: 10px; font-style: italic;';
          capNotice.textContent = `Showing 100 of ${filtered.length} captured logs`;
          listEl.appendChild(capNotice);
        }
      }

      panelEl.appendChild(listEl);
    }
  }

  // Keyboard shortcut listener (Cmd/Ctrl + Shift + L)
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        const active = document.activeElement;
        if (
          active &&
          (active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            (active as HTMLElement).isContentEditable)
        ) {
          return; // Ignore inside typing elements
        }
        e.preventDefault();
        isPanelOpen = !isPanelOpen;
        updateOverlayUI();
      }
    });
  }

  // Init overlay on DOM ready
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initShadowOverlay);
    } else {
      initShadowOverlay();
    }
  }

  // Periodic flush
  setInterval(flushQueue, 5000);
})();
