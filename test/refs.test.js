import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeAtToken,
  formatFileMention,
  relabelMention,
  refRows,
  replaceToken,
  shownMentions,
} from '../src/refs.js';

/**
 * `@` references. If these regress, `@` opens no menu or opens it inside an
 * e-mail address, a picked path is written so the model cannot read it, or
 * a session mention loses the session it names.
 */

describe('activeAtToken', () => {
  test('an @ starting a word at the end of the line is a token', () => {
    assert.deepEqual(activeAtToken('look at @src/u'), {
      prefix: '@src/u',
      query: 'src/u',
      quoted: false,
    });
    assert.deepEqual(activeAtToken('@'), { prefix: '@', query: '', quoted: false });
    assert.deepEqual(activeAtToken('see @"my dir/f'), {
      prefix: '@"my dir/f',
      query: 'my dir/f',
      quoted: true,
    });
  });

  test('an @ inside a word, or a token already finished, is not', () => {
    assert.equal(activeAtToken('mail me@host'), undefined);
    assert.equal(activeAtToken('look at @src/ui.js '), undefined);
    assert.equal(activeAtToken('plain text'), undefined);
  });
});

describe('formatFileMention', () => {
  test('a path is @path, quoted when it has a space, a folder left open', () => {
    assert.equal(formatFileMention({ path: 'src/ui.js', kind: 'file' }, false), '@src/ui.js');
    assert.equal(formatFileMention({ path: 'my dir/a b', kind: 'file' }, false), '@"my dir/a b"');
    assert.equal(formatFileMention({ path: 'my dir', kind: 'directory' }, false), '@"my dir/');
    assert.equal(formatFileMention({ path: 'src', kind: 'file' }, true), '@"src"');
    assert.equal(formatFileMention({ path: 'a"b', kind: 'file' }, false), undefined);
  });
});

describe('relabelMention', () => {
  test('the label changes and the session URI stays', () => {
    assert.equal(
      relabelMention('@[session-1](dsh-session:abc)', 'fix the [login] bug'),
      '@[fix the login bug](dsh-session:abc)',
    );
    assert.equal(relabelMention('not a mention', 'x'), 'not a mention');
  });
});

describe('refRows', () => {
  const rows = refRows(
    [
      { path: 'src', kind: 'directory' },
      { path: 'src/ui.js', kind: 'file' },
    ],
    [
      {
        sessionId: 's1',
        label: 'abacaxi',
        mention: '@[s1](dsh-session:x)',
        sameWorkspace: false,
        cwd: '/w',
        when: 'today 10:00',
      },
    ],
    false,
  );

  test('files come before sessions, each with what a pick writes', () => {
    assert.deepEqual(
      rows.map(r => [r.kind, r.label, r.settle, r.drill]),
      [
        ['directory', 'src/', '@src/ ', '@src/'],
        ['file', 'src/ui.js', '@src/ui.js ', undefined],
        ['session', 'abacaxi', '@[abacaxi](dsh-session:x) ', undefined],
      ],
    );
    assert.equal(rows[2].description, 'session · today 10:00 · /w');
  });

  test('a quoted folder settles with its quote closed', () => {
    const [dir] = refRows([{ path: 'my dir', kind: 'directory' }], [], true);
    assert.equal(dir.settle, '@"my dir/" ');
    assert.equal(dir.drill, '@"my dir/');
  });
});

describe('replaceToken', () => {
  test('replaces only the token at the end', () => {
    assert.equal(replaceToken('see @sr', { prefix: '@sr' }, '@src/ui.js '), 'see @src/ui.js ');
  });
});

describe('shownMentions', () => {
  test('a session mention reads as @label in the transcript', () => {
    assert.equal(shownMentions('see @[abacaxi](dsh-session:xyz) now'), 'see @abacaxi now');
    assert.equal(shownMentions('@src/ui.js'), '@src/ui.js');
  });
});
