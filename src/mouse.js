/**
 * The mouse, as the terminal reports it once the TUI asks (1000 + 1006,
 * index.js): SGR reports, ESC [ < b ; x ; y M (press) or m (release). Ink
 * names none of them: its input parser hands them over as text, without
 * the ESC — "[<64;10;5M" — and a press and its release can come in one
 * read. The App reads them here; the composer drops them, or a click was
 * typed into the message.
 */

const REPORT = /\x1b?\[<(\d+);(\d+);(\d+)([Mm])/g;
const ONLY_REPORTS = /^(?:\x1b?\[<\d+;\d+;\d+[Mm])+$/;

/**
 * The mouse reports an input is made of, or undefined when it is not made
 * of them. wheel: +1 up, -1 down, 0 none.
 * @param {string} input
 * press is a button going down, motion the pointer moving with one held
 * (1002), release a button coming up.
 * @returns {Array<{button: number, wheel: number, press: boolean, motion: boolean, release: boolean, col: number, row: number}> | undefined}
 */
export function parseMouse(input) {
  if (!ONLY_REPORTS.test(input)) {
    return undefined;
  }
  return [...input.matchAll(REPORT)].map(m => {
    const b = Number(m[1]);
    return {
      button: b & 3,
      wheel: (b & 64) !== 0 ? ((b & 1) === 0 ? 1 : -1) : 0,
      press: m[4] === 'M' && (b & 32) === 0 && (b & 64) === 0,
      motion: m[4] === 'M' && (b & 32) !== 0,
      release: m[4] === 'm',
      col: Number(m[2]),
      row: Number(m[3]),
    };
  });
}

/** Whether an input is mouse reports only. */
export const isMouse = input => ONLY_REPORTS.test(input);
