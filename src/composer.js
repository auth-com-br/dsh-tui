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
import { Text, useInput } from 'ink';
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
  if (key.ctrl || key.meta || input === '') {
    return { line };
  }
  // A paste arrives as one input; its line breaks become spaces, since
  // enter sends.
  const typed = parts(input.replace(/\r\n?|\n/g, ' '));
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

/**
 * The composer. The App sets its text through `ref.current.set(text)` and
 * hears of changes through `onChange`, which it keeps cheap.
 * `initial` is the text it opens with: what was typed before an approval or
 * a question took its place.
 * @param {{onChange: (text: string) => void, onSubmit: (text: string) => void, placeholder?: string, initial?: string}} props
 */
export const Composer = React.forwardRef(function Composer(
  { onChange, onSubmit, placeholder = '', initial = '' },
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

  useInput((input, key) => {
    const { line: next, submit } = editKey(current.current, input, key);
    if (next !== current.current) {
      commit(next);
    }
    lastKey.current = Date.now();
    setShown(true);
    if (submit !== undefined) {
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

  if (line.text === '' && placeholder !== '') {
    return el(
      Text,
      null,
      el(Text, { inverse: shown }, placeholder[0]),
      el(Text, { dimColor: true }, placeholder.slice(1)),
    );
  }
  const { before, under, after } = splitAtCursor(line);
  return el(Text, null, before, el(Text, { inverse: shown }, under), after);
});
