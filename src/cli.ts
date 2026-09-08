import { Command } from 'commander';
import React from 'react';
import { render } from 'ink';
import { createServer } from './server/app';
import { resolveServerOptions } from './server/config';
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
  .option('--max-logs <number>', 'Maximum logs to retain in local SQLite database')
  .option('--port <number>', 'Starting port number to bind server')
  .option('--host <string>', 'Host interface address to bind server')
  .option('--token <string>', 'Optional Bearer authentication token for API access')
  .option('--flush', 'Flush away all existing logs on startup and start with a fresh database')
  .option('--fresh', 'Alias for --flush')
  .option('--clean', 'Alias for --flush')
  .action(async (options) => {
    try {
      const cliOptions = {
        maxLogs: options.maxLogs ? parseInt(options.maxLogs, 10) : undefined,
        port: options.port ? parseInt(options.port, 10) : undefined,
        host: options.host || undefined,
        token: options.token || undefined,
        flush: Boolean(options.flush || options.fresh || options.clean),
      };

      const resolvedConfig = resolveServerOptions(cliOptions);
      const port = await findAvailablePort(resolvedConfig.port || 5050);
      const ip = getLanIp();
      const host = resolvedConfig.host || '0.0.0.0';

      const scriptTokenParam = resolvedConfig.token ? `?token=${encodeURIComponent(resolvedConfig.token)}` : '';
      const serverUrl = `http://${ip}:${port}`;
      const scriptUrl = `${serverUrl}/script/client.js${scriptTokenParam}`;
      const scriptTag = `<script src="${scriptUrl}"></script>`;

      // Print plain text banner to stdout before Ink TUI for standard terminal mouse selection
      console.log('Reverse Logger\n');
      console.log(`Server : ${serverUrl}`);
      console.log(`Script : ${scriptUrl}\n`);
      console.log('Tag:');
      console.log(`${scriptTag}\n`);

      const server = createServer({
        port,
        host,
        maxLogs: resolvedConfig.maxLogs,
        token: resolvedConfig.token,
        dbPath: resolvedConfig.dbPath,
        flush: resolvedConfig.flush,
      });

      await server.listen(port, host);

      const inkApp = render(
        React.createElement(App, {
          serverUrl,
          scriptUrl,
          maxLogs: resolvedConfig.maxLogs || 10000,
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
