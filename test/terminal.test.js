import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icrnlOn } from '../src/terminal.js';

// If this misreads stty, ctrl+J either sends the message or Enter stops
// sending after a program turned icrnl on.
test('icrnl is read from stty -a, on and off', () => {
  assert.equal(
    icrnlOn('iflag: -ignbrk -brkint -ignpar -parmrk -inpck -istrip -inlcr -igncr icrnl ixon'),
    true,
  );
  assert.equal(icrnlOn('-ignbrk -brkint -inlcr -igncr -icrnl -ixon\nopost'), false);
  assert.equal(icrnlOn('icrnl\n'), true);
});
