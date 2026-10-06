import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSpeed, foldSpeed, liveRate, fmtCount, fmtRate, totalsText } from '../src/speed.js';

/**
 * Tokens and speed. If these regress, the speed counts the time the model
 * spent reading the context as writing, or the session's totals miss a step.
 */

const chunk = (time, text) => ({
  type: 'assistant/chunk',
  time,
  data: { chunk: { type: 'text-delta', text } },
});
const message = (time, usage) => ({ type: 'assistant/message', time, data: { usage } });

test("a step's speed is its output over the time it was writing, not reading", () => {
  let s = foldSpeed(newSpeed(), { type: 'step/start', time: 0 }, 0);
  // Ten seconds reading the context, then two seconds writing.
  s = foldSpeed(s, chunk(10000, 'abcd'), 0);
  s = foldSpeed(s, chunk(11000, 'efgh'), 0);
  s = foldSpeed(s, message(12000, { inputTokens: 100, outputTokens: 80, cacheReadTokens: 900 }), 0);
  assert.equal(s.rate, 40);
  assert.deepEqual(s.totals, { input: 100, output: 80, cache: 900 });

  s = foldSpeed(s, { type: 'step/start', time: 13000 }, 0);
  assert.equal(s.rate, undefined);
  s = foldSpeed(s, chunk(13500, 'x'), 0);
  s = foldSpeed(s, message(14500, { inputTokens: 5, outputTokens: 10 }), 0);
  assert.equal(s.rate, 10);
  assert.deepEqual(s.totals, { input: 105, output: 90, cache: 900 });
});

test('while streaming the speed is estimated from characters, after a second', () => {
  let s = foldSpeed(newSpeed(), { type: 'step/start' }, 0);
  s = foldSpeed(s, chunk(1000, 'a'.repeat(400)), 0);
  assert.equal(liveRate(s, 1500), undefined);
  assert.equal(liveRate(s, 3000), 50);
});

test('counts, speeds and totals read short', () => {
  assert.equal(fmtCount(980), '980');
  assert.equal(fmtCount(12345), '12k');
  assert.equal(fmtCount(1234), '1.2k');
  assert.equal(fmtCount(2_500_000), '2.5M');
  assert.equal(fmtRate(38.4), '38 tok/s');
  assert.equal(fmtRate(6.43), '6.4 tok/s');
  assert.equal(totalsText({ input: 0, output: 0, cache: 0 }), '');
  assert.equal(totalsText({ input: 12345, output: 2100, cache: 40000 }), '↑12k ↓2.1k ⟳40k tokens');
});
