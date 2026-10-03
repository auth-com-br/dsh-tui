import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  mutationPath,
  newDeliverables,
  foldDeliverables,
  deliverablesText,
} from '../src/deliverables.js';

/**
 * The files a turn changed. If these regress, a turn that wrote files ends
 * without saying which, lists a file a failed or read-only call touched, or
 * carries one turn's files into the next.
 */

const call = (callId, name, args) => ({
  type: 'tool/call',
  data: { callId, name, arguments: JSON.stringify(args) },
});
const result = (callId, isError = false) => ({
  type: 'tool/result',
  data: { message: { source: { callId }, content: [{ type: 'tool-result', isError }] } },
});

describe('mutationPath', () => {
  test('write, edit and the editor commands that change a file', () => {
    assert.equal(
      mutationPath('write', JSON.stringify({ file_path: 'a.js', content: 'x' })),
      'a.js',
    );
    assert.equal(
      mutationPath('edit', JSON.stringify({ file_path: 'b.js', old_string: 'x', new_string: 'y' })),
      'b.js',
    );
    assert.equal(
      mutationPath(
        'str_replace_editor',
        JSON.stringify({ command: 'create', path: 'c.js', file_text: '' }),
      ),
      'c.js',
    );
  });

  test('reads, no-op edits and broken arguments are not changes', () => {
    assert.equal(mutationPath('read', JSON.stringify({ file_path: 'a.js' })), null);
    assert.equal(
      mutationPath('edit', JSON.stringify({ file_path: 'b.js', old_string: 'x', new_string: 'x' })),
      null,
    );
    assert.equal(
      mutationPath('str_replace_editor', JSON.stringify({ command: 'view', path: 'c.js' })),
      null,
    );
    assert.equal(mutationPath('write', '{not json'), null);
  });
});

describe('foldDeliverables', () => {
  test('successful mutations are listed once, in order; failures are not', () => {
    let s = newDeliverables();
    for (const e of [
      { type: 'turn/start' },
      call('1', 'write', { file_path: 'a.js', content: 'x' }),
      result('1'),
      call('2', 'edit', { file_path: 'b.js', old_string: 'x', new_string: 'y' }),
      result('2', true),
      call('3', 'edit', { file_path: 'a.js', old_string: 'x', new_string: 'y' }),
      result('3'),
      call('4', 'read', { file_path: 'c.js' }),
      result('4'),
    ]) {
      s = foldDeliverables(s, e);
    }
    assert.deepEqual(s.produced, ['a.js']);
    assert.deepEqual(foldDeliverables(s, { type: 'turn/start' }).produced, []);
  });
});

describe('deliverablesText', () => {
  test('nothing changed says nothing; paths are relative to the session', () => {
    assert.equal(deliverablesText([], '/w', 80), undefined);
    assert.equal(
      deliverablesText(['/w/src/a.js', 'b.js'], '/w', 80),
      '✎ 2 files changed: src/a.js · b.js',
    );
  });

  test('a file named once absolute and once relative is one file', () => {
    assert.equal(
      deliverablesText(['/w/a.txt', 'notas/b.txt', 'a.txt', './notas/b.txt'], '/w', 80),
      '✎ 2 files changed: a.txt · notas/b.txt',
    );
  });

  test('a long list is cut with a count of the rest', () => {
    const paths = Array.from({ length: 30 }, (_, i) => `src/file-${i}.js`);
    const text = deliverablesText(paths, '/w', 80);
    assert.ok(text.length <= 80, text);
    assert.match(text, /^✎ 30 files changed: src\/file-0\.js · .* · \+\d+ more$/);
  });
});
