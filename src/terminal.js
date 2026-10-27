/**
 * The terminal's modes, which a program sharing it can change under the TUI.
 */
import { spawnSync } from 'node:child_process';

/**
 * Raw mode again, for a terminal a program the agent started has changed
 * under the TUI (icrnl on made Enter arrive as \n and send nothing). Off
 * then on: libuv skips a mode it thinks it is in, and it cannot see a
 * change made by another process.
 */
export function reassertRawMode() {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function' || !stdin.isRaw) {
    return;
  }
  try {
    stdin.setRawMode(false);
    stdin.setRawMode(true);
  } catch {
    // The terminal has gone; there is nothing to set.
  }
}

/**
 * Whether `stty -a` says icrnl is on: a carriage return (Enter) is then
 * turned into a line feed before the TUI reads it.
 * @param {string} settings
 */
export function icrnlOn(settings) {
  return /(^|\s)icrnl(\s|$)/.test(settings);
}

/**
 * A lone line feed came: was it Enter, turned into \n by icrnl, or ctrl+J?
 * Only the terminal knows, so it is asked (`stty -a` on the TUI's own
 * terminal, which costs a few milliseconds and happens only for this key).
 * When it was Enter, raw mode is set again, and the next Enter is a carriage
 * return again. Without a terminal to ask, a line feed stays Enter, as it
 * was before ctrl+J was a new line.
 */
export function lineFeedIsEnter() {
  if (!process.stdin.isTTY) {
    return true;
  }
  const r = spawnSync('stty', ['-a'], {
    stdio: [0, 'pipe', 'ignore'],
    encoding: 'utf8',
    timeout: 1000,
  });
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return true;
  }
  if (icrnlOn(r.stdout)) {
    reassertRawMode();
    return true;
  }
  return false;
}
