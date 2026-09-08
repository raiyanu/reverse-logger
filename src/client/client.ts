(function () {
  if ((window as any).__REVERSE_LOGGER_INITIALIZED__) {
    return;
  }
  (window as any).__REVERSE_LOGGER_INITIALIZED__ = true;

  // ─── Session ID Management ─────────────────────────────────────────────────
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

  // ─── Local Storage Starred Items ───────────────────────────────────────────
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

  // ─── Script Config & Token Extraction ──────────────────────────────────────
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

  // ─── State ─────────────────────────────────────────────────────────────────
  let isConnected = false;
  let isSending = false;
  let isPaused = false;
  const queue: any[] = [];
  const MAX_QUEUE_SIZE = 5000;
  const BATCH_SIZE = 100;
  const MAX_STRING_LEN = 500000;
  const MAX_OBJECT_KEYS = 100;
  const MAX_RECURSION_DEPTH = 6;

  // ─── Ring Buffer for Local Logs (O(1) push, no Array.unshift reindexing) ──
  const RING_CAPACITY = 300;
  const ringBuffer: any[] = new Array(RING_CAPACITY);
  let ringHead = 0;   // next write position
  let ringSize = 0;   // current number of items
  let ringVersion = 0; // monotonically increasing version to detect changes

  function ringPush(item: any) {
    ringBuffer[ringHead] = item;
    ringHead = (ringHead + 1) % RING_CAPACITY;
    if (ringSize < RING_CAPACITY) ringSize++;
    ringVersion++;
  }

  /** Get items in newest-first order. Returns a snapshot array. */
  function ringSnapshot(maxItems?: number): any[] {
    const count = maxItems ? Math.min(maxItems, ringSize) : ringSize;
    const result = new Array(count);
    for (let i = 0; i < count; i++) {
      // Walk backwards from head
      const idx = (ringHead - 1 - i + RING_CAPACITY * 2) % RING_CAPACITY;
      result[i] = ringBuffer[idx];
    }
    return result;
  }

  function ringClear() {
    ringHead = 0;
    ringSize = 0;
    ringVersion++;
  }

  let logIdCounter = 1;
  let warnCount = 0;
  let errorCount = 0;

  // ─── Fast Serializer (unchanged, proven performant) ────────────────────────
  function fastSerialize(obj: any, depth = 0, seen = new WeakSet()): any {
    if (obj === null || obj === undefined) {
      return obj;
    }
    const type = typeof obj;
    if (type === 'number' || type === 'boolean') {
      return obj;
    }
    if (type === 'string') {
      if (obj.length > MAX_STRING_LEN) {
        return obj.substring(0, MAX_STRING_LEN) + '... [truncated]';
      }
      return obj;
    }
    if (type === 'function') {
      return `[Function: ${obj.name || 'anonymous'}]`;
    }
    if (type === 'symbol') {
      return obj.toString();
    }
    if (type === 'bigint') {
      return obj.toString() + 'n';
    }

    if (depth > MAX_RECURSION_DEPTH) {
      return '[Max Depth Reached]';
    }

    if (typeof Element !== 'undefined' && obj instanceof Element) {
      return `<${obj.tagName.toLowerCase()}${obj.id ? '#' + obj.id : ''}${obj.className ? '.' + String(obj.className).replace(/\s+/g, '.') : ''}>`;
    }

    if (obj instanceof Error) {
      return {
        name: obj.name,
        message: obj.message,
        stack: obj.stack,
      };
    }

    if (seen.has(obj)) {
      return '[Circular]';
    }
    seen.add(obj);

    if (Array.isArray(obj)) {
      const arrLen = Math.min(obj.length, 100);
      const resArr: any[] = new Array(arrLen);
      for (let i = 0; i < arrLen; i++) {
        try {
          resArr[i] = fastSerialize(obj[i], depth + 1, seen);
        } catch {
          resArr[i] = '[Unserializable]';
        }
      }
      if (obj.length > 100) {
        resArr.push(`... +${obj.length - 100} more items`);
      }
      return resArr;
    }

    const resObj: Record<string, any> = {};
    const keys = Object.keys(obj);
    const keyCount = Math.min(keys.length, MAX_OBJECT_KEYS);
    for (let i = 0; i < keyCount; i++) {
      const k = keys[i];
      try {
        resObj[k] = fastSerialize(obj[k], depth + 1, seen);
      } catch {
        resObj[k] = '[Unserializable]';
      }
    }
    if (keys.length > MAX_OBJECT_KEYS) {
      resObj['__truncated_keys__'] = `+${keys.length - MAX_OBJECT_KEYS} more keys`;
    }
    return resObj;
  }

  function extractStack(args: any[], level: string): string | undefined {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg instanceof Error && arg.stack) {
        return arg.stack;
      }
    }
    if (level === 'error' || level === 'special') {
      const stackErr = new Error();
      if (stackErr.stack) {
        const lines = stackErr.stack.split('\n');
        const filtered = lines.filter((line) => !line.includes('client.js') && !line.includes('fastSerialize'));
        return filtered.join('\n');
      }
    }
    return undefined;
  }

  // ─── Network Queue (unchanged, already performant) ─────────────────────────
  let flushTimer: any = null;

  function enqueuePayload(payload: any) {
    if (queue.length >= MAX_QUEUE_SIZE) {
      queue.shift();
    }
    queue.push(payload);
    if (queue.length >= BATCH_SIZE) {
      scheduleFlush(0);
    } else {
      scheduleFlush(250);
    }
  }

  function scheduleFlush(delay: number = 250) {
    if (isSending || queue.length === 0) return;
    if (delay === 0) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
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
        } else {
          isConnected = false;
        }
      })
      .catch(() => {
        isConnected = false;
      })
      .finally(() => {
        isSending = false;
        if (queue.length > 0) {
          scheduleFlush(queue.length >= BATCH_SIZE ? 0 : 250);
        }
      });
  }

  // ─── Core Log Capture (DECOUPLED from UI — no overlay calls here) ─────────
  function captureLog(level: string, rawArgs: any[], extra?: { message?: string; starred?: boolean; source?: string }) {
    try {
      const normalizedLevel = level.toLowerCase();
      const serializedArgs = rawArgs.map((arg) => fastSerialize(arg));
      const stack = extractStack(rawArgs, normalizedLevel);

      let msg = extra?.message;
      if (!msg) {
        msg = serializedArgs
          .map((a) => {
            if (typeof a === 'string') return a;
            if (typeof a === 'object' && a !== null) {
              try {
                return JSON.stringify(a);
              } catch {
                return '[Object]';
              }
            }
            return String(a);
          })
          .join(' ');
      }

      const isStarred = Boolean(extra?.starred);
      const source = extra?.source || (normalizedLevel === 'special' ? 'reverseLogger' : 'console');

      const logItem = {
        id: logIdCounter++,
        timestamp: new Date().toISOString(),
        level: normalizedLevel,
        message: msg,
        args: serializedArgs,
        url: typeof window !== 'undefined' ? window.location.href : '',
        stack,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        sessionId,
        starred: isStarred,
        source,
      };

      if (normalizedLevel === 'warn') warnCount++;
      if (normalizedLevel === 'error') errorCount++;

      // Push to ring buffer (O(1), no array reindexing)
      if (!isPaused) {
        ringPush(logItem);
      }

      // Network transmit only — NO UI update calls here
      enqueuePayload(logItem);
    } catch {
      // Ignore
    }
  }

  // ─── Wrap Console Methods ──────────────────────────────────────────────────
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

  // ─── Public window.reverseLogger API ───────────────────────────────────────
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
      ringClear();
      warnCount = 0;
      errorCount = 0;
    },
    pause: () => {
      isPaused = true;
    },
    resume: () => {
      isPaused = false;
    },
    isConnected: () => isConnected,
  };

  (window as any).reverseLogger = reverseLoggerApi;

  // ─── Shadow DOM Overlay (Lazy Window-Mode Panel) ───────────────────────────
  let shadowRoot: ShadowRoot | null = null;
  let badgeEl: HTMLElement | null = null;
  let panelEl: HTMLElement | null = null;
  let isPanelOpen = false;
  let searchFilter = '';
  let levelFilter = 'ALL';
  let tabFilter = 'ALL'; // ALL | STARRED | ERRORS
  let expandedLogId: number | null = null;

  // Persistent panel structure references (created once, reused)
  let panelList: HTMLElement | null = null;
  let panelSearchInput: HTMLInputElement | null = null;
  let panelPauseBtn: HTMLElement | null = null;
  let panelBuilt = false;

  // Badge elements (created once)
  let badgeDot: HTMLElement | null = null;
  let badgeLabel: HTMLElement | null = null;

  // Tracking for panel updates
  let lastRenderedVersion = -1;
  let lastBadgeText = '';
  let lastOnlineState: boolean | null = null;

  // Coalesced UI timer (max 2 updates/sec for badge, independent of log rate)
  let uiTimerId: any = null;
  const UI_TICK_MS = 500;

  function startUITimer() {
    if (uiTimerId !== null) return;
    uiTimerId = setInterval(uiTick, UI_TICK_MS);
  }

  function uiTick() {
    updateBadge();
    if (isPanelOpen) {
      updatePanelList();
    }
  }

  // ─── Badge (textContent-only updates, no DOM rebuild) ──────────────────────
  function updateBadge() {
    if (!badgeEl || !badgeDot || !badgeLabel) return;

    const newText = `RL ${ringSize}${warnCount > 0 ? '  \u26A0 ' + warnCount : ''}${errorCount > 0 ? '  \u2715 ' + errorCount : ''}`;
    const onlineChanged = isConnected !== lastOnlineState;

    if (newText !== lastBadgeText) {
      lastBadgeText = newText;
      badgeLabel.textContent = newText;
    }

    if (onlineChanged) {
      lastOnlineState = isConnected;
      badgeDot.className = `rl-status-dot ${isConnected ? 'online' : 'offline'}`;
    }
  }

  // ─── Panel Structure (built once on first open, never destroyed) ───────────
  function buildPanelStructure() {
    if (!panelEl || panelBuilt) return;
    panelBuilt = true;

    // Header
    const panelHeader = document.createElement('div');
    panelHeader.className = 'rl-header';

    const title = document.createElement('div');
    title.className = 'rl-title';
    title.textContent = '\u26A1 Reverse Logger';
    panelHeader.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'rl-btn';
    closeBtn.textContent = '\u2715';
    closeBtn.addEventListener('click', () => {
      isPanelOpen = false;
      panelEl!.className = 'rl-panel';
    });
    panelHeader.appendChild(closeBtn);
    panelEl.appendChild(panelHeader);

    // Tabs
    const panelTabs = document.createElement('div');
    panelTabs.className = 'rl-tabs';

    (['ALL', 'STARRED', 'ERRORS'] as const).forEach((t) => {
      const tabBtn = document.createElement('button');
      tabBtn.className = `rl-tab ${tabFilter === t ? 'active' : ''}`;
      tabBtn.textContent = t;
      tabBtn.dataset.tab = t;
      tabBtn.addEventListener('click', () => {
        tabFilter = t;
        const allTabs = panelTabs.querySelectorAll('.rl-tab');
        allTabs.forEach((el) => el.classList.remove('active'));
        tabBtn.classList.add('active');
        lastRenderedVersion = -1;
        updatePanelList();
      });
      panelTabs.appendChild(tabBtn);
    });
    panelEl.appendChild(panelTabs);

    // Controls Bar
    const panelControls = document.createElement('div');
    panelControls.className = 'rl-controls';

    panelSearchInput = document.createElement('input');
    panelSearchInput.className = 'rl-input';
    panelSearchInput.placeholder = 'Search logs...';
    panelSearchInput.value = searchFilter;
    let searchDebounceTimer: any = null;
    panelSearchInput.addEventListener('input', (e) => {
      searchFilter = (e.target as HTMLInputElement).value;
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        lastRenderedVersion = -1;
        updatePanelList();
      }, 200);
    });
    panelControls.appendChild(panelSearchInput);

    const panelLevelSelect = document.createElement('select');
    panelLevelSelect.className = 'rl-select';
    ['ALL', 'LOG', 'INFO', 'WARN', 'ERROR', 'SPECIAL'].forEach((lvl) => {
      const opt = document.createElement('option');
      opt.value = lvl;
      opt.textContent = lvl;
      if (levelFilter === lvl) opt.selected = true;
      panelLevelSelect.appendChild(opt);
    });
    panelLevelSelect.addEventListener('change', (e) => {
      levelFilter = (e.target as HTMLSelectElement).value;
      lastRenderedVersion = -1;
      updatePanelList();
    });
    panelControls.appendChild(panelLevelSelect);

    panelPauseBtn = document.createElement('button');
    panelPauseBtn.className = 'rl-btn';
    panelPauseBtn.textContent = isPaused ? '\u25B6' : '\u23F8';
    panelPauseBtn.addEventListener('click', () => {
      isPaused = !isPaused;
      panelPauseBtn!.textContent = isPaused ? '\u25B6' : '\u23F8';
    });
    panelControls.appendChild(panelPauseBtn);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'rl-btn';
    clearBtn.textContent = 'Clear';
    clearBtn.addEventListener('click', () => {
      reverseLoggerApi.clear();
      lastRenderedVersion = -1;
      updatePanelList();
    });
    panelControls.appendChild(clearBtn);

    panelEl.appendChild(panelControls);

    // Log List Container (persistent, items updated via full list swap)
    panelList = document.createElement('div');
    panelList.className = 'rl-list';
    panelEl.appendChild(panelList);
  }

  // ─── Panel List Rendering ─────────────────────────────────────────────────
  const MAX_RENDERED = 100;

  function getFilteredLogs(): any[] {
    const snapshot = ringSnapshot();
    return snapshot.filter((log) => {
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
  }

  function updatePanelList() {
    if (!panelList || !isPanelOpen) return;

    // Skip if no changes since last render
    if (ringVersion === lastRenderedVersion) return;
    lastRenderedVersion = ringVersion;

    const filtered = getFilteredLogs();
    const visible = filtered.slice(0, MAX_RENDERED);

    // Use a DocumentFragment for batch DOM insertion (single reflow)
    const fragment = document.createDocumentFragment();

    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding: 20px; text-align: center; color: #94a3b8; font-size: 11px;';
      empty.textContent = 'No captured logs matching filters.';
      fragment.appendChild(empty);
    } else {
      for (let i = 0; i < visible.length; i++) {
        fragment.appendChild(createLogItem(visible[i]));
      }

      if (filtered.length > MAX_RENDERED) {
        const capNotice = document.createElement('div');
        capNotice.style.cssText = 'padding: 6px; text-align: center; color: #94a3b8; font-size: 10px; font-style: italic;';
        capNotice.textContent = `Showing ${MAX_RENDERED} of ${filtered.length} captured logs`;
        fragment.appendChild(capNotice);
      }
    }

    // Single DOM mutation: clear and append in one go
    panelList.innerHTML = '';
    panelList.appendChild(fragment);
  }

  function createLogItem(log: any): HTMLElement {
    const isStarred = log.starred || localStarred.has(String(log.id));
    const item = document.createElement('div');
    item.className = 'rl-item';

    const row = document.createElement('div');
    row.className = 'rl-item-row';

    const meta = document.createElement('div');
    meta.className = 'rl-item-meta';

    const starBtn = document.createElement('button');
    starBtn.className = `rl-star-btn ${isStarred ? 'starred' : ''}`;
    starBtn.textContent = '\u2605';
    starBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      log.starred = !log.starred;
      if (log.starred) localStarred.add(String(log.id));
      else localStarred.delete(String(log.id));
      saveLocalStarredSet(localStarred);
      starBtn.className = `rl-star-btn ${log.starred ? 'starred' : ''}`;
    });
    meta.appendChild(starBtn);

    const badge = document.createElement('span');
    badge.className = `rl-badge-lbl rl-lbl-${log.level}`;
    badge.textContent = log.level;
    meta.appendChild(badge);

    const timeSpan = document.createElement('span');
    timeSpan.style.color = '#94a3b8';
    timeSpan.style.flexShrink = '0';
    try {
      timeSpan.textContent = new Date(log.timestamp).toLocaleTimeString();
    } catch {
      timeSpan.textContent = log.timestamp;
    }
    meta.appendChild(timeSpan);

    const msgSpan = document.createElement('span');
    msgSpan.style.fontWeight = '600';
    const msgText = log.message || '';
    msgSpan.textContent = msgText.length > 120 ? msgText.substring(0, 120) + '\u2026' : msgText;
    meta.appendChild(msgSpan);

    row.appendChild(meta);
    item.appendChild(row);

    // Lazy details — only created on click, never pre-rendered
    item.addEventListener('click', () => {
      const isCurrentlyExpanded = expandedLogId === log.id;

      // Collapse previously expanded
      if (panelList) {
        const prev = panelList.querySelector('.rl-details.open');
        if (prev) {
          prev.classList.remove('open');
          prev.innerHTML = '';
          (prev as HTMLElement).style.display = 'none';
        }
      }

      if (isCurrentlyExpanded) {
        expandedLogId = null;
        return;
      }

      expandedLogId = log.id;

      let details = item.querySelector('.rl-details') as HTMLElement | null;
      if (!details) {
        details = document.createElement('div');
        details.className = 'rl-details';
        item.appendChild(details);
      }

      details.style.display = 'block';
      details.classList.add('open');
      details.innerHTML = '';

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
        labelText.textContent = `\uD83D\uDCE6 Large Payload (${sizeStr})`;
        largeBadge.appendChild(labelText);

        const loadBtn = document.createElement('button');
        loadBtn.className = 'rl-btn';
        loadBtn.style.fontSize = '9px';
        loadBtn.style.padding = '2px 6px';
        loadBtn.textContent = 'Load Full Payload';
        loadBtn.addEventListener('click', (loadE) => {
          loadE.stopPropagation();
          loadBtn.textContent = 'Loading...';
          const hdrs: Record<string, string> = {};
          if (authToken) hdrs['Authorization'] = `Bearer ${authToken}`;
          fetch(`${apiEndpoint}/${log.id}/payload`, { headers: hdrs })
            .then((res) => res.json())
            .then((d) => {
              if (d.success && d.payload) {
                log.message = d.payload.message;
                log.args = d.payload.args;
                if (d.payload.stack) log.stack = d.payload.stack;
                log.isLarge = false;
                expandedLogId = null;
                item.click();
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
    });

    return item;
  }

  // ─── Overlay Initialization ────────────────────────────────────────────────
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
      .rl-input:focus { outline: 1px solid #38bdf8; border-color: #38bdf8; }
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
      .rl-item-meta { display: flex; align-items: center; gap: 6px; overflow: hidden; }
      .rl-item-meta > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .rl-badge-lbl { padding: 1px 5px; border-radius: 3px; font-weight: 700; font-size: 9px; text-transform: uppercase; flex-shrink: 0; }
      .rl-lbl-error { background: rgba(248, 113, 113, 0.2); color: #f87171; }
      .rl-lbl-warn { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
      .rl-lbl-info { background: rgba(56, 189, 248, 0.2); color: #38bdf8; }
      .rl-lbl-log { background: rgba(74, 222, 128, 0.2); color: #4ade80; }
      .rl-lbl-debug { background: rgba(148, 163, 184, 0.2); color: #94a3b8; }
      .rl-lbl-special { background: rgba(192, 132, 252, 0.2); color: #c084fc; }
      .rl-star-btn { background: none; border: none; color: #64748b; cursor: pointer; font-size: 12px; flex-shrink: 0; }
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
      .rl-code { background: #020617; padding: 6px; border-radius: 4px; overflow-x: auto; font-family: monospace; margin-top: 4px; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; }
    `;

    shadowRoot.appendChild(style);

    // Create Badge (once, never destroyed)
    badgeEl = document.createElement('div');
    badgeEl.className = 'rl-badge';

    badgeDot = document.createElement('span');
    badgeDot.className = 'rl-status-dot offline';
    badgeEl.appendChild(badgeDot);

    badgeLabel = document.createElement('span');
    badgeLabel.textContent = 'RL 0';
    badgeEl.appendChild(badgeLabel);

    badgeEl.addEventListener('click', () => {
      isPanelOpen = !isPanelOpen;
      if (isPanelOpen) {
        buildPanelStructure();
        panelEl!.className = 'rl-panel open';
        lastRenderedVersion = -1;
        updatePanelList();
        if (panelSearchInput) panelSearchInput.value = searchFilter;
        if (panelPauseBtn) panelPauseBtn.textContent = isPaused ? '\u25B6' : '\u23F8';
      } else {
        panelEl!.className = 'rl-panel';
      }
    });
    shadowRoot.appendChild(badgeEl);

    // Create Panel container (empty until first open)
    panelEl = document.createElement('div');
    panelEl.className = 'rl-panel';
    shadowRoot.appendChild(panelEl);

    // Start the coalesced UI timer
    startUITimer();
  }

  // ─── Keyboard Shortcut (Cmd/Ctrl + Shift + L) ─────────────────────────────
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
          return;
        }
        e.preventDefault();
        isPanelOpen = !isPanelOpen;
        if (isPanelOpen && panelEl) {
          buildPanelStructure();
          panelEl.className = 'rl-panel open';
          lastRenderedVersion = -1;
          updatePanelList();
        } else if (panelEl) {
          panelEl.className = 'rl-panel';
        }
      }
    });
  }

  // ─── Init Overlay on DOM Ready ─────────────────────────────────────────────
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initShadowOverlay);
    } else {
      initShadowOverlay();
    }
  }

  // ─── Periodic Network Flush ────────────────────────────────────────────────
  setInterval(flushQueue, 5000);
})();
