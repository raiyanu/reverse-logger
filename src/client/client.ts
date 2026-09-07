(function () {
  if ((window as any).__REVERSE_LOGGER_INITIALIZED__) {
    return;
  }
  (window as any).__REVERSE_LOGGER_INITIALIZED__ = true;

  // Determine server origin from current script tag or location fallback
  function getServerOrigin(): string {
    if (document.currentScript && (document.currentScript as HTMLScriptElement).src) {
      try {
        const url = new URL((document.currentScript as HTMLScriptElement).src);
        return url.origin;
      } catch (e) {
        // fallback
      }
    }
    return window.location.origin;
  }

  const serverOrigin = getServerOrigin();
  const apiEndpoint = `${serverOrigin}/api/logs`;

  let isSending = false;

  function safeSerialize(obj: any): any {
    const cache = new WeakSet();
    return JSON.parse(
      JSON.stringify(obj, (key, value) => {
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
        return value;
      })
    );
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
      // Filter out internal client.js frames
      const filtered = lines.filter((line) => !line.includes('client.js') && !line.includes('safeSerialize'));
      return filtered.join('\n');
    }
    return undefined;
  }

  function sendLog(level: string, rawArgs: any[]) {
    if (isSending) return; // Prevent infinite recursion loop if fetch logs
    isSending = true;

    try {
      const serializedArgs = rawArgs.map((arg) => safeSerialize(arg));
      const stack = extractStack(rawArgs);

      const payload = {
        timestamp: Date.now(),
        level,
        args: serializedArgs,
        url: typeof window !== 'undefined' ? window.location.href : '',
        stack,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      };

      if (typeof fetch === 'function') {
        fetch(apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          mode: 'cors',
          keepalive: true,
        }).catch(() => {
          // Ignore network errors to avoid breaking client site
        }).finally(() => {
          isSending = false;
        });
      } else {
        isSending = false;
      }
    } catch (e) {
      isSending = false;
    }
  }

  const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const originalConsole: Record<string, Function> = {};

  levels.forEach((level) => {
    if (typeof console[level] === 'function') {
      originalConsole[level] = console[level].bind(console);
      console[level] = function (...args: any[]) {
        // Call original console method first to preserve browser behavior
        originalConsole[level](...args);
        // Send log asynchronously to reverse-logger server
        sendLog(level, args);
      };
    }
  });
})();
