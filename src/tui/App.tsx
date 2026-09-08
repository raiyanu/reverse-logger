import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
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
  const [screenMode, setScreenMode] = useState<ScreenMode>('SERVER_INFO');
  const previousScreenRef = useRef<ScreenMode>('SERVER_INFO');

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const scriptTagText = `<script src="${scriptUrl}"></script>`;

  // Ensure stdin remains in raw mode continuously (prevents losing focus on window focus switch)
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


  // Initial load
  useEffect(() => {
    const initialLogs = db.getLogs({ limit: 100 });
    setLogs(initialLogs);
    setTotalCount(db.getLogCount());
  }, [db]);

  // Subscribe to live log events
  useEffect(() => {
    const handleNewLog = (newLog: LogEntry) => {
      setTotalCount((prev) => Math.min(prev + 1, maxLogs));
      if (!isPausedRef.current) {
        setLogs((prev) => [newLog, ...prev].slice(0, 200));
      }
    };

    events.on('log', handleNewLog);
    return () => {
      events.off('log', handleNewLog);
    };
  }, [events, maxLogs]);

  // Auto-clear status message after 3 seconds
  useEffect(() => {
    if (statusMessage) {
      const timer = setTimeout(() => {
        setStatusMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage]);

  // Filter logs by level if selected
  const filteredLogs = logs.filter((log) => {
    if (filterLevel === 'ALL') return true;
    return log.level.toUpperCase() === filterLevel;
  });

  const screenModeRef = useRef<ScreenMode>(screenMode);
  screenModeRef.current = screenMode;

  const filteredLogsRef = useRef<LogEntry[]>(filteredLogs);
  filteredLogsRef.current = filteredLogs;

  const lastKeyTimeRef = useRef<number>(0);

  const handleToggleServerInfo = () => {
    const now = Date.now();
    if (now - lastKeyTimeRef.current < 250) return;
    lastKeyTimeRef.current = now;

    setScreenMode((prev) => {
      if (prev === 'SERVER_INFO') return 'LIVE_LOGS';
      return 'SERVER_INFO';
    });
  };

  const handleToggleHelp = () => {
    const now = Date.now();
    if (now - lastKeyTimeRef.current < 250) return;
    lastKeyTimeRef.current = now;

    setScreenMode((prev) => {
      if (prev === 'HELP') return previousScreenRef.current || 'LIVE_LOGS';
      previousScreenRef.current = prev;
      return 'HELP';
    });
  };

  // Keyboard navigation & action controls
  useInput(
    (input, key) => {
      const lowerInput = input ? input.toLowerCase() : '';
      const isEnter = Boolean(key.return || input === '\r' || input === '\n');

      // Global Quit
      if (lowerInput === 'q') {
        if (onQuit) onQuit();
        exit();
        return;
      }

      // Copy helpers available globally
      if (lowerInput === 'c') {
        const ok = copyToClipboard(scriptUrl);
        setStatusMessage(ok ? '✓ Copied Script URL to clipboard' : '⚠ Failed to copy Script URL');
        return;
      }

      if (lowerInput === 't') {
        const ok = copyToClipboard(scriptTagText);
        setStatusMessage(ok ? '✓ Copied Script Tag to clipboard' : '⚠ Failed to copy Script Tag');
        return;
      }

      // Help Screen Toggle
      if (lowerInput === 'h' || (screenModeRef.current === 'HELP' && (isEnter || key.escape))) {
        handleToggleHelp();
        return;
      }

      // Server Info / Live Logs Toggle (s key or Enter key)
      if (lowerInput === 's' || isEnter) {
        handleToggleServerInfo();
        return;
      }

      // Live Logs Screen specific controls
      if (screenModeRef.current === 'LIVE_LOGS') {
        if (lowerInput === 'p') {
          setIsPaused((prev) => {
            const next = !prev;
            setStatusMessage(next ? '⏸ Live logs PAUSED' : '▶ Live logs RESUMED');
            return next;
          });
          return;
        }

        if (key.downArrow) {
          setSelectedIndex((prev) => Math.min(prev + 1, Math.max(0, filteredLogsRef.current.length - 1)));
        }

        if (key.upArrow) {
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
        }

        if (input === '1') setFilterLevel('ALL');
        if (input === '2') setFilterLevel('LOG');
        if (input === '3') setFilterLevel('INFO');
        if (input === '4') setFilterLevel('WARN');
        if (input === '5') setFilterLevel('ERROR');
      }
    },
    { isActive: true }
  );

  const selectedLog = filteredLogs[selectedIndex];

  return (
    <Box flexDirection="column" padding={1}>
      {/* Action Notification Banner */}
      {statusMessage && (
        <Box marginBottom={1} paddingX={1} borderStyle="single" borderColor="magenta">
          <Text bold color="magenta">
            {statusMessage}
          </Text>
        </Box>
      )}

      {/* SCREEN 1: SERVER INFO SCREEN */}
      {screenMode === 'SERVER_INFO' && (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
          <Box justifyContent="space-between">
            <Text bold color="cyan">
              ⚡ REVERSE LOGGER SERVER DETAILS
            </Text>
            <Text bold color="green">
              [ONLINE]
            </Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold>
              Server Address : <Text color="green">{serverUrl}</Text>
            </Text>
            <Text bold>
              Web Dashboard  : <Text color="cyan">{dashboardUrl}</Text>
            </Text>
            <Text bold>
              Script URL     : <Text color="green">{scriptUrl}</Text>
            </Text>
            {dbPath && (
              <Text bold>
                Database Path  : <Text color="gray">{dbPath}</Text>
              </Text>
            )}
            <Text bold>
              Logs Stored    : <Text color="yellow">{totalCount}</Text> / <Text color="gray">{maxLogs} max</Text>
            </Text>
            {flush && (
              <Text bold color="yellow">
                Database Flush : ON (--flush enabled)
              </Text>
            )}
          </Box>

          <Box marginTop={1} padding={1} borderStyle="single" borderColor="green" flexDirection="column">
            <Text bold color="white">
              HTML Script Tag to Inject into Web Application:
            </Text>
            <Text color="yellow">{scriptTagText}</Text>
          </Box>

          <Box marginTop={1} justifyContent="space-between">
            <Text bold color="green">
              👉 Press [ENTER] or [s] to view Live Logs
            </Text>
            <Text color="gray">
              <Text bold color="yellow">c</Text>=copy url | <Text bold color="yellow">t</Text>=copy tag | <Text bold color="yellow">h</Text>=help | <Text bold color="yellow">q</Text>=quit
            </Text>
          </Box>
        </Box>
      )}

      {/* SCREEN 2: LIVE LOGS SCREEN */}
      {screenMode === 'LIVE_LOGS' && (
        <Box flexDirection="column">
          {/* Header Banner */}
          <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={isPaused ? 'yellow' : 'cyan'}
            paddingX={1}
            marginBottom={1}
          >
            <Box justifyContent="space-between">
              <Text bold color="cyan">
                ⚡ REVERSE LOGGER SERVER
              </Text>
              <Text bold color={isPaused ? 'yellow' : 'green'}>
                {isPaused ? '[PAUSED]' : '[LIVE]'}
              </Text>
            </Box>
            <Box marginTop={1}>
              <Text bold>Server: </Text>
              <Text color="green">{serverUrl}</Text>
              <Text color="gray">  |  Logs Stored: {totalCount} / {maxLogs} max</Text>
            </Box>
          </Box>

          {/* Controls & Filter Bar */}
          <Box marginBottom={1} justifyContent="space-between">
            <Text bold>
              Filter: [{filterLevel}] (1:ALL 2:LOG 3:INFO 4:WARN 5:ERR)
            </Text>
            <Text color="gray">
              <Text bold color="yellow">s</Text>=server details | <Text bold color="yellow">p</Text>=pause | <Text bold color="yellow">h</Text>=help | <Text bold color="yellow">q</Text>=quit
            </Text>
          </Box>

          {/* Live Logs View */}
          <Box flexDirection="column" borderStyle="single" height={12} paddingX={1}>
            {filteredLogs.length === 0 ? (
              <Text color="gray">No logs received yet. Inject script tag into your application to stream console activity.</Text>
            ) : (
              filteredLogs.slice(0, 10).map((log, index) => {
                const isSelected = index === selectedIndex;
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
                  <Box key={log.id || index}>
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

          {/* Detail Panel */}
          {selectedLog && (
            <Box flexDirection="column" borderStyle="single" borderColor="gray" marginTop={1} paddingX={1}>
              <Text bold color="white">
                Log Inspector (#{selectedLog.id})
              </Text>
              <Text color="gray">URL: {selectedLog.url || 'N/A'}</Text>
              <Text color="gray">Session ID: {selectedLog.sessionId || 'N/A'}</Text>
              <Text color="gray">Time: {selectedLog.timestamp}</Text>
              <Box marginTop={1}>
                <Text bold color={levelColors[selectedLog.level] || 'white'}>
                  Message:
                </Text>
              </Box>
              <Text color="white">{selectedLog.message}</Text>
              <Box marginTop={1}>
                <Text bold color="cyan">
                  Arguments:
                </Text>
              </Box>
              <Text color="white">{JSON.stringify(selectedLog.args, null, 2)}</Text>
              {selectedLog.stack && (
                <Box flexDirection="column" marginTop={1}>
                  <Text bold color="red">
                    Stack Trace:
                  </Text>
                  <Text color="gray">{selectedLog.stack}</Text>
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* SCREEN 3: HELP & OPTIONS SCREEN */}
      {screenMode === 'HELP' && (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1}>
          <Text bold color="yellow">
            ❓ REVERSE LOGGER - KEYBOARD SHORTCUTS & OPTIONS
          </Text>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">
              Navigation & View Screens:
            </Text>
            <Text>  <Text bold color="yellow">Enter / s</Text> : Toggle between Server Details and Live Logs screen</Text>
            <Text>  <Text bold color="yellow">h</Text>         : Open / Close this Help screen</Text>
            <Text>  <Text bold color="yellow">q / Esc</Text>   : Exit and stop reverse logger server</Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">
              Log Stream Controls:
            </Text>
            <Text>  <Text bold color="yellow">p</Text>         : Pause / Resume live log stream</Text>
            <Text>  <Text bold color="yellow">c</Text>         : Copy Script URL to clipboard</Text>
            <Text>  <Text bold color="yellow">t</Text>         : Copy HTML &lt;script&gt; tag to clipboard</Text>
            <Text>  <Text bold color="yellow">1 - 5</Text>     : Filter logs by level (1:ALL 2:LOG 3:INFO 4:WARN 5:ERR)</Text>
            <Text>  <Text bold color="yellow">↑ / ↓</Text>     : Scroll and inspect selected log details</Text>
          </Box>

          <Box marginTop={1} flexDirection="column">
            <Text bold color="cyan">
              CLI Server Flags:
            </Text>
            <Text>  --port &lt;number&gt;  : Specify starting server port (default: 5050)</Text>
            <Text>  --flush          : Purge existing logs from database on startup</Text>
            <Text>  --token &lt;secret&gt; : Require Bearer token authentication</Text>
            <Text>  --max-logs &lt;num&gt; : Set max database retention capacity</Text>
          </Box>

          <Box marginTop={1}>
            <Text bold color="green">
              👉 Press [ENTER], [h], or [Esc] to return to application
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
