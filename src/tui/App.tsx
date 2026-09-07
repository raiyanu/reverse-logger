import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { EventEmitter } from 'node:events';
import { LogEntry, LogLevel } from '../types';
import { LoggerDatabase } from '../server/db';

interface AppProps {
  serverUrl: string;
  scriptUrl: string;
  maxLogs: number;
  db: LoggerDatabase;
  events: EventEmitter;
  onQuit?: () => void;
}

const levelColors: Record<LogLevel, string> = {
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

  // Initial load
  useEffect(() => {
    const initialLogs = db.getLogs({ limit: 100 });
    setLogs(initialLogs);
    setTotalCount(db.getLogCount());
  }, [db]);

  // Subscribe to live log events
  useEffect(() => {
    const handleNewLog = (newLog: LogEntry) => {
      setLogs((prev) => [newLog, ...prev].slice(0, 200));
      setTotalCount((prev) => Math.min(prev + 1, maxLogs));
    };

    events.on('log', handleNewLog);
    return () => {
      events.off('log', handleNewLog);
    };
  }, [events, maxLogs]);

  // Filter logs by level if selected
  const filteredLogs = logs.filter((log) => {
    if (filterLevel === 'ALL') return true;
    return log.level.toUpperCase() === filterLevel;
  });

  // Key navigation
  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      if (onQuit) onQuit();
      exit();
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
        borderColor="cyan"
        paddingX={1}
        marginBottom={1}
      >
        <Text bold color="cyan">
          ⚡ REVERSE LOGGER SERVER
        </Text>
        <Box marginTop={1}>
          <Text bold>Server: </Text>
          <Text color="green">{serverUrl}</Text>
        </Box>
        <Box>
          <Text bold>Script: </Text>
          <Text color="green">{scriptUrl}</Text>
        </Box>
        <Box marginTop={1}>
          <Text bold>Tag: </Text>
          <Text color="yellow">
            {`<script src="${scriptUrl}"></script>`}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray">
            Logs Stored: {totalCount} / {maxLogs} max
          </Text>
        </Box>
      </Box>

      {/* Controls & Filter Bar */}
      <Box marginBottom={1} justifyContent="space-between">
        <Text bold>
          Filter: [{filterLevel}] (1:ALL 2:LOG 3:INFO 4:WARN 5:ERR)
        </Text>
        <Text color="gray">Use ↑/↓ to navigate | Press 'q' to quit</Text>
      </Box>

      {/* Live Logs View */}
      <Box flexDirection="column" borderStyle="single" height={12} paddingX={1}>
        {filteredLogs.length === 0 ? (
          <Text color="gray">No logs received yet. Add the script tag to your web app to capture console activity.</Text>
        ) : (
          filteredLogs.slice(0, 10).map((log, index) => {
            const isSelected = index === selectedIndex;
            const timeStr = new Date(log.timestamp).toLocaleTimeString();
            const levelUpper = log.level.toUpperCase().padEnd(5);
            const argsPreview = log.args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');

            return (
              <Box key={log.id || index}>
                <Text color={isSelected ? 'blue' : undefined} bold={isSelected}>
                  {isSelected ? '> ' : '  '}
                </Text>
                <Text color="gray">[{timeStr}] </Text>
                <Text color={levelColors[log.level] || 'white'} bold>
                  [{levelUpper}]{' '}
                </Text>
                <Text wrap="truncate-end">{argsPreview}</Text>
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
          <Text color="gray">Time: {new Date(selectedLog.timestamp).toISOString()}</Text>
          <Box marginTop={1}>
            <Text bold color={levelColors[selectedLog.level] || 'white'}>
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
