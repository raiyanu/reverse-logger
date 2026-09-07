import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import { createServer } from './server/app';
import { findAvailablePort, getLanIp } from './server/network';
import { App } from './tui/App';

const program = new Command();

program
  .name('reverse-logger')
  .description('Local reverse logger server receiving browser console logs')
  .version('0.1.0');

program
  .command('serve')
  .description('Start reverse logger server with live terminal UI')
  .option('--max-logs <number>', 'Maximum logs to retain in local SQLite database', '10000')
  .option('--port <number>', 'Starting port number to bind server', '5050')
  .action(async (options) => {
    try {
      const maxLogs = parseInt(options.maxLogs, 10);
      const startPort = parseInt(options.port, 10);

      const port = await findAvailablePort(startPort);
      const ip = getLanIp();

      const serverUrl = `http://${ip}:${port}`;
      const scriptUrl = `${serverUrl}/script/client.js`;

      const server = createServer({
        port,
        maxLogs,
      });

      await server.listen(port, '0.0.0.0');

      const inkApp = render(
        React.createElement(App, {
          serverUrl,
          scriptUrl,
          maxLogs,
          db: server.db,
          events: server.events,
          onQuit: async () => {
            await server.close();
            process.exit(0);
          },
        })
      );

      const shutdown = async () => {
        inkApp.unmount();
        await server.close();
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (err) {
      console.error('Failed to start reverse-logger server:', err);
      process.exit(1);
    }
  });

program.parse(process.argv);
