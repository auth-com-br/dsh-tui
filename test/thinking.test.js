import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thinkingView, estimateItemLines } from '../src/ui.js';

/**
 * Thinking, folded. If these regress, a long thought fills the screen and
 * pushes the answer out of sight again, or the height counted for it is not
 * what is drawn and the viewport cuts the answer.
 */

const thought = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');

test('folded, a thought is one line saying how long it is; open, all of it', () => {
  const folded = thinkingView(thought, 80, false);
  assert.equal(folded.heading, '  ▸ thinking · 30 lines · ctrl+t shows');
  assert.deepEqual(folded.lines, []);
  const open = thinkingView(thought, 80, true);
  assert.equal(open.lines.length, 30);
  assert.match(open.heading, /▾ thinking · 30 lines · ctrl\+t folds/);
});

test('streaming and folded, the latest lines show', () => {
  const live = thinkingView(thought, 80, false, true);
  assert.deepEqual(live.lines, ['line 27', 'line 28', 'line 29']);
});

test('the height counted is the height drawn', () => {
  const item = {
    kind: 'assistant',
    text: 'short answer',
    reasoning: thought,
    usage: { outputTokens: 1 },
  };
  const folded = estimateItemLines(item, 80, false);
  const open = estimateItemLines(item, 80, true);
  assert.equal(open - folded, 30, 'opening adds exactly the thought’s lines');
});
