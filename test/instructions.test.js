import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldInstructions, changesText, instructionsText } from '../src/instructions.js';

/**
 * Instruction files. If these regress, the screen says the agent has an
 * AGENTS.md it no longer has, or misses one it was given.
 */

const msg = changes => ({
  type: 'user/message',
  data: { source: { kind: 'agent-instructions', changes } },
});

test('files join, change and leave as the harness says', () => {
  let { files, changed } = foldInstructions(
    new Map(),
    msg([
      { action: 'set', scope: 'user', path: '~/.dsh/AGENTS.md' },
      { action: 'set', scope: 'project', path: 'AGENTS.md' },
    ]),
  );
  assert.deepEqual([...files.keys()], ['~/.dsh/AGENTS.md', 'AGENTS.md']);
  assert.equal(changesText(changed), '📘 instructions +~/.dsh/AGENTS.md  +AGENTS.md');
  ({ files, changed } = foldInstructions(
    files,
    msg([{ action: 'remove', scope: 'project', path: 'AGENTS.md' }]),
  ));
  assert.deepEqual([...files.keys()], ['~/.dsh/AGENTS.md']);
  assert.match(instructionsText(files), /📘 ~\/\.dsh\/AGENTS\.md {2}\(user\)/);
});

test('other messages change nothing, and with no files it says where to put one', () => {
  const files = new Map();
  assert.equal(
    foldInstructions(files, { type: 'user/message', data: { source: { kind: 'user' } } }).files,
    files,
  );
  assert.match(instructionsText(files), /no instruction files[\s\S]*AGENTS\.md or CLAUDE\.md/);
});
