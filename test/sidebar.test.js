import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sidebarLines, sidebarShown, bar } from '../src/sidebar.js';
import { newSpeed, foldSpeed } from '../src/speed.js';

/**
 * The side panel. If these regress, the context shown is not what the
 * model was sent, or a nearly full context does not stand out.
 */

const base = {
  model: 'bonsai/Qwen',
  totals: { input: 0, output: 0, cache: 0 },
  files: [],
  instructions: [],
  standing: [],
};

test('the context is what the last step sent and answered, against the window', () => {
  let s = foldSpeed(newSpeed(), { type: 'step/start' }, 0);
  s = foldSpeed(
    s,
    {
      type: 'assistant/message',
      data: { usage: { inputTokens: 1000, cacheReadTokens: 30000, outputTokens: 500 } },
    },
    0,
  );
  assert.equal(s.context, 31500);
  const lines = sidebarLines({ ...base, context: s.context, window: 262144 }, 30);
  const i = lines.findIndex(l => l.text === 'Context');
  assert.equal(lines[i + 1].text, '32k / 262k (12%)');
  assert.equal(lines[i + 2].style, 'ok');
});

test('a context nearly full is marked, with the way to free it', () => {
  const lines = sidebarLines({ ...base, context: 240000, window: 262144 }, 30);
  assert.ok(lines.some(l => l.style === 'alert'));
  assert.ok(lines.some(l => l.text.includes('/compact')));
});

test('it shows on a wide terminal, or when asked, never on a narrow one', () => {
  assert.equal(sidebarShown('auto', 150), true);
  assert.equal(sidebarShown('auto', 100), false);
  assert.equal(sidebarShown('on', 100), true);
  assert.equal(sidebarShown('on', 60), false);
  assert.equal(sidebarShown('off', 200), false);
  assert.equal(bar(0.5, 10), '█████░░░░░');
});
