import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { EventEmitter } from 'node:events';
import { LogEntry } from '../types';
import { LoggerDatabase } from '../server/db';
import { copyToClipboard } from '../utils/clipboard';

export interface AppProps {
  serverUrl: string;
  scriptUrl: string;
  dashboardUrl?: string;
  dbPath?: string;
  flush?: boolean;
  maxLogs: number;
  db: LoggerDatabase;
  events: EventEmitter;
  onQuit?: () => void;
}

const levelColors: Record<string, string> = {
  log: 'green',
  info: 'cyan',
  warn: 'yellow',
  error: 'red',
  debug: 'gray',
};

type ScreenMode = 'SERVER_INFO' | 'LIVE_LOGS' | 'HELP';

export const App: React.FC<AppProps> = ({
  serverUrl,
  scriptUrl,
  dashboardUrl = `${serverUrl}/logs`,
  dbPath,
  flush = false,
  maxLogs,
  db,
  events,
  onQuit,
}) => {
  const { exit } = useApp();
  const { stdout } = useStdout();

  // ── Screen Mode (ref = source of truth, tick = force re-render) ─────────
  const screenRef = useRef<ScreenMode>('SERVER_INFO');
  const prevScreenRef = useRef<ScreenMode>('SERVER_INFO');
  const [, setTick] = useState(0);

  function switchScreen(next: ScreenMode) {
    screenRef.current = next;
    setTick((n) => n + 1);
  }

  const screen = screenRef.current;

  // ── Terminal height (for fixed-height container to prevent Ink ghosting) ─
  const [termRows, setTermRows] = useState(stdout?.rows || 24);

  useEffect(() => {
    const onResize = () => {
      if (stdout?.rows) setTermRows(stdout.rows);
    };
    stdout?.on('resize', onResize);
    return () => { stdout?.off('resize', onResize); };
  }, [stdout]);

  // ── Data State ──────────────────────────────────────────────────────────
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [scrollOffset, setScrollOffset] = useState<number>(0);
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const scriptTagText = `<script src="${scriptUrl}"></script>`;

  // ── Raw mode persistence ────────────────────────────────────────────────
  useEffect(() => {
    if (process.stdin && process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(true);
        process.stdin.resume();
      } catch {
        // ignore
      }
    }
  }, []);

  // ── Initial DB load ─────────────────────────────────────────────────────
  useEffect(() => {
    const initialLogs = db.getLogs({ limit: 100 });
    setLogs(initialLogs);
    setTotalCount(db.getLogCount());
  }, [db]);

  // ── Live log subscription (batched 500ms) ───────────────────────────────
  useEffect(() => {
    const pendingLogs: LogEntry[] = [];
    let batchTimer: ReturnType<typeof setTimeout> | null = null;

    const flushPendingLogs = () => {
      batchTimer = null;
      if (pendingLogs.length === 0) return;
      const batch = pendingLogs.splice(0);
      setTotalCount((prev) => Math.min(prev + batch.length, maxLogs));
      if (!isPausedRef.current) {
        setLogs((prev) => [...batch.reverse(), ...prev].slice(0, 200));
      }
    };

    const handleNewLog = (newLog: LogEntry) => {
      pendingLogs.push(newLog);
      if (!batchTimer) {
        batchTimer = setTimeout(flushPendingLogs, 500);
      }
    };

    events.on('log', handleNewLog);
    return () => {
      events.off('log', handleNewLog);
      if (batchTimer) clearTimeout(batchTimer);
      flushPendingLogs();
    };
  }, [events, maxLogs]);

  // ── Auto-clear status message ───────────────────────────────────────────
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => setStatusMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  // ── Filtered logs ───────────────────────────────────────────────────────
  const filteredLogs = logs.filter((log) => {
    if (filterLevel === 'ALL') return true;
    return log.level.toUpperCase() === filterLevel;
  });

  const filteredLogsRef = useRef<LogEntry[]>(filteredLogs);
  filteredLogsRef.current = filteredLogs;

  // ── Keyboard Input ──────────────────────────────────────────────────────
  useInput((input, key) => {
    const ch = input ? input.toLowerCase() : '';
    const cur = screenRef.current;

    // Quit
    if (ch === 'q') {
      if (onQuit) onQuit();
      exit();
      return;
    }

    // Copy helpers (any screen)
    if (ch === 'c') {
      const ok = copyToClipboard(scriptUrl);
      setStatusMessage(ok ? '✓ Copied Script URL to clipboard' : '⚠ Failed to copy Script URL');
      return;
    }
    if (ch === 't') {
      const ok = copyToClipboard(scriptTagText);
      setStatusMessage(ok ? '✓ Copied Script Tag to clipboard' : '⚠ Failed to copy Script Tag');
      return;
    }

    // Help toggle
    if (ch === 'h') {
      if (cur === 'HELP') {
        switchScreen(prevScreenRef.current);
      } else {
        prevScreenRef.current = cur;
        switchScreen('HELP');
      }
      return;
    }

    // Exit HELP via Enter/Escape
    if (cur === 'HELP' && (key.return || key.escape)) {
      switchScreen(prevScreenRef.current);
      return;
    }

    // Toggle SERVER_INFO ↔ LIVE_LOGS
    if (ch === 's' || key.return) {
      switchScreen(cur === 'SERVER_INFO' ? 'LIVE_LOGS' : 'SERVER_INFO');
      return;
    }

    // Live Logs specific
    if (cur === 'LIVE_LOGS') {
      if (ch === 'p') {
        setIsPaused((prev) => {
          const next = !prev;
          setStatusMessage(next ? '⏸ Live logs PAUSED' : '▶ Live logs RESUMED');
          return next;
        });
        return;
      }
      if (key.downArrow) {
        const maxIdx = Math.max(0, filteredLogsRef.current.length - 1);
        setSelectedIndex((prev) => {
          const next = Math.min(prev + 1, maxIdx);
          // Auto-scroll: if next goes below visible window, shift offset
          setScrollOffset((off) => {
            const visibleCount = Math.max(3, (stdout?.rows || 24) - 22);
            if (next >= off + visibleCount) return next - visibleCount + 1;
            return off;
          });
          return next;
        });
        return;
      }
      if (key.upArrow) {
        setSelectedIndex((prev) => {
          const next = Math.max(prev - 1, 0);
          // Auto-scroll: if next goes above visible window, shift offset
          setScrollOffset((off) => {
            if (next < off) return next;
            return off;
          });
          return next;
        });
        return;
      }
      if (input === '1') setFilterLevel('ALL');
      if (input === '2') setFilterLevel('LOG');
      if (input === '3') setFilterLevel('INFO');
      if (input === '4') setFilterLevel('WARN');
      if (input === '5') setFilterLevel('ERROR');
    }
  }, { isActive: true });

  const selectedLog = filteredLogs[selectedIndex];

  // ── Calculate dynamic log list height to fill available space ───────────
  // termRows minus header(4) + filter(1) + detail(8) + padding/borders(~9)
  const logListHeight = Math.max(5, termRows - 15);
  const logsToShow = Math.max(3, logListHeight - 2); // minus border lines

  // Visible window slice
  const visibleLogs = filteredLogs.slice(scrollOffset, scrollOffset + logsToShow);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER — Fixed height container prevents Ink terminal ghosting
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <Box flexDirection="column" height={termRows}>
      {/* Status notification */}
      {statusMessage && (
        <Box paddingX={1} borderStyle="single" borderColor="magenta">
          <Text bold color="magenta">{statusMessage}</Text>
        </Box>
      )}

      {/* ── SERVER INFO SCREEN ──────────────────────────────────────────── */}
      {screen === 'SERVER_INFO' && (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1} flexGrow={1}>
          <Box justifyContent="space-between">
            <Text bold color="cyan">⚡ REVERSE LOGGER SERVER DETAILS</Text>
            <Text bold color="green">[ONLINE]</Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold>Server Address : <Text color="green">{serverUrl}</Text></Text>
            <Text bold>Web Dashboard  : <Text color="cyan">{dashboardUrl}</Text></Text>
            <Text bold>Script URL     : <Text color="green">{scriptUrl}</Text></Text>
            {dbPath && <Text bold>Database Path  : <Text color="gray">{dbPath}</Text></Text>}
            <Text bold>Logs Stored    : <Text color="yellow">{totalCount}</Text> / <Text color="gray">{maxLogs} max</Text></Text>
            {flush && <Text bold color="yellow">Database Flush : ON (--flush enabled)</Text>}
          </Box>

          <Box marginTop={1} padding={1} borderStyle="single" borderColor="green" flexDirection="column">
            <Text bold color="white">HTML Script Tag to Inject into Web Application:</Text>
            <Text color="yellow">{scriptTagText}</Text>
          </Box>

          <Box marginTop={1} justifyContent="space-between">
            <Text bold color="green">👉 Press [ENTER] or [s] to view Live Logs</Text>
            <Text color="gray">
              <Text bold color="yellow">c</Text>=copy url | <Text bold color="yellow">t</Text>=copy tag | <Text bold color="yellow">h</Text>=help | <Text bold color="yellow">q</Text>=quit
            </Text>
          </Box>
        </Box>
      )}

      {/* ── LIVE LOGS SCREEN ────────────────────────────────────────────── */}
      {screen === 'LIVE_LOGS' && (
        <Box flexDirection="column" flexGrow={1}>
          {/* Header */}
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={isPaused ? 'yellow' : 'cyan'}
            paddingX={1}
          >
            <Box justifyContent="space-between">
              <Text bold color="cyan">⚡ REVERSE LOGGER SERVER</Text>
              <Text bold color={isPaused ? 'yellow' : 'green'}>
                {isPaused ? '[PAUSED]' : '[LIVE]'}
              </Text>
            </Box>
            <Box>
              <Text bold>Server: </Text>
              <Text color="green">{serverUrl}</Text>
              <Text color="gray">  |  Logs Stored: {totalCount} / {maxLogs} max</Text>
            </Box>
          </Box>

          {/* Filter bar */}
          <Box justifyContent="space-between">
            <Text bold>Filter: [{filterLevel}] (1:ALL 2:LOG 3:INFO 4:WARN 5:ERR)</Text>
            <Text color="gray">
              <Text bold color="yellow">s</Text>=server details | <Text bold color="yellow">p</Text>=pause | <Text bold color="yellow">h</Text>=help | <Text bold color="yellow">q</Text>=quit
            </Text>
          </Box>

          {/* Log list */}
          <Box flexDirection="column" borderStyle="single" height={logListHeight} paddingX={1} flexGrow={1}>
            {filteredLogs.length === 0 ? (
              <Text color="gray">No logs received yet. Inject script tag into your application to stream console activity.</Text>
            ) : (
              visibleLogs.map((log, visIdx) => {
                const absoluteIndex = scrollOffset + visIdx;
                const isSelected = absoluteIndex === selectedIndex;
                let timeStr = log.timestamp;
                try {
                  timeStr = new Date(log.timestamp).toLocaleTimeString();
                } catch {
                  // fallback
                }

                const levelUpper = (log.level || 'info').toUpperCase().padEnd(5);
                const msgPreview =
                  log.message || log.args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');

                return (
                  <Box key={log.id || absoluteIndex}>
                    <Text color={isSelected ? 'blue' : undefined} bold={isSelected}>
                      {isSelected ? '> ' : '  '}
                    </Text>
                    <Text color="gray">[{timeStr}] </Text>
                    <Text color={levelColors[log.level] || 'white'} bold>
                      [{levelUpper}]{' '}
                    </Text>
                    <Text wrap="truncate-end">{msgPreview}</Text>
                  </Box>
                );
              })
            )}
          </Box>

          {/* Detail panel — fixed 6-line height to prevent squeezing log list */}
          {selectedLog && (
            <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} height={6}>
              <Text bold color="white">#{selectedLog.id} <Text color={levelColors[selectedLog.level] || 'white'}>[{(selectedLog.level || '').toUpperCase()}]</Text> <Text color="gray">{selectedLog.url || ''}</Text></Text>
              <Text color="white" wrap="truncate-end">{selectedLog.message}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* ── HELP SCREEN ─────────────────────────────────────────────────── */}
      {screen === 'HELP' && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1} flexGrow={1}>
          <Text bold color="yellow">❓ REVERSE LOGGER - KEYBOARD SHORTCUTS & OPTIONS</Text>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">Navigation & View Screens:</Text>
            <Text>  <Text bold color="yellow">Enter / s</Text> : Toggle between Server Details and Live Logs screen</Text>
            <Text>  <Text bold color="yellow">h</Text>         : Open / Close this Help screen</Text>
            <Text>  <Text bold color="yellow">q</Text>         : Exit and stop reverse logger server</Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">Log Stream Controls:</Text>
            <Text>  <Text bold color="yellow">p</Text>         : Pause / Resume live log stream</Text>
            <Text>  <Text bold color="yellow">c</Text>         : Copy Script URL to clipboard</Text>
            <Text>  <Text bold color="yellow">t</Text>         : Copy HTML &lt;script&gt; tag to clipboard</Text>
            <Text>  <Text bold color="yellow">1 - 5</Text>     : Filter logs by level (1:ALL 2:LOG 3:INFO 4:WARN 5:ERR)</Text>
            <Text>  <Text bold color="yellow">↑ / ↓</Text>     : Scroll and inspect selected log details</Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">CLI Server Flags:</Text>
            <Text>  --port &lt;number&gt;  : Specify starting server port (default: 5050)</Text>
            <Text>  --flush          : Purge existing logs from database on startup</Text>
            <Text>  --token &lt;secret&gt; : Require Bearer token authentication</Text>
            <Text>  --max-logs &lt;num&gt; : Set max database retention capacity</Text>
          </Box>

          <Box marginTop={1}>
            <Text bold color="green">👉 Press [ENTER], [h], or [Esc] to return to application</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
