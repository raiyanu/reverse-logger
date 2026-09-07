import { spawnSync } from 'node:child_process';

/**
 * Copies text to the system clipboard across platforms.
 */
export function copyToClipboard(text: string): boolean {
  if (!text) return false;

  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      const proc = spawnSync('pbcopy', [], { input: text, encoding: 'utf-8' });
      return proc.status === 0;
    }

    if (platform === 'win32') {
      const proc = spawnSync('clip', [], { input: text, encoding: 'utf-8' });
      if (proc.status === 0) return true;

      // Powershell fallback
      const psProc = spawnSync('powershell', ['-command', 'Set-Clipboard', '-Value', `"${text.replace(/"/g, '`"')}"`]);
      return psProc.status === 0;
    }

    // Linux / BSD: try xclip then xsel
    const xclipProc = spawnSync('xclip', ['-selection', 'clipboard'], { input: text, encoding: 'utf-8' });
    if (xclipProc.status === 0) return true;

    const xselProc = spawnSync('xsel', ['--clipboard', '--input'], { input: text, encoding: 'utf-8' });
    if (xselProc.status === 0) return true;

    // OSC 52 ANSI escape code fallback for modern terminal emulators
    const osc52 = `\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`;
    process.stdout.write(osc52);
    return true;
  } catch {
    return false;
  }
}
