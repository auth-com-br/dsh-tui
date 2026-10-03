import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trajectoryText, dur } from '../src/trajectory.js';

/**
 * /trajectory. If these regress, the ledger misattributes a tool to the
 * wrong step, adds up tokens wrong, or shows a failed tool as done.
 */

const e = (type, time, data = {}) => ({ type, time, data });
const usage = (i, o, c = 0) => ({ usage: { inputTokens: i, outputTokens: o, cacheReadTokens: c } });
const result = (callId, isError = false) =>
  e('tool/result', 0, {
    message: { source: { callId }, content: [{ type: 'tool-result', isError }] },
  });

const log = [
  e('turn/start', 0),
  e('step/start', 100),
  e('assistant/message', 2100, usage(1000, 50, 800)),
  e('tool/call', 2100, { callId: 'a', name: 'read' }),
  { ...result('a'), time: 2300 },
  e('tool/call', 2300, { callId: 'b', name: 'bash' }),
  { ...result('b', true), time: 2400 },
  e('step/end', 2400),
  e('step/start', 2500),
  e('assistant/message', 4500, usage(30, 20)),
  e('step/end', 4500),
  e('turn/end', 4600, { reason: { kind: 'completed' } }),
];

test('a turn lists its steps, the model time and tokens, and each tool', () => {
  assert.equal(
    trajectoryText(log, 1, 0),
    [
      'turn 1 · completed · 4.6s · 2 steps · 1,030 in / 70 out · 800 cached',
      '  step 1    2.3s  model 2.0s · 1,000 in / 50 out',
      '           ✓ read 0.2s',
      '           ✗ bash 0.1s',
      '  step 2    2.0s  model 2.0s · 30 in / 20 out',
    ].join('\n'),
  );
});

test('a turn still running is timed to now', () => {
  const text = trajectoryText([e('turn/start', 0), e('step/start', 0)], 1, 65000);
  assert.match(text, /^turn 1 · running · 1m05s · 1 steps/);
  assert.match(text, /model waiting/);
  assert.equal(trajectoryText([], 1, 0), 'no turns yet.');
  assert.equal(dur(500), '0.5s');
});
