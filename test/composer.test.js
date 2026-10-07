import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editKey, splitAtCursor, layoutComposer, MAX_COMPOSER_LINES } from '../src/composer.js';

/**
 * The composer. If these regress, keys typed fast are lost again, the
 * cursor lands in the wrong place, or an emoji is split by a backspace.
 */

const type = (line, ...keys) =>
  keys.reduce(
    (l, k) => editKey(l, typeof k === 'string' ? k : '', typeof k === 'string' ? {} : k).line,
    line,
  );
const empty = { text: '', cursor: 0 };

test('keys typed one after another each start from the last one’s text', () => {
  const l = type(empty, 'a', 'b', 'c', { backspace: true }, { delete: true }, 'z');
  assert.deepEqual(l, { text: 'az', cursor: 2 });
});

test('the cursor moves, and typing goes where it is', () => {
  let l = type(empty, 'hello', { leftArrow: true }, { leftArrow: true }, 'X');
  assert.deepEqual(l, { text: 'helXlo', cursor: 4 });
  l = type(l, { ctrl: true }, { home: true }, '>');
  assert.equal(l.text, '>helXlo');
  assert.equal(type(l, { end: true }, '!').text, '>helXlo!');
  assert.equal(type({ text: 'abc', cursor: 0 }, { leftArrow: true }).cursor, 0);
  assert.equal(type({ text: 'abc', cursor: 3 }, { rightArrow: true }).cursor, 3);
});

test('ctrl+w takes the word before the cursor, ctrl+u and ctrl+k the line before and after it', () => {
  const w = editKey({ text: 'git commit  ', cursor: 12 }, 'w', { ctrl: true }).line;
  assert.deepEqual(w, { text: 'git ', cursor: 4 });
  assert.deepEqual(editKey({ text: 'abcdef', cursor: 2 }, 'u', { ctrl: true }).line, {
    text: 'cdef',
    cursor: 0,
  });
  assert.deepEqual(editKey({ text: 'abcdef', cursor: 2 }, 'k', { ctrl: true }).line, {
    text: 'ab',
    cursor: 2,
  });
});

test('an emoji is one step: one backspace removes it whole', () => {
  const l = type(empty, 'ok ⚠️');
  assert.equal(l.cursor, 4);
  assert.equal(type(l, { backspace: true }).text, 'ok ');
});

test('enter submits the text; a paste keeps its line breaks; alt+enter adds one', () => {
  assert.equal(editKey({ text: 'hi', cursor: 2 }, '', { return: true }).submit, 'hi');
  assert.equal(type(empty, 'a\rb\r\nc').text, 'a\nb\nc');
  const l = editKey({ text: 'ab', cursor: 1 }, '\r', { return: true, meta: true });
  assert.equal(l.submit, undefined);
  assert.deepEqual(l.line, { text: 'a\nb', cursor: 2 });
});

test('keys that are the App’s change nothing', () => {
  const l = { text: 'x', cursor: 1 };
  for (const key of [{ upArrow: true }, { downArrow: true }, { tab: true }, { escape: true }]) {
    assert.equal(editKey(l, '', key).line, l);
  }
  assert.equal(editKey(l, 'c', { ctrl: true }).line, l);
});

test('the character under the cursor is drawn apart, a space at the end', () => {
  assert.deepEqual(splitAtCursor({ text: 'abc', cursor: 1 }), {
    before: 'a',
    under: 'b',
    after: 'c',
  });
  assert.deepEqual(splitAtCursor({ text: 'abc', cursor: 3 }), {
    before: 'abc',
    under: ' ',
    after: '',
  });
});

test('Enter arriving as a line feed (icrnl turned on by a child) still sends', () => {
  assert.equal(editKey({ text: 'hi', cursor: 2 }, '\n', {}).submit, 'hi');
});

test('the composer wraps at its width and at its line breaks, the cursor in its row', () => {
  const laid = layoutComposer({ text: 'abcdef\nxy', cursor: 9 }, 4);
  assert.deepEqual(
    laid.rows.map(r => r.before + (r.under ?? '') + r.after),
    ['abcd', 'ef', 'xy '],
  );
  assert.equal(laid.cursorRow, 2);
  assert.equal(laid.rows[2].under, ' ');
});

test('a tall message shows the cursor’s part, no taller than the most lines', () => {
  const text = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
  const atEnd = layoutComposer({ text, cursor: [...text].length }, 40);
  assert.equal(atEnd.rows.length, MAX_COMPOSER_LINES);
  assert.equal(atEnd.total, 20);
  assert.match(atEnd.rows.at(-1).before, /l19/);
  const atStart = layoutComposer({ text, cursor: 0 }, 40);
  assert.equal(atStart.cursorRow, 0);
  assert.equal(atStart.rows[0].under, 'l');
});

test('↑ and ↓ move between the rows of a long message, and stop at its edges', async () => {
  const { moveRow } = await import('../src/composer.js');
  const line = { text: 'abcdef\nxy', cursor: 8 }; // on "y"
  assert.equal(moveRow(line, 4, -1), 5, 'up to the same column of "ef"');
  assert.equal(
    moveRow({ text: 'abcdef\nxy', cursor: 1 }, 4, -1),
    undefined,
    'the first row: the transcript scrolls',
  );
  assert.equal(moveRow({ text: 'abcdef\nxy', cursor: 1 }, 4, 1), 5, 'down from "b" to "f"');
  assert.equal(moveRow(line, 4, 1), undefined, 'the last row: the transcript scrolls');
});

test('a mouse report is not typed into the composer', () => {
  const l = { text: 'hi', cursor: 2 };
  assert.equal(editKey(l, '\x1b[<64;10;5M', {}).line, l);
  assert.equal(editKey(l, '[<0;10;5M[<0;10;5m', {}).line, l, 'as Ink hands it over');
});
