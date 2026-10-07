/**
 * The composer: the line the message is typed on. It replaces ink-text-input
 * for three reasons, each a bug the owner saw:
 *
 * - Typing was slow. The text lived in the App's state, so every key
 *   re-rendered the whole App — the transcript, every message's markdown
 *   laid out again. The text lives here now, and the App hears of it only
 *   when it matters to a menu (a `/` line, an `@` token).
 * - Keys typed fast were lost. ink-text-input computes each key's result
 *   from the value of the last render, so two keys before a render undid
 *   the first. Each key here starts from the text the last key left.
 * - There was no cursor to see where typing goes: Ink hides the terminal's.
 *   This draws one, blinking, and steady while keys come.
 */

import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { isMouse } from './mouse.js';
import { clusters } from './utils.js';

/** How long the cursor is shown, then hidden, while nothing is typed. */
export const BLINK_MS = 530;

/** @typedef {{text: string, cursor: number}} Line  cursor is a cluster index */

/** The text's clusters: what one cursor step moves over. */
const parts = text => clusters(text).map(c => c.s);

/**
 * What a key does to the line. Returns the next line, and `submit` when
 * enter was pressed. Keys the composer does not use (arrows up and down,
 * tab, escape) leave it as it was, for the App's own keys.
 * @param {Line} line
 * @param {string} input
 * @param {{return?: boolean, backspace?: boolean, delete?: boolean, leftArrow?: boolean, rightArrow?: boolean, upArrow?: boolean, downArrow?: boolean, tab?: boolean, escape?: boolean, ctrl?: boolean, meta?: boolean, home?: boolean, end?: boolean}} key
 * @returns {{line: Line, submit?: string}}
 */
export function editKey(line, input, key) {
  const p = parts(line.text);
  const at = Math.min(line.cursor, p.length);
  const make = (list, cursor) => ({ line: { text: list.join(''), cursor } });
  // A line feed alone is Enter too: a program the agent started can turn
  // the terminal's icrnl on, and then Enter arrives as \n — Ink's "enter",
  // not its "return" — and nothing could be sent.
  // Alt+Enter is a new line in the message; Enter sends it.
  if (key.return && key.meta) {
    return make([...p.slice(0, at), '\n', ...p.slice(at)], at + 1);
  }
  if (key.return || input === '\n') {
    return { line, submit: line.text };
  }
  if (key.upArrow || key.downArrow || key.tab || key.escape) {
    return { line };
  }
  if (key.leftArrow) {
    return { line: { ...line, cursor: Math.max(0, at - 1) } };
  }
  if (key.rightArrow) {
    return { line: { ...line, cursor: Math.min(p.length, at + 1) } };
  }
  if (key.home || (key.ctrl && input === 'a')) {
    return { line: { ...line, cursor: 0 } };
  }
  if (key.end || (key.ctrl && input === 'e')) {
    return { line: { ...line, cursor: p.length } };
  }
  if (key.ctrl && input === 'u') {
    return make(p.slice(at), 0);
  }
  if (key.ctrl && input === 'k') {
    return make(p.slice(0, at), at);
  }
  if (key.ctrl && input === 'w') {
    // The word before the cursor, and the spaces after it.
    let start = at;
    while (start > 0 && p[start - 1] === ' ') {
      start--;
    }
    while (start > 0 && p[start - 1] !== ' ') {
      start--;
    }
    return make([...p.slice(0, start), ...p.slice(at)], start);
  }
  if (key.backspace || key.delete) {
    // Ink reports the Backspace key of most terminals (DEL, 0x7f) as delete;
    // both take the character before the cursor, as ink-text-input did.
    if (at === 0) {
      return { line };
    }
    return make([...p.slice(0, at - 1), ...p.slice(at)], at - 1);
  }
  // An escape sequence Ink did not name — a mouse report above all, now
  // that the TUI takes the mouse — is not text to type.
  if (key.ctrl || key.meta || input === '' || input.startsWith('\x1b') || isMouse(input)) {
    return { line };
  }
  // A paste arrives as one input, its line breaks as \r (or \n): they are
  // kept, so pasted code or a log stays as it was — they used to become
  // spaces, since Enter sends.
  const typed = parts(input.replace(/\r\n?/g, '\n'));
  return make([...p.slice(0, at), ...typed, ...p.slice(at)], at + typed.length);
}

/**
 * The line as drawn: before the cursor, the character under it (a space at
 * the end), and after.
 * @param {Line} line
 */
export function splitAtCursor(line) {
  const p = parts(line.text);
  const at = Math.min(line.cursor, p.length);
  return { before: p.slice(0, at).join(''), under: p[at] ?? ' ', after: p.slice(at + 1).join('') };
}

const el = React.createElement;

/** The composer grows to this many lines, then shows the cursor's part. */
export const MAX_COMPOSER_LINES = 8;

/**
 * The cursor one row up or down in the laid-out line, at the same column
 * or the row's end; undefined at the first or last row, where ↑/↓ go to the
 * message history instead.
 * @param {Line} line
 * @param {number} width
 * @param {-1 | 1} dir
 * @returns {number | undefined} the new cursor
 */
export function moveRow(line, width, dir) {
  const w = Math.max(4, width);
  const cs = clusters(line.text);
  // Each row's first cluster index and its clusters' widths.
  const rows = [{ start: 0, widths: [] }];
  let rowW = 0;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.s === '\n') {
      rows.at(-1).widths.push(0);
      rows.push({ start: i + 1, widths: [] });
      rowW = 0;
      continue;
    }
    if (rowW + c.w > w) {
      rows.push({ start: i, widths: [] });
      rowW = 0;
    }
    rows.at(-1).widths.push(c.w);
    rowW += c.w;
  }
  const at = Math.min(line.cursor, cs.length);
  let r = rows.length - 1;
  while (r > 0 && rows[r].start > at) {
    r--;
  }
  const target = r + dir;
  if (target < 0 || target >= rows.length) {
    return undefined;
  }
  let col = 0;
  for (let i = rows[r].start; i < at; i++) {
    col += cs[i].w;
  }
  const t = rows[target];
  let i = 0;
  let c = 0;
  // Stop before a line break, which ends the row and is not on it.
  const last = target < rows.length - 1 ? t.widths.length - 1 : t.widths.length;
  while (i < last && c + t.widths[i] <= col) {
    c += t.widths[i];
    i++;
  }
  return t.start + i;
}

/**
 * The line laid out in `width` columns: wrapped at the width and at its own
 * line breaks, each row its text with the cursor's cell apart, and the row
 * the cursor is on. At most MAX_COMPOSER_LINES rows are kept, the cursor's
 * among them.
 * @param {Line} line
 * @param {number} width
 * @returns {{rows: Array<{before: string, under?: string, after: string}>, cursorRow: number, total: number}}
 */
export function layoutComposer(line, width) {
  const w = Math.max(4, width);
  const cs = clusters(line.text);
  const at = Math.min(line.cursor, cs.length);
  const rows = [];
  let row = { text: [], width: 0, cursor: -1 };
  let cursorRow = 0;
  const flush = () => {
    rows.push(row);
    row = { text: [], width: 0, cursor: -1 };
  };
  for (let i = 0; i <= cs.length; i++) {
    const c = i < cs.length ? cs[i] : { s: ' ', w: 1 };
    if (c.s === '\n') {
      if (i === at) {
        row.cursor = row.text.length;
        row.text.push(' ');
        cursorRow = rows.length;
      }
      flush();
      continue;
    }
    if (row.width + c.w > w) {
      flush();
    }
    if (i === at) {
      row.cursor = row.text.length;
      cursorRow = rows.length;
    }
    if (i < cs.length || i === at) {
      row.text.push(c.s);
      row.width += c.w;
    }
  }
  flush();
  const out = rows.map(r =>
    r.cursor < 0
      ? { before: r.text.join(''), after: '' }
      : {
          before: r.text.slice(0, r.cursor).join(''),
          under: r.text[r.cursor],
          after: r.text.slice(r.cursor + 1).join(''),
        },
  );
  const total = out.length;
  if (total <= MAX_COMPOSER_LINES) {
    return { rows: out, cursorRow, total };
  }
  const start = Math.min(
    Math.max(0, cursorRow - MAX_COMPOSER_LINES + 1),
    total - MAX_COMPOSER_LINES,
  );
  return {
    rows: out.slice(start, start + MAX_COMPOSER_LINES),
    cursorRow: cursorRow - start,
    total,
  };
}

/**
 * The composer. The App sets its text through `ref.current.set(text)` and
 * hears of changes through `onChange`, which it keeps cheap.
 * `initial` is the text it opens with: what was typed before an approval or
 * a question took its place.
 * `width` is its columns, and onHeight hears how many lines it takes when
 * that changes — rarely, so the App is not re-rendered by typing.
 * `history` gives the messages sent, oldest first, and `arrowsTaken` says
 * when ↑/↓ are someone else's (the `/` menu's).
 * @param {{onChange: (text: string) => void, onSubmit: (text: string) => void, placeholder?: string, initial?: string, width?: number, onHeight?: (lines: number) => void, history?: () => readonly string[], arrowsTaken?: () => boolean}} props
 */
export const Composer = React.forwardRef(function Composer(
  {
    onChange,
    onSubmit,
    placeholder = '',
    initial = '',
    width = 80,
    onHeight,
    history,
    arrowsTaken,
  },
  ref,
) {
  const [line, setLine] = useState(() => ({ text: initial, cursor: parts(initial).length }));
  // The line the next key starts from: a state value would be the last
  // render's, and keys typed faster than renders would undo each other.
  const current = useRef(line);
  const [shown, setShown] = useState(true);
  const lastKey = useRef(0);

  const commit = next => {
    const changed = next.text !== current.current.text;
    current.current = next;
    setLine(next);
    if (changed) {
      onChange(next.text);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      set: text => commit({ text, cursor: parts(text).length }),
      get: () => current.current.text,
    }),
    [onChange],
  );

  // Where ↑ has gone in the history (-1: not in it), and the draft it left.
  const hist = useRef({ index: -1, draft: '' });

  useInput((input, key) => {
    if ((key.upArrow || key.downArrow) && !arrowsTaken?.()) {
      const dir = key.upArrow ? -1 : 1;
      const moved = moveRow(current.current, width, dir);
      if (moved !== undefined) {
        commit({ ...current.current, cursor: moved });
      } else {
        // ↑ on the first row: the message before; ↓ on the last: the one
        // after, and past the newest, the draft that was being written.
        const all = history?.() ?? [];
        const h = hist.current;
        const next = h.index + (dir === -1 ? 1 : -1);
        if (next >= 0 && next < all.length) {
          if (h.index === -1) {
            h.draft = current.current.text;
          }
          h.index = next;
          const text = all[all.length - 1 - next];
          commit({ text, cursor: parts(text).length });
        } else if (next === -1 && h.index !== -1) {
          h.index = -1;
          commit({ text: h.draft, cursor: parts(h.draft).length });
        }
      }
      lastKey.current = Date.now();
      setShown(true);
      return;
    }
    const { line: next, submit } = editKey(current.current, input, key);
    if (next !== current.current && next.text !== current.current.text) {
      // An edit leaves the history where it is: the line is the person's.
      hist.current.index = -1;
    }
    if (next !== current.current) {
      commit(next);
    }
    lastKey.current = Date.now();
    setShown(true);
    if (submit !== undefined) {
      hist.current = { index: -1, draft: '' };
      onSubmit(submit);
    }
  });

  // Blink; held on while keys come, as terminals do.
  useEffect(() => {
    const timer = setInterval(() => {
      setShown(s => (Date.now() - lastKey.current < BLINK_MS ? true : !s));
    }, BLINK_MS);
    return () => clearInterval(timer);
  }, []);

  const laid = layoutComposer(line, width);
  const height = laid.rows.length;
  useEffect(() => {
    onHeight?.(height);
  }, [height, onHeight]);

  if (line.text === '' && placeholder !== '') {
    return el(
      Text,
      null,
      el(Text, { inverse: shown }, placeholder[0]),
      el(Text, { dimColor: true }, placeholder.slice(1)),
    );
  }
  return el(
    Box,
    { flexDirection: 'column' },
    ...laid.rows.map((r, i) =>
      el(
        Text,
        { key: i, wrap: 'truncate' },
        r.before,
        r.under !== undefined ? el(Text, { inverse: shown }, r.under) : null,
        r.after,
      ),
    ),
  );
});
