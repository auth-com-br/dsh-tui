import assert from 'node:assert/strict';
import test from 'node:test';

import { cutColumns, lineSpan, selectedText } from '../src/selection.js';
import { estimateItemLines, itemLines } from '../src/ui.js';

// What is highlighted is what is copied only if the lines selecting reads
// are the lines the transcript draws: as many, item by item.
test('an item has as many lines to select as it takes rows', () => {
  const items = [
    {
      kind: 'user',
      text: 'make a table of the cities\nand their states, please, with a long line that wraps around',
    },
    {
      kind: 'assistant',
      reasoning: 'thinking about it at some length so that it wraps more than once over the width',
      text: '| a | b |\n|---|---|\n| 1 | 2 |\n\nDone ✅ with **bold** text',
      usage: { inputTokens: 10, outputTokens: 5 },
    },
    { kind: 'tool', name: 'bash', args: 'ls', status: 'done', output: 'one\ntwo\nthree' },
    { kind: 'status', text: 'a status' },
    { kind: 'divider' },
  ];
  for (const open of [false, true]) {
    for (const item of items) {
      assert.equal(
        itemLines(item, 60, open).length,
        estimateItemLines(item, 60, open),
        `${item.kind} open=${open}`,
      );
    }
  }
});

test('columns are cut by what the terminal draws', () => {
  assert.deepEqual(cutColumns('ab✅cd', 1, 4), { before: 'a', mid: 'b✅', after: 'cd' });
  assert.deepEqual(cutColumns('ab✅cd', 3, 4), { before: 'ab', mid: '✅', after: 'cd' });
});

// A drag from inside one line to inside another takes the end of the
// first, the lines between and the start of the last — and nothing of
// what is beside the transcript.
test('a selection copies from where it started to where it ended', () => {
  const lines = [
    ['  hello world', '  second line'],
    ['  third', '  fourth line'],
  ];
  const sel = { anchor: { item: 1, line: 0, col: 6 }, focus: { item: 0, line: 0, col: 8 } };
  assert.equal(
    selectedText(sel, i => lines[i]),
    'world\n  second line\n  third',
  );
  assert.deepEqual(lineSpan(sel, 0, 0), [8, Infinity]);
  assert.deepEqual(lineSpan(sel, 1, 0), [0, 7]);
  assert.equal(lineSpan(sel, 1, 1), undefined);
});
