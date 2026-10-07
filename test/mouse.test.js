import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMouse } from '../src/mouse.js';
import { computeViewport, thoughtAtRow } from '../src/ui.js';

test('the wheel and a click are read from SGR mouse reports', () => {
  assert.equal(parseMouse('\x1b[<64;10;5M')[0].wheel, 1);
  // As Ink hands it over: without the ESC.
  assert.equal(parseMouse('[<65;10;5M')[0].wheel, -1);
  const [click, release] = parseMouse('[<0;12;7M[<0;12;7m');
  assert.deepEqual([click.button, click.press, click.row, click.col], [0, true, 7, 12]);
  assert.equal(release.press, false, 'a release is not a press');
  assert.equal(parseMouse('hello'), undefined);
  assert.equal(parseMouse('[<0;12;7M and text'), undefined);
});

// A click on a thought's line opens it: a click mapped to the wrong item
// would open another answer's thought, or none.
test('a click finds the thought on the row it lands on', () => {
  const a = { id: 1, kind: 'assistant', text: 'one', reasoning: 'thinking about one' };
  const u = { id: 2, kind: 'user', text: 'hi' };
  const b = { id: 3, kind: 'assistant', text: 'two', reasoning: 'thinking about two' };
  const items = [a, u, b];
  const v = computeViewport({ items, rows: 40, width: 60, scrollLines: 0, busy: false, room: 30 });
  const shown = {
    visible: v.visible,
    heights: v.visibleHeights,
    room: 30,
    cutBottom: v.cutBottom,
    below: v.below,
    width: 60,
    open: () => false,
  };
  // b ends at row 30: margin, thought head, answer → head on row 28.
  const hb = v.visibleHeights[2];
  const bTop = 30 - hb + 1;
  assert.equal(thoughtAtRow({ ...shown, row: bTop + 1 }), b);
  assert.equal(thoughtAtRow({ ...shown, row: bTop }), undefined, 'the margin is not the thought');
  assert.equal(thoughtAtRow({ ...shown, row: bTop - 1 }), undefined, 'the user line has none');
  const aTop = bTop - v.visibleHeights[1] - v.visibleHeights[0];
  assert.equal(thoughtAtRow({ ...shown, row: aTop + 1 }), a);
});
