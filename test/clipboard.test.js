import assert from 'node:assert/strict';
import test from 'node:test';

import { copyText, nthAnswer, osc52 } from '../src/clipboard.js';

// /copy takes the answer's own text: dragging in a terminal takes whole
// rows, the side panel with them.
test('/copy picks the n-th last answer, skipping what is not one', () => {
  const items = [
    { kind: 'assistant', text: 'first' },
    { kind: 'user', text: 'q' },
    { kind: 'assistant', text: '' },
    { kind: 'assistant', text: 'second' },
    { kind: 'status', text: 'x' },
  ];
  assert.equal(nthAnswer(items, 1), 'second');
  assert.equal(nthAnswer(items, 2), 'first');
  assert.equal(nthAnswer(items, 3), undefined);
});

test('OSC 52 carries the text whole, accents and all', () => {
  const seq = osc52('ação ✅');
  assert.ok(seq.startsWith('\x1b]52;c;') && seq.endsWith('\x07'));
  const b64 = seq.slice('\x1b]52;c;'.length, -1);
  assert.equal(Buffer.from(b64, 'base64').toString('utf8'), 'ação ✅');
});

test('the terminal is always told, whether or not a clipboard program is there', async () => {
  const env = { ...process.env };
  delete process.env.WAYLAND_DISPLAY;
  delete process.env.DISPLAY;
  let written = '';
  try {
    await copyText('hi', s => {
      written += s;
    });
  } finally {
    Object.assign(process.env, env);
  }
  assert.equal(written, osc52('hi'));
});
