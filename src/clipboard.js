/**
 * /copy: an answer onto the clipboard, whole and alone. Dragging in a
 * terminal selects whole rows, across the side panel and whatever is beside
 * the answer; the answer's own text is what was wanted.
 *
 * Two ways at once, since neither reaches everywhere: a clipboard program
 * of the machine the TUI runs on (wl-copy, xclip, xsel, pbcopy), which a
 * terminal of that machine pastes from; and OSC 52, which the terminal
 * itself takes — over ssh too, and inside tend, which copies what the
 * program copies.
 */

import { spawn } from 'node:child_process';

/** The clipboard programs tried, in order, with the arguments that write. */
const PROGRAMS = [
  { cmd: 'wl-copy', args: [], needs: 'WAYLAND_DISPLAY' },
  { cmd: 'xclip', args: ['-selection', 'clipboard'], needs: 'DISPLAY' },
  { cmd: 'xsel', args: ['--clipboard', '--input'], needs: 'DISPLAY' },
  { cmd: 'pbcopy', args: [], needs: undefined, platform: 'darwin' },
];

/**
 * The n-th last answer's text (1 the last), as the model wrote it — the
 * markdown, not the drawing of it. undefined when there are fewer.
 * @param {ReadonlyArray<{kind?: string, text?: string}>} items
 * @param {number} n
 */
export function nthAnswer(items, n) {
  let seen = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it?.kind === 'assistant' && typeof it.text === 'string' && it.text.trim() !== '') {
      seen++;
      if (seen === n) {
        return it.text;
      }
    }
  }
  return undefined;
}

/** OSC 52 for text: the terminal's own clipboard write. */
export function osc52(text) {
  return `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`;
}

/** Write text to one clipboard program; resolves whether it took it. */
function pipeTo(cmd, args, text) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'], detached: false });
    } catch {
      resolve(false);
      return;
    }
    child.on('error', () => resolve(false));
    child.on('exit', code => resolve(code === 0));
    child.stdin.on('error', () => {});
    child.stdin.end(text);
    // wl-copy and xclip stay to serve the selection; their exit is not
    // waited on past a moment.
    setTimeout(() => resolve(true), 400);
  });
}

/**
 * Copy text: OSC 52 to the terminal, and the first clipboard program of
 * this machine that takes it. Resolves with the program used, if any.
 * @param {string} text
 * @param {(s: string) => void} writeTerminal
 */
export async function copyText(text, writeTerminal) {
  writeTerminal(osc52(text));
  for (const p of PROGRAMS) {
    if (p.platform && process.platform !== p.platform) {
      continue;
    }
    if (p.needs && !process.env[p.needs]) {
      continue;
    }
    if (await pipeTo(p.cmd, p.args, text)) {
      return p.cmd;
    }
  }
  return undefined;
}
