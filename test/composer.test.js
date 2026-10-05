import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editKey, splitAtCursor } from '../src/composer.js';

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

test('enter submits the text; a paste with line breaks stays one line', () => {
  assert.equal(editKey({ text: 'hi', cursor: 2 }, '', { return: true }).submit, 'hi');
  assert.equal(type(empty, 'a\nb\r\nc').text, 'a b c');
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
