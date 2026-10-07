/**
 * Selecting text in the transcript, as OpenCode does it (opentui): the TUI
 * has the mouse, and a drag selects inside what is text — the messages —
 * and nothing else: not the side panel, not the composer, not the rule. A
 * terminal's own selection takes whole rows, the side panel with them.
 *
 * A point of the transcript is an item, a line of it and a column of that
 * line, the line as ui.js's itemLines writes it — the same lines the item
 * is drawn as, so what is highlighted is what is copied. On release the
 * selection is copied (OpenCode's copy on select).
 */

import { clusters } from './utils.js';

/** @typedef {{item: number, line: number, col: number}} Point  item: index in the transcript */

/** -1, 0 or 1 as a is before, at or after b. */
export function comparePoints(a, b) {
  return a.item - b.item || a.line - b.line || a.col - b.col;
}

/** The two ends of a selection, in order. */
export function ordered(sel) {
  return comparePoints(sel.anchor, sel.focus) <= 0
    ? [sel.anchor, sel.focus]
    : [sel.focus, sel.anchor];
}

/**
 * A line cut at two columns: what is before, between and after, by what a
 * terminal draws (an emoji is two columns, and is never cut in half).
 * @param {string} line
 * @param {number} from
 * @param {number} to  exclusive; Infinity for the line's end
 */
export function cutColumns(line, from, to) {
  let before = '';
  let mid = '';
  let after = '';
  let col = 0;
  for (const { s, w } of clusters(line)) {
    if (col + w <= from) {
      before += s;
    } else if (col < to) {
      mid += s;
    } else {
      after += s;
    }
    col += w;
  }
  return { before, mid, after };
}

/**
 * The columns of an item's line that a selection covers, or undefined.
 * @param {{anchor: Point, focus: Point}} sel
 * @param {number} item
 * @param {number} line
 * @returns {[number, number] | undefined}  [from, to), to Infinity for the end
 */
export function lineSpan(sel, item, line) {
  if (!sel) {
    return undefined;
  }
  const [a, b] = ordered(sel);
  const here = { item, line, col: 0 };
  if (comparePoints({ ...a, col: 0 }, here) > 0 || comparePoints({ ...b, col: 0 }, here) < 0) {
    return undefined;
  }
  const from = a.item === item && a.line === line ? a.col : 0;
  const to = b.item === item && b.line === line ? b.col + 1 : Infinity;
  return to > from ? [from, to] : undefined;
}

/**
 * The text a selection covers: each line's part, its trailing spaces
 * dropped, the lines joined.
 * @param {{anchor: Point, focus: Point}} sel
 * @param {(item: number) => string[]} linesOf  an item's lines as drawn
 */
export function selectedText(sel, linesOf) {
  const [a, b] = ordered(sel);
  const out = [];
  for (let item = a.item; item <= b.item; item++) {
    const lines = linesOf(item);
    for (let line = 0; line < lines.length; line++) {
      const span = lineSpan(sel, item, line);
      if (span === undefined) {
        continue;
      }
      out.push(cutColumns(lines[line], span[0], span[1]).mid.replace(/\s+$/, ''));
    }
  }
  return out.join('\n').replace(/^\n+|\n+$/g, '');
}
