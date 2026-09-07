import os from 'node:os';
import net from 'node:net';

/**
 * Returns the machine's external LAN IPv4 address.
 */
export function getLanIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const netInterface = interfaces[name];
    if (!netInterface) continue;
    for (const iface of netInterface) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Checks if a specific port is available.
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Finds an available port starting at `startPort`.
 */
export async function findAvailablePort(startPort: number = 5050, maxAttempts: number = 100): Promise<number> {
  let port = startPort;
  for (let i = 0; i < maxAttempts; i++) {
    const available = await isPortAvailable(port);
    if (available) {
      return port;
    }
    port++;
  }
  throw new Error(`Could not find an available port starting from ${startPort}`);
}
