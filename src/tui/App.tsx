import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { EventEmitter } from 'node:events';
import { LogEntry } from '../types';
import { LoggerDatabase } from '../server/db';
import { copyToClipboard } from '../utils/clipboard';

interface AppProps {
  serverUrl: string;
  scriptUrl: string;
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

export const App: React.FC<AppProps> = ({
  serverUrl,
  scriptUrl,
  maxLogs,
  db,
  events,
  onQuit,
}) => {
  const { exit } = useApp();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const scriptTagText = `<script src="${scriptUrl}"></script>`;

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

  // Key navigation & action controls
  useInput((input, key) => {
    const lowerInput = input ? input.toLowerCase() : '';

    if (lowerInput === 'q' || key.escape) {
      if (onQuit) onQuit();
      exit();
      return;
    }

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

    if (lowerInput === 'p') {
      setIsPaused((prev) => {
        const next = !prev;
        setStatusMessage(next ? '⏸ Live logs PAUSED' : '▶ Live logs RESUMED');
        return next;
      });
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(prev + 1, Math.max(0, filteredLogs.length - 1)));
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    }

    if (input === '1') setFilterLevel('ALL');
    if (input === '2') setFilterLevel('LOG');
    if (input === '3') setFilterLevel('INFO');
    if (input === '4') setFilterLevel('WARN');
    if (input === '5') setFilterLevel('ERROR');
  });

  const selectedLog = filteredLogs[selectedIndex];

  return (
    <Box flexDirection="column" padding={1}>
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
        </Box>
        <Box>
          <Text bold>Script: </Text>
          <Text color="green">{scriptUrl}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">
            Logs Stored: {totalCount} / {maxLogs} max
          </Text>
        </Box>
      </Box>

      {/* Action Notification Message */}
      {statusMessage && (
        <Box marginBottom={1} paddingX={1} borderStyle="single" borderColor="magenta">
          <Text bold color="magenta">
            {statusMessage}
          </Text>
        </Box>
      )}

      {/* Controls & Filter Bar */}
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>
          Filter: [{filterLevel}] (1:ALL 2:LOG 3:INFO 4:WARN 5:ERR)
        </Text>
        <Text color="gray">
          Controls: <Text bold color="yellow">c</Text>=copy url | <Text bold color="yellow">t</Text>=copy tag | <Text bold color="yellow">p</Text>=pause | <Text bold color="yellow">q</Text>=quit
        </Text>
      </Box>

      {/* Live Logs View */}
      <Box flexDirection="column" borderStyle="single" height={12} paddingX={1}>
        {filteredLogs.length === 0 ? (
          <Text color="gray">No logs received yet. Add the script tag to your web app to capture console activity.</Text>
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
            const msgPreview = log.message || log.args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');

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
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          marginTop={1}
          paddingX={1}
        >
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
          <Text color="white">
            {JSON.stringify(selectedLog.args, null, 2)}
          </Text>
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
  );
};
