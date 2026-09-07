(function () {
  if ((window as any).__REVERSE_LOGGER_INITIALIZED__) {
    return;
  }
  (window as any).__REVERSE_LOGGER_INITIALIZED__ = true;

  // Generate or retrieve Session ID
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
      // Storage access blocked or restricted
    }
    if (!(window as any).__RL_SESSION_ID__) {
      (window as any).__RL_SESSION_ID__ = 's_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
    }
    return (window as any).__RL_SESSION_ID__;
  }

  const sessionId = getSessionId();

  // Extract server origin and token from script tag
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

  let isSending = false;
  const queue: any[] = [];
  const MAX_QUEUE_SIZE = 50;
  const MAX_STRING_LEN = 10000;

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

  function enqueuePayload(payload: any) {
    if (queue.length >= MAX_QUEUE_SIZE) {
      queue.shift(); // Drop oldest payload if queue is full
    }
    queue.push(payload);
    flushQueue();
  }

  function flushQueue() {
    if (isSending || queue.length === 0 || typeof fetch !== 'function') {
      return;
    }
    isSending = true;

    const payload = queue[0];
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    fetch(apiEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      mode: 'cors',
      keepalive: true,
    })
      .then((res) => {
        if (res.ok || res.status === 400) {
          queue.shift(); // Successfully sent or permanently rejected by server
        }
      })
      .catch(() => {
        // Retain in queue for next flush attempt
      })
      .finally(() => {
        isSending = false;
        if (queue.length > 0) {
          setTimeout(flushQueue, 3000);
        }
      });
  }

  function sendLog(level: string, rawArgs: any[]) {
    try {
      const serializedArgs = rawArgs.map((arg) => safeSerialize(arg));
      const stack = extractStack(rawArgs);

      const payload = {
        timestamp: new Date().toISOString(),
        level,
        args: serializedArgs,
        url: typeof window !== 'undefined' ? window.location.href : '',
        stack,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        sessionId,
      };

      enqueuePayload(payload);
    } catch {
      // Ignore errors silently
    }
  }

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
        sendLog(level, args);
      };
    }
  });

  // Periodic flush timer
  setInterval(flushQueue, 5000);
})();
