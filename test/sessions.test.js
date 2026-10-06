import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  titleOf,
  listSessions,
  whenOf,
  searchTextOf,
  resumeNote,
} from '../src/sessions.js';

/**
 * Resuming sessions: the TUI's command line, and the list it resumes from.
 * If these regress, `dsh -c` opens the wrong session or a new one, and
 * /sessions offers sessions nobody can tell apart.
 */

const user = text => ({
  type: 'user/message',
  data: { source: { kind: 'user' }, content: [{ type: 'text', text }] },
});
const system = text => ({
  type: 'user/message',
  data: { source: { kind: 'runtime' }, content: [{ type: 'text', text }] },
});

describe('parseArgs', () => {
  test('--resume takes an id, or means the latest without one; -c is the latest', () => {
    assert.deepEqual(parseArgs(['--resume', 'abc']), { resume: 'abc' });
    assert.deepEqual(parseArgs(['--resume']), { resume: true });
    assert.deepEqual(parseArgs(['-c']), { resume: true });
    assert.deepEqual(parseArgs(['--resume=xyz']), { resume: 'xyz' });
    assert.deepEqual(parseArgs([]), {});
  });

  test('help, and an unknown argument said rather than ignored', () => {
    assert.equal(parseArgs(['--help']).help, true);
    assert.match(parseArgs(['--bogus']).error, /unknown argument --bogus/);
  });
});

describe('titleOf', () => {
  test('the harness title wins; else the first message the user wrote', () => {
    assert.equal(
      titleOf([
        system('ctx'),
        user('fix the build'),
        { type: 'session/title', data: { title: 'Build fix' } },
      ]),
      'Build fix',
    );
    assert.equal(titleOf([system('runtime context'), user('  fix   the build ')]), 'fix the build');
    assert.equal(titleOf([system('only the system')]), '(empty session)');
  });
});

describe('listSessions', () => {
  const persistence = sessions => ({
    list: async () => sessions.map(s => s.header),
    load: async id => ({ events: sessions.find(s => s.header.id === id).events }),
  });

  test('this directory only, newest first, without subagents, the open one or empty sessions', async () => {
    const p = persistence([
      { header: { id: 'old', cwd: '/w', createdAt: 1 }, events: [user('first')] },
      { header: { id: 'new', cwd: '/w', createdAt: 3 }, events: [user('second')] },
      { header: { id: 'empty', cwd: '/w', createdAt: 4 }, events: [system('ctx')] },
      { header: { id: 'open', cwd: '/w', createdAt: 5 }, events: [user('now')] },
      { header: { id: 'sub', cwd: '/w', createdAt: 6, origin: 'subagent' }, events: [user('x')] },
      { header: { id: 'other', cwd: '/elsewhere', createdAt: 7 }, events: [user('y')] },
    ]);
    const got = await listSessions(p, '/w', { skip: 'open' });
    assert.deepEqual(
      got.map(s => [s.id, s.title]),
      [
        ['new', 'second'],
        ['old', 'first'],
      ],
    );
    assert.deepEqual(
      (await listSessions(p, '/w', { limit: 1 })).map(s => s.id),
      ['open'],
    );
  });
});

describe('whenOf', () => {
  test('the time today, a weekday this week, a date before', () => {
    const now = new Date(2026, 9, 3, 15, 0).getTime();
    assert.equal(whenOf(new Date(2026, 9, 3, 9, 5).getTime(), now), 'today 09:05');
    assert.match(whenOf(new Date(2026, 9, 1, 9, 5).getTime(), now), /^[A-Z][a-z]{2} 09:05$/);
    assert.equal(whenOf(new Date(2026, 8, 1).getTime(), now), '2026-09-01');
  });
});

describe('searchTextOf', () => {
  test('is the user messages, so a session is found by words its title cut off', () => {
    const text = searchTextOf([
      user('responda apenas com a palavra: abacaxi'),
      { type: 'assistant/message' },
    ]);
    assert.match(text, /abacaxi/);
  });
});

describe('a session worked through /goal', () => {
  test('is not empty: its goal rounds are what was asked', async () => {
    const round = {
      type: 'user/message',
      data: { source: { kind: 'goal' }, content: [{ type: 'text', text: 'ship it' }] },
    };
    const persistence = {
      list: async () => [{ id: 'g', cwd: '/w', createdAt: 1 }],
      load: async () => ({ events: [round] }),
    };
    const [s] = await listSessions(persistence, '/w');
    assert.equal(s?.id, 'g');
    assert.equal(s.title, 'ship it');
  });
});

describe('parseArgs and dsh options', () => {
  test("dsh's own --patch and --profile, passed on, are not errors", () => {
    assert.deepEqual(parseArgs(['-c', '--patch', '/x/schedule.yml']), { resume: true });
    assert.deepEqual(parseArgs(['--patch=/x.yml', '--resume', 'abc']), { resume: 'abc' });
  });
});

describe('resumeNote', () => {
  test('a session with a message leaves its resume command; an empty one leaves nothing', () => {
    const note = resumeNote('session-abc', [user('oi')]);
    assert.match(note, /dsh --profile tui --resume session-abc/);
    assert.match(note, /dsh --profile tui -c/);
    assert.equal(resumeNote('session-abc', []), '');
  });
});
